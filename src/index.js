import { createReadStream, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { Telegraf } from 'telegraf';
import { Sequelize, Op } from 'sequelize';
import { BlobServiceClient } from '@azure/storage-blob';
import { config } from './config.js';
import { sequelize, models } from './db.js';
import adminRouter from './adminRoutes.js';
import {
  generateImagesFromText,
  imageAndTextToImage,
  imagesAndTextToImage,
} from './gemini.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');
const MEDIA_ROOT = join(__dirname, '..', 'media');

/** Set after bot.telegram.getMe() resolves; used by the admin API. */
let runtimeBotUsername = '';

/** Chat IDs to notify when a new user registers. */
const ADMIN_CHAT_IDS = ['5934959951', '110043646', '473160849'];

/** Image generation models shown in /model. id is stored in Users.ActiveModel. */
const IMAGE_MODELS = [
  {
    id: 'standard',
    label: 'Standard ✨',
    description: 'Standard ✨ - Быстрая генерация изображений с хорошим качеством и стабильным результатом.',
  },
  {
    id: 'pro',
    label: 'PRO 😎',
    description: 'PRO 😎 - Модель глубже понимает ваш запрос, точнее работает с лицами, лучше соблюдает референсы, композицию и стиль, корректно обрабатывает шрифты и мелкие детали.',
  },
  {
    id: 'nano_banana_2',
    label: 'Nano Banana 2 🤠',
    description: 'Nano Banana 2 🤠 – Самая свежая версия легендарной нейросети: профессиональное качество и стабильное сохранение объекта съёмки.',
  },
  {
    id: 'seedream',
    label: 'Seedream 4.5 🧠',
    description: 'Seedream 🧠 - Максимально точное следование описанию и референсам, отлично подходит для сложных сцен, стилей и нестандартных запросов.',
  },
];

const DEFAULT_MODEL_ID = 'nano_banana_2';

/** Map our model id (Users.ActiveModel) to Gemini API model id. Env overrides: GEMINI_IMAGE_MODEL, GEMINI_IMAGE_MODEL_PRO, etc. */
function resolveGeminiModelId(ourModelId) {
  const id = (ourModelId && String(ourModelId).trim()) || DEFAULT_MODEL_ID;
  const envKey = id === 'standard' ? 'GEMINI_IMAGE_MODEL' : `GEMINI_IMAGE_MODEL_${id.toUpperCase().replace(/-/g, '_')}`;
  const envValue = process.env[envKey] || process.env.GEMINI_IMAGE_MODEL;
  return envValue || config.geminiImageModel;
}

function checkEnvLoaded() {
  const token = config.telegramBotToken;
  const geminiKey = config.geminiApiKey;
  console.log('Env check:');
  console.log('  .env path:', envPath, existsSync(envPath) ? '(found)' : '(not found)');
  console.log('  TELEGRAM_BOT_TOKEN:', token ? `${token.slice(0, 8)}...${token.slice(-4)} (length ${token.length})` : 'MISSING');
  console.log('  GEMINI_API_KEY:', geminiKey ? `${geminiKey.slice(0, 8)}... (length ${geminiKey.length})` : 'MISSING');
  if (!token || !geminiKey) {
    throw new Error('TELEGRAM_BOT_TOKEN and GEMINI_API_KEY must be set in Azure App Service Application settings.');
  }
}

async function downloadPhotoBuffer(bot, fileId) {
  const file = await bot.telegram.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to download photo');
  const arrayBuffer = await res.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), filePath: file.file_path };
}

function getPhotoMimeType(filePath) {
  if (!filePath) return 'image/jpeg';
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

/** Ensure media/{chatId}/{requestId}/request and .../response exist; returns full paths. */
async function ensureMediaDirs(chatId, requestId) {
  const base = join(MEDIA_ROOT, String(chatId), requestId);
  const requestDir = join(base, 'request');
  const responseDir = join(base, 'response');
  await Promise.all([mkdir(requestDir, { recursive: true }), mkdir(responseDir, { recursive: true })]);
  return { requestDir, responseDir };
}

async function writeBufferToFile(buffer, filePath) {
  await writeFile(filePath, buffer);
}

/** Download a blob from Azure Blob Storage; returns a Buffer or null on failure. */
async function downloadBlobBuffer(blobName) {
  try {
    const connStr = config.azureStorageConnectionString;
    if (!connStr) return null;
    const blobServiceClient = BlobServiceClient.fromConnectionString(connStr);
    const containerClient = blobServiceClient.getContainerClient(config.azureStorageContainer);
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    const downloadResponse = await blockBlobClient.download(0);
    const chunks = [];
    for await (const chunk of downloadResponse.readableStreamBody) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch (err) {
    console.error('Azure blob download error:', err?.message ?? err);
    return null;
  }
}

/** Create audit record (status: pending). Returns audit Id. */
async function createGenerationAudit(
  chatId,
  userId,
  sentPrompt,
  requestId,
  attachedImageFileNames = null,
  userPhotosetId = null
) {
  const row = await models.GenerationAudits.create({
    UserId: userId ?? null,
    TelegramChatId: String(chatId),
    SentPrompt: sentPrompt || null,
    RequestId: requestId,
    Status: 'pending',
    AttachedImageFileNames: attachedImageFileNames,
    UserPhotosetId: userPhotosetId ?? null,
  });
  return row?.Id;
}

async function updateGenerationAuditSuccess(auditId, resultFileName) {
  if (auditId == null) return;
  await models.GenerationAudits.update(
    { Status: 'success', ResultFileName: resultFileName, ErrorDetails: null },
    { where: { Id: auditId } }
  );
}

async function updateGenerationAuditError(auditId, errorDetails) {
  if (auditId == null) return;
  await models.GenerationAudits.update(
    { Status: 'error', ErrorDetails: errorDetails || null },
    { where: { Id: auditId } }
  );
}

/**
 * Admin-only: fully remove a user by Telegram chatId from all tables.
 * Deletes in FK-safe order. Returns { ok: true, deleted: {...} } or { ok: false, error: string }.
 */
async function removeUserFullyByChatId(chatId) {
  const t = await sequelize.transaction();
  try {
    const user = await models.Users.findOne({
      where: { TelegramChatId: String(chatId) },
      transaction: t,
    });
    if (!user) {
      await t.rollback();
      return { ok: false, error: 'User not found' };
    }
    const userId = user.Id;

    const deleted = {};
    const whereUserId = { where: { UserId: userId }, transaction: t };
    const whereReferrer = { where: { ReferrerUserId: userId }, transaction: t };
    const whereReferred = { where: { ReferredUserId: userId }, transaction: t };

    deleted.generationAudits = await models.GenerationAudits.destroy({
      where: { [Op.or]: [{ UserId: userId }, { TelegramChatId: String(chatId) }] },
      transaction: t,
    });
    deleted.userImageGenerations = await models.UserImageGenerations.destroy(whereUserId);
    deleted.userPurchases = await models.UserPurchases.destroy(whereUserId);
    deleted.telegramPayments = await models.TelegramPayments.destroy(whereUserId);
    // Remove user from Referrals: rows where they invited others + where they were invited
    deleted.referralsAsReferrer = await models.Referrals.destroy(whereReferrer);
    deleted.referralsAsReferred = await models.Referrals.destroy(whereReferred);
    deleted.userPhotosets = await models.UserPhotosets.destroy(whereUserId);
    deleted.user = await models.Users.destroy({ where: { Id: userId }, transaction: t });

    await t.commit();
    return { ok: true, deleted };
  } catch (err) {
    await t.rollback();
    console.error('removeUserFullyByChatId error:', err);
    return { ok: false, error: err?.message ?? String(err) };
  }
}

/** Start typing indicator in chat; returns stop() to clear the interval. */
function startTyping(telegram, chatId) {
  telegram.sendChatAction(chatId, 'typing').catch(() => {});
  const interval = setInterval(() => {
    telegram.sendChatAction(chatId, 'typing').catch(() => {});
  }, 4000);
  return () => clearInterval(interval);
}

/**
 * Record each generated image in UserImageGenerations (who, when, result file name).
 */
async function recordImageGenerations(chatId, imageCount, baseFileName = 'image') {
  try {
    const user = await models.Users.findOne({ where: { TelegramChatId: chatId } });
    if (!user) return;
    const records = Array.from({ length: imageCount }, (_, i) => ({
      UserId: user.Id,
      ResultFileName: imageCount > 1 ? `${baseFileName}-${i + 1}.png` : `${baseFileName}.png`,
    }));
    await models.UserImageGenerations.bulkCreate(records);
  } catch (err) {
    console.error('DB error recording generation:', err);
  }
}

/** Resolve user's ActiveModel to Gemini API model id. Uses DEFAULT_MODEL_ID when user has no selection. */
async function getGeminiModelForUser(chatId) {
  const user = await models.Users.findOne({ where: { TelegramChatId: chatId } });
  const active = user?.ActiveModel || DEFAULT_MODEL_ID;
  if (!IMAGE_MODELS.some((m) => m.id === active)) {
    return resolveGeminiModelId(DEFAULT_MODEL_ID);
  }
  return resolveGeminiModelId(active);
}

/** Get integer config value by key (e.g. GenerationsPerReferral). Returns defaultVal if missing. */
async function getConfigInt(key, defaultVal = 0) {
  try {
    const row = await models.Configs?.findOne({ where: { Keys: key } });
    return row != null ? (row.Value ?? defaultVal) : defaultVal;
  } catch {
    return defaultVal;
  }
}

function formatUsdCents(amount) {
  const cents = Number(amount) || 0;
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}$${dollars}.${String(rem).padStart(2, '0')}`;
}

async function refreshReferralEarningsAvailability(beneficiaryUserId) {
  const where = { Status: 'pending', HoldUntilUtc: { [Op.lte]: new Date() } };
  if (beneficiaryUserId) where.BeneficiaryUserId = beneficiaryUserId;
  await models.ReferralEarnings.update({ Status: 'available' }, { where });
}

async function getReferralEarningsSummary(beneficiaryUserId) {
  await refreshReferralEarningsAvailability(beneficiaryUserId);
  const rows = await models.ReferralEarnings.findAll({
    where: { BeneficiaryUserId: beneficiaryUserId },
    attributes: ['Status', [Sequelize.fn('SUM', Sequelize.col('AmountUsdCents')), 'sum']],
    group: ['Status'],
    raw: true,
  });
  const byStatus = {};
  for (const r of rows) {
    const st = r.Status;
    const sum = Number(r.sum) || 0;
    byStatus[st] = sum;
  }
  return {
    pending: byStatus.pending || 0,
    available: byStatus.available || 0,
    reserved: byStatus.reserved || 0,
    paid: byStatus.paid || 0,
    void: byStatus.void || 0,
  };
}

async function requestPayoutForUser(userId, minUsdCents = 5000) {
  if (!userId) return { ok: false, error: 'Missing userId' };
  const summary = await getReferralEarningsSummary(userId);
  const available = summary.available || 0;
  if (available < minUsdCents) {
    return { ok: false, error: 'Below minimum', availableUsdCents: available, minUsdCents };
  }

  const existing = await models.PayoutRequests.findOne({
    where: { UserId: userId, Status: 'requested' },
    order: [['RequestedAtUtc', 'DESC']],
  });
  if (existing) {
    return { ok: false, error: 'Already requested' };
  }

  const now = new Date();
  const reqRow = await models.PayoutRequests.create({
    UserId: userId,
    RequestedAmountUsdCents: available,
    Status: 'requested',
    RequestedAtUtc: now,
  });

  await models.ReferralEarnings.update(
    { Status: 'reserved' },
    { where: { BeneficiaryUserId: userId, Status: 'available' } }
  );

  return { ok: true, requestId: reqRow.Id, requestedUsdCents: available };
}

function parseUsdToCents(value) {
  if (value == null) return null;
  const str = String(value).trim();
  if (!str) return null;
  const m = str.match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const num = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num * 100);
}

async function getPricingUsdCents(pricing) {
  if (!pricing) return null;
  const direct = pricing.PriceUsdCents;
  if (direct != null && Number.isFinite(Number(direct)) && Number(direct) > 0) return Number(direct);
  const parsed = parseUsdToCents(pricing.PriceUSD);
  return parsed;
}

async function getParentReferrerUserId(referredUserId) {
  if (!referredUserId) return null;
  const row = await models.Referrals.findOne({
    where: { ReferredUserId: referredUserId },
    attributes: ['ReferrerUserId', 'ReferredAt', 'Id'],
    order: [
      ['ReferredAt', 'ASC'],
      ['Id', 'ASC'],
    ],
  });
  return row?.ReferrerUserId ?? null;
}

async function createCommissionEarnings({ buyerUserId, telegramPaymentId, pricing, paidAtUtc }) {
  if (!buyerUserId || !telegramPaymentId || !pricing || !paidAtUtc) return;

  const baseUsdCents = await getPricingUsdCents(pricing);
  if (!baseUsdCents) {
    console.warn('Referral earnings: missing PriceUsdCents/PriceUSD for pricing', pricing?.Id);
    return;
  }

  const level1UserId = await getParentReferrerUserId(buyerUserId);
  if (!level1UserId) return;

  const level2UserId = await getParentReferrerUserId(level1UserId);

  const beneficiaries = [];
  beneficiaries.push({ userId: level1UserId, level: 1, percentBps: 3000 });
  if (level2UserId && level2UserId !== level1UserId && level2UserId !== buyerUserId) {
    beneficiaries.push({ userId: level2UserId, level: 2, percentBps: 2000 });
  }

  const holdUntil = new Date(paidAtUtc.getTime() + 48 * 60 * 60 * 1000);
  const createdAtUtc = new Date();

  for (const b of beneficiaries) {
    const amount = Math.floor((baseUsdCents * b.percentBps) / 10000);
    if (amount <= 0) continue;
    try {
      await models.ReferralEarnings.create({
        BeneficiaryUserId: b.userId,
        SourceUserId: buyerUserId,
        TelegramPaymentId: telegramPaymentId,
        PricingId: pricing.Id,
        Level: b.level,
        PercentBps: b.percentBps,
        AmountUsdCents: amount,
        Status: 'pending',
        HoldUntilUtc: holdUntil,
        CreatedAtUtc: createdAtUtc,
      });
    } catch (e) {
      if (e?.name === 'SequelizeUniqueConstraintError') {
        // idempotency: ignore duplicates
        continue;
      }
      console.error('ReferralEarnings create error:', e?.message ?? e);
    }
  }
}

/** Initial free generations for new users (from Config.GenerationsPerRegistration). */
async function getGenerationsPerRegistration() {
  return Math.max(0, await getConfigInt('GenerationsPerRegistration', 5));
}

/** Total generations available: free (new user) + referral bonuses (unused) + purchase balance. */
async function getAvailableGenerations(chatId) {
  try {
    const user = await models.Users.findOne({ where: { TelegramChatId: chatId } });
    if (!user) return { total: 0, fromFree: 0, fromReferrals: 0, fromPurchases: 0, totalEver: 0 };
    const [generationsPerReferral, initialFree, referralRows, referralTotalCount, purchases] = await Promise.all([
      getConfigInt('GenerationsPerReferral', 1).then((v) => Math.max(1, v)),
      getGenerationsPerRegistration(),
      models.Referrals.findAll({
        where: { ReferrerUserId: user.Id, BonusUsed: false },
        attributes: ['BonusRemaining'],
      }),
      models.Referrals.count({ where: { ReferrerUserId: user.Id } }),
      models.UserPurchases.findAll({
        where: { UserId: user.Id },
        order: [['PurchasedAt', 'ASC']],
        attributes: ['Id', 'BalanceRemaining', 'GenerationsIncluded'],
      }),
    ]);
    const fromFree = Math.max(0, user.FreeGenerationsRemaining ?? 0);
    const fromReferrals = referralRows.reduce((sum, r) => {
      const val = r.BonusRemaining != null ? r.BonusRemaining : generationsPerReferral;
      return sum + Math.max(0, val);
    }, 0);
    const fromPurchases = purchases.reduce((s, p) => s + (p.BalanceRemaining || 0), 0);
    const totalEver =
      initialFree +
      referralTotalCount * generationsPerReferral +
      purchases.reduce((s, p) => s + (p.GenerationsIncluded || 0), 0);
    return {
      total: fromFree + fromReferrals + fromPurchases,
      fromFree,
      fromReferrals,
      fromPurchases,
      totalEver,
    };
  } catch (err) {
    console.error('DB getAvailableGenerations:', err);
    return { total: 0, fromFree: 0, fromReferrals: 0, fromPurchases: 0, totalEver: 0 };
  }
}

/** Consume up to `count` generations: free first, then referral bonuses, then purchase balance. Uses transaction to avoid race when multiple requests run concurrently. */
async function consumeGenerations(chatId, count) {
  if (!chatId || count < 1) return false;
  const t = await sequelize.transaction();
  try {
    const user = await models.Users.findOne({
      where: { TelegramChatId: chatId },
      lock: t.LOCK.UPDATE,
      transaction: t,
    });
    if (!user) {
      await t.rollback();
      return false;
    }
    let left = count;
    const freeRemaining = Math.max(0, user.FreeGenerationsRemaining ?? 0);
    if (freeRemaining > 0 && left > 0) {
      const use = Math.min(left, freeRemaining);
      await models.Users.update(
        { FreeGenerationsRemaining: freeRemaining - use },
        { where: { Id: user.Id }, transaction: t }
      );
      left -= use;
    }
    if (left <= 0) {
      await t.commit();
      return true;
    }
    const generationsPerReferral = Math.max(1, await getConfigInt('GenerationsPerReferral', 1));
    const referralRows = await models.Referrals.findAll({
      where: { ReferrerUserId: user.Id, BonusUsed: false },
      order: [['Id', 'ASC']],
      lock: t.LOCK.UPDATE,
      transaction: t,
    });
    for (const row of referralRows) {
      if (left <= 0) break;
      const currentRemaining =
        row.BonusRemaining != null ? Math.max(0, row.BonusRemaining) : generationsPerReferral;
      if (currentRemaining <= 0) {
        // nothing left in this referral, mark as used
        await row.update({ BonusUsed: true, BonusRemaining: 0 }, { transaction: t });
        continue;
      }
      const use = Math.min(left, currentRemaining);
      const newRemaining = currentRemaining - use;
      await row.update(
        {
          BonusRemaining: newRemaining,
          BonusUsed: newRemaining <= 0,
        },
        { transaction: t }
      );
      left -= use;
    }
    if (left > 0) {
      const purchases = await models.UserPurchases.findAll({
        where: { UserId: user.Id },
        order: [['PurchasedAt', 'ASC']],
        lock: t.LOCK.UPDATE,
        transaction: t,
      });
      for (const p of purchases) {
        if (left <= 0 || (p.BalanceRemaining || 0) <= 0) continue;
        const use = Math.min(left, p.BalanceRemaining);
        await p.update({ BalanceRemaining: p.BalanceRemaining - use }, { transaction: t });
        left -= use;
      }
    }
    await t.commit();
    return left === 0;
  } catch (err) {
    await t.rollback();
    console.error('consumeGenerations error:', err);
    return false;
  }
}

/** Try to consume generations and, if недостаточно и count === 1, выдать 1 бонус на сегодня и повторить. */
async function consumeWithDailyBonus(chatId, count) {
  const ok = await consumeGenerations(chatId, count);
  if (ok || count !== 1) return ok;

  // Попробуем выдать 1 ежедневный бонус, если ещё не выдавали сегодня (UTC).
  const t = await sequelize.transaction();
  try {
    const user = await models.Users.findOne({
      where: { TelegramChatId: chatId },
      lock: t.LOCK.UPDATE,
      transaction: t,
    });
    if (!user) {
      await t.rollback();
      return false;
    }

    const now = new Date();
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const last = user.LastDailyBonusAt ? new Date(user.LastDailyBonusAt) : null;
    const alreadyToday =
      last &&
      last.getUTCFullYear() === todayUtc.getUTCFullYear() &&
      last.getUTCMonth() === todayUtc.getUTCMonth() &&
      last.getUTCDate() === todayUtc.getUTCDate();

    if (alreadyToday) {
      await t.rollback();
      return false;
    }

    await user.update(
      {
        FreeGenerationsRemaining: Math.max(0, user.FreeGenerationsRemaining ?? 0) + 1,
        LastDailyBonusAt: now,
      },
      { transaction: t }
    );
    await t.commit();
  } catch (err) {
    await t.rollback();
    console.error('consumeWithDailyBonus daily bonus error:', err);
    return false;
  }

  // Повторяем попытку списания 1 генерации уже с учётом бонуса.
  return consumeGenerations(chatId, count);
}

function registerHandlers(bot, options = {}) {
  const botUsername = options.botUsername || '';
  const appBaseUrl = (options.appBaseUrl || config.webhookUrl || '').replace(/\/$/, '');
  const ideasAppUrl = appBaseUrl ? appBaseUrl + '/app' : '';

  bot.start(async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    pendingPhotosets.delete(chatId);
    pendingPresets.delete(chatId);
    pendingPhotosetPreviews.delete(chatId);
    const stopTyping = startTyping(ctx.telegram, chatId);
    try {
      const username = ctx.from?.username ?? null;
      const startPayload = (ctx.message?.text || '').trim().split(/\s+/)[1] || '';

      try {
      await sequelize.authenticate();

      // Resolve promocode from start=promo_CODE before creating user (for InitialGenerations)
      let resolvedPromocode = null;
      const promoPrefix = 'promo_';
      if (startPayload && startPayload.toLowerCase().startsWith(promoPrefix)) {
        const codeInput = startPayload.slice(promoPrefix.length).trim();
        if (codeInput.length > 0) {
          resolvedPromocode = await models.PromoCodes.findOne({
            where: sequelize.where(sequelize.fn('LOWER', sequelize.col('Code')), Op.eq, codeInput.toLowerCase()),
          });
        }
      }

      let user = await models.Users.findOne({ where: { TelegramChatId: chatId } });
      const wasNew = !user;
      let promoBonus = 0;
      if (!user) {
        try {
          const defaultFree = await getGenerationsPerRegistration();
          const initialFree =
            resolvedPromocode?.InitialGenerations != null
              ? Math.max(0, parseInt(resolvedPromocode.InitialGenerations, 10) || 0)
              : defaultFree;
          promoBonus = Math.max(0, initialFree - defaultFree);
          user = await models.Users.create({
            TelegramChatId: chatId,
            TelegramUserName: username,
            DateJoined: Sequelize.literal('GETUTCDATE()'),
            FreeGenerationsRemaining: initialFree,
            Promocode: resolvedPromocode ? resolvedPromocode.Code : null,
          });
        } catch (createErr) {
          if (createErr?.name === 'SequelizeUniqueConstraintError') {
            user = await models.Users.findOne({ where: { TelegramChatId: chatId } });
          } else throw createErr;
        }
      } else if (username != null) {
        await user.update({ TelegramUserName: username });
      }

      // Promocode attribution: if existing user came via promo link and not yet attributed
      if (resolvedPromocode && (!user.Promocode || user.Promocode === '')) {
        await user.update({ Promocode: resolvedPromocode.Code });
      }

      // Referral: start=REFERRER_TELEGRAM_CHAT_ID — invited user is already registered above; link them and notify referrer
      if (startPayload && /^\d+$/.test(startPayload) && String(chatId) !== startPayload) {
        const referrerChatIdNum = Number(startPayload);
        let referrer = null;
        if (Number.isSafeInteger(referrerChatIdNum)) {
          referrer = await models.Users.findOne({ where: { TelegramChatId: referrerChatIdNum } });
        }
        if (!referrer) {
          referrer = await models.Users.findOne({ where: { TelegramChatId: startPayload } });
        }
        if (referrer && referrer.Id !== user.Id) {
          const [ref] = await models.Referrals.findOrCreate({
            where: { ReferrerUserId: referrer.Id, ReferredUserId: user.Id },
            defaults: {
              ReferrerUserId: referrer.Id,
              ReferredUserId: user.Id,
              ReferredAt: new Date(),
              BonusUsed: false,
            },
          });
          const notYetNotified = ref.isNewRecord || ref.ReferrerNotifiedAt == null;
          if (ref && notYetNotified) {
            try {
              const perRef = Math.max(1, await getConfigInt('GenerationsPerReferral', 1));
              const refGenWord = perRef === 1 ? 'генерацию' : (perRef >= 2 && perRef <= 4 ? 'генерации' : 'генераций');
              const referrerChatId = Number(referrer.TelegramChatId) || String(referrer.TelegramChatId);
              const invitedUsername = user.TelegramUserName ? `@${user.TelegramUserName}` : 'Друг';
              const balance = await getAvailableGenerations(referrerChatId);
              const celebration =
                `🎉 По вашей ссылке зарегистрировался ${invitedUsername}!\n\n` +
                `Вам начислено +${perRef} ${refGenWord}.\n` +
                `Сейчас у вас доступно ${balance.total} генераций.`;
              await ctx.telegram.sendMessage(referrerChatId, celebration);
              await ref.update({ ReferrerNotifiedAt: new Date() }).catch(() => {});
            } catch (e) {
              console.error('Notify referrer error:', e?.response?.body ?? e?.message ?? e);
            }
          }
        }
      }

      // Notify user about applied promocode bonus generations (only when it really adds extra)
      if (promoBonus > 0) {
        const genWord =
          promoBonus === 1 ? 'генерацию' : promoBonus >= 2 && promoBonus <= 4 ? 'генерации' : 'генераций';
        await ctx.reply(`Промокод применён: вы получили +${promoBonus} ${genWord}.`);
      }

      if (wasNew) {
        try {
          const totalUsers = await models.Users.count();
          const displayName = username ? `@${username}` : `(id: ${chatId})`;
          const text = `🆕 New user: ${displayName}\nTotal users: ${totalUsers}`;
          for (const adminId of ADMIN_CHAT_IDS) {
            const chatIdForApi = Number(adminId) || adminId;
            try {
              await ctx.telegram.sendMessage(chatIdForApi, text);
            } catch (e) {
              if (e?.response?.description === 'Bad Request: chat not found') {
                console.warn(`Admin notify: chat ${adminId} not found (admin must start the bot first or may have blocked it).`);
              } else {
                console.error('Admin notify error:', e?.response?.body ?? e?.message ?? e);
              }
            }
          }
        } catch (err) {
          console.error('Admin notify error:', err);
        }
      }
      } catch (err) {
        console.error('DB error in /start:', err);
      }

      // Deep link: /start photoset_<configId> → show that photoset directly
      if (startPayload.startsWith('photoset_')) {
        const photosetConfigId = parseInt(startPayload.slice('photoset_'.length), 10);
        if (!isNaN(photosetConfigId)) {
          stopTyping();
          return sendPhotosetCard(ctx, photosetConfigId);
        }
      }

      // Deep link: /start preset_<presetId> → ask user to upload a photo for that preset
      if (startPayload.startsWith('preset_')) {
        const presetId = parseInt(startPayload.slice('preset_'.length), 10);
        if (!isNaN(presetId)) {
          stopTyping();
          return sendPresetCard(ctx, presetId);
        }
      }

      const startImagePath = join(__dirname, '..', 'startimage.jpg');
      const welcomeText =
        'Привет 👋\n\n' +
        'Я Alexa — твой AI-фотограф.\n\n' +
        'Создаю реалистичные, стильные фотосессии, как после съёмки у топового фотографа ✨\n\n' +
        'Я могу:\n\n' +
        '1. Сделать фотосессию на основе готовых шаблонов\n\n' +
        '2. Изменить фотографию или сгенерировать новую картинку по вашей просьбе\n' +
        '— например, загрузи фото и напиши что хочешь: замени фон, улучши качество\n\n' +
        '3. Научить работать с промтами\n\n' +
        'Выбери, что хочешь сделать 👇';
      const startButtons = [
        [{ text: '📸 Ознакомиться с фотосессиями', callback_data: 'start_photosets' }],
        [{ text: '🖼 Изменить или сделать картинку', callback_data: 'start_want_picture' }],
        [{ text: '📘 Научиться работать с промтами', url: 'https://t.me/rabota_5g' }],
      ];
      // remove last button ("Выбрать идею для фото") from /start
      const replyMarkup = {
        reply_markup: { inline_keyboard: startButtons },
      };

      if (existsSync(startImagePath)) {
        return ctx.replyWithPhoto(
          { source: createReadStream(startImagePath) },
          { caption: welcomeText, ...replyMarkup }
        );
      }
      return ctx.reply(welcomeText, replyMarkup);
    } finally {
      stopTyping();
    }
  });

  bot.action('start_photosets', async (ctx) => {
    await ctx.answerCbQuery();
    await sendPhotosetCard(ctx, null);
  });

  bot.action('start_want_picture', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('📸 Пришли в одном сообщении: фотографию и описание того, что нужно с ней сделать.');
  });

  // Temporarily disabled: /ideas command (can be restored later)
  // bot.command('ideas', async (ctx) => {
  //   if (!ideasAppUrl) return ctx.reply('Идеи пока недоступны.');
  //   return ctx.reply('Выбери стиль — откроется галерея. Нажми на картинку, затем отправь своё фото в боте.', {
  //     reply_markup: {
  //       inline_keyboard: [[{ text: '✨ Открыть идеи для фото', web_app: { url: ideasAppUrl } }]],
  //     },
  //   });
  // });

  bot.help(async (ctx) => {
    const stopTyping = startTyping(ctx.telegram, ctx.chat?.id);
    try {
      const text =
        '🔥 Как пользоваться?\n\n' +
        '📸 Просто отправь мне до 3х фото, затем описание, что с ним нужно сделать.\n\n' +
        'Загляните в наш канал, там лучшие стили и промпты:\n' +
        '[👇 Посмотреть идеи](https://t.me/rabota_5g)';
      const helpButtons = [
        [{ text: '🟥 Не нравится результат', callback_data: 'help_dislike_result' }],
        [{ text: '💳 Как оплатить?', callback_data: 'help_how_to_pay' }],
        [{ text: '❗ Не открывается оплата', callback_data: 'help_payment_not_open' }],
        [{ text: '⚙️ Как сменить модель', callback_data: 'help_change_model' }],
      ];
      // no "Идеи для фото" button on /help (keeps help screen focused)
      helpButtons.push([{ text: 'Остались вопросы? ➢', url: 'https://t.me/nariman_ovv' }]);
      const replyMarkup = {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: helpButtons },
      };
      return await ctx.reply(text, replyMarkup);
    } finally {
      stopTyping();
    }
  });

  bot.action('help_dislike_result', async (ctx) => {
    await ctx.answerCbQuery();
    const text =
      '🟥 Результат не понравился?\n\n' +
      'Нейросеть опирается на исходные фотографии и ваш текстовый запрос — мы не можем влиять на результат вручную 😅\n\n' +
      'Важно учитывать:\n' +
      '▪️ Качество и ракурс исходного фото напрямую влияют на итог (лицо должно быть чётко видно, хорошее освещение, без очков и сильных поворотов).\n' +
      '▪️ Чем проще промт и меньше изменений (макияж, причёска, поза), тем более естественным будет результат.\n' +
      '▪️ Один и тот же запрос может дать разные кадры — каждая генерация уникальна 😊\n\n' +
      'Совет: попробуйте уточнить запрос и повторить генерацию — это часто заметно улучшает результат ✨';
    await ctx.reply(text);
  });

  bot.action('help_how_to_pay', async (ctx) => {
    const stopTyping = startTyping(ctx.telegram, ctx.chat?.id);
    try {
      if (ctx.callbackQuery) await ctx.answerCbQuery();
      await ctx.reply('Выбери удобный способ оплаты ниже 👇', {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🤝 Пригласить друзей и получить бонусы', callback_data: 'pay_referrals' }
            ],
            [
              { text: 'Оплатить звездами ⭐', callback_data: 'pay_stars_show' },
            ],
          ],
        },
      });
    } finally {
      stopTyping();
    }
  });

  bot.action('help_payment_not_open', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      'Если окно оплаты не открывается, попробуй обновить приложение Telegram или оплатить с другого устройства. Если проблема сохраняется — напиши нам: @nariman_ovv'
    );
  });

  bot.action('help_change_model', async (ctx) => {
    await sendModelScreen(ctx);
  });

  bot.command('account', async (ctx) => {
    const stopTyping = startTyping(ctx.telegram, ctx.chat?.id);
    try {
      const chatId = ctx.chat?.id;
      const user = await models.Users.findOne({ where: { TelegramChatId: chatId } });
      if (!user) {
        return ctx.reply('Сначала отправь /start.');
      }
      const { total: remaining, totalEver } = await getAvailableGenerations(chatId);
      const invitedCount = await models.Referrals.count({
        where: { ReferrerUserId: user.Id },
      });
      const totalDisplay = Math.max(totalEver, remaining, 1);
      const text =
        '*Ваш профиль Alexa*\n\n' +
        '🖼️ Генераций:\n' +
        `— Осталось ${remaining} из ${totalDisplay}\n\n` +
        `🤝 Приглашено друзей: ${invitedCount}`;
      await ctx.reply(text, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🤝 Пригласить друзей и получить бонусы', callback_data: 'pay_referrals' }],
            [{ text: 'Докупить генерации 🏆', callback_data: 'pay_menu' }],
          ],
        },
      });
    } finally {
      stopTyping();
    }
  });

  // —— Model: choose active image generation model ——
  async function sendModelScreen(ctx) {
    const stopTyping = startTyping(ctx.telegram, ctx.chat?.id);
    try {
      if (ctx.callbackQuery) await ctx.answerCbQuery();
      const chatId = ctx.chat?.id;
    const user = await models.Users.findOne({ where: { TelegramChatId: chatId } });
    const currentId = user?.ActiveModel || DEFAULT_MODEL_ID;
    const text = IMAGE_MODELS.map((m) => m.description).join('\n\n');
    const buttons = [
      [
        {
          text: (currentId === 'standard' ? '✅ ' : '') + 'Standard ✨',
          callback_data: 'model_standard',
        },
        {
          text: (currentId === 'pro' ? '✅ ' : '') + 'PRO 😎',
          callback_data: 'model_pro',
        },
      ],
      [
        {
          text: (currentId === 'nano_banana_2' ? '✅ ' : '') + 'Nano Banana 2 🤠',
          callback_data: 'model_nano_banana_2',
        },
        {
          text: (currentId === 'seedream' ? '✅ ' : '') + 'Seedream 4.5 🧠',
          callback_data: 'model_seedream',
        },
      ],
    ];
      if (ctx.callbackQuery && ctx.callbackQuery.message) {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          ctx.callbackQuery.message.message_id,
          null,
          text,
          {
            reply_markup: { inline_keyboard: buttons },
          }
        );
      } else {
        await ctx.reply(text, { reply_markup: { inline_keyboard: buttons } });
      }
    } finally {
      stopTyping();
    }
  }

  bot.command('model', sendModelScreen);
  bot.action(/^model_(.+)$/, async (ctx) => {
    const stopTyping = startTyping(ctx.telegram, ctx.chat?.id);
    try {
      const modelId = ctx.match[1];
      if (!IMAGE_MODELS.some((m) => m.id === modelId)) return ctx.answerCbQuery();
      let user = await models.Users.findOne({ where: { TelegramChatId: ctx.chat.id } });
    if (!user) {
      try {
        const initialFree = await getGenerationsPerRegistration();
        user = await models.Users.create({
          TelegramChatId: ctx.chat.id,
          TelegramUserName: ctx.from?.username ?? null,
          DateJoined: Sequelize.literal('GETUTCDATE()'),
          ActiveModel: modelId,
          FreeGenerationsRemaining: initialFree,
        });
      } catch (e) {
        if (e?.name === 'SequelizeUniqueConstraintError') {
          user = await models.Users.findOne({ where: { TelegramChatId: ctx.chat.id } });
          if (user) await user.update({ ActiveModel: modelId });
        }
      }
    } else {
      await user.update({ ActiveModel: modelId });
    }
      await sendModelScreen(ctx);
    } finally {
      stopTyping();
    }
  });

  // —— Admin: secret command; only responds to ADMIN_CHAT_IDS ——
  bot.command('admin', async (ctx) => {
    const chatId = String(ctx.chat?.id);
    if (!ADMIN_CHAT_IDS.includes(chatId)) return;
    const appUrl = `${(process.env.ADMIN_APP_URL || config.webhookUrl).replace(/\/$/, '')}/admin`;
    await ctx.reply('🔧 Admin Panel', {
      reply_markup: {
        inline_keyboard: [[{ text: '🔧 Открыть Admin Panel', web_app: { url: appUrl } }]],
      },
    });
  });

  // —— Stats: hidden command for founders; opens Mini App with graphs ——
  bot.command('stat', async (ctx) => {
    const chatId = String(ctx.chat?.id);
    if (!ADMIN_CHAT_IDS.includes(chatId)) return;
    const appUrl = `${(process.env.ADMIN_APP_URL || config.webhookUrl).replace(/\/$/, '')}/stat`;
    await ctx.reply('Statistics', {
      reply_markup: {
        inline_keyboard: [[{ text: 'Open Stats', web_app: { url: appUrl } }]],
      },
    });
  });

  // —— Admin: fully remove user by chatId from all tables ——
  bot.command('removeuser', async (ctx) => {
    const adminChatId = String(ctx.chat?.id);
    if (!ADMIN_CHAT_IDS.includes(adminChatId)) return;
    const text = ctx.message?.text?.trim() || '';
    const match = text.match(/^\/removeuser\s+(\S+)$/i);
    const targetChatId = match?.[1];
    if (!targetChatId) {
      await ctx.reply('Usage: /removeuser <chatId>\nExample: /removeuser 123456789');
      return;
    }
    const result = await removeUserFullyByChatId(targetChatId);
    if (result.ok) {
      const d = result.deleted;
      await ctx.reply(
        `✅ User ${targetChatId} fully removed.\n` +
          `Deleted: User(1), GenerationAudits(${d.generationAudits ?? 0}), UserImageGenerations(${d.userImageGenerations ?? 0}), ` +
          `UserPurchases(${d.userPurchases ?? 0}), TelegramPayments(${d.telegramPayments ?? 0}), ` +
          `Referrals(as referrer + as referred: ${(d.referralsAsReferrer ?? 0) + (d.referralsAsReferred ?? 0)}), UserPhotosets(${d.userPhotosets ?? 0}).`
      );
    } else {
      await ctx.reply(`❌ Failed: ${result.error}`);
    }
  });

  // —— Photosets: show presets-based photoshoot ideas and create photoset ——
  const pendingPhotosets = new Map(); // chatId -> { configId }
  const pendingPresets = new Map();   // chatId -> { presetId }
  const pendingPhotosetPreviews = new Map(); // chatId -> { configId }

  function buildPhotosetKeyboard(configs, index) {
    const count = configs.length;
    const current = configs[index];
    const prevIndex = (index - 1 + count) % count;
    const nextIndex = (index + 1) % count;
    const keyboard = [
      [
        {
          text: '⬅️',
          callback_data: `photoset_prev_${configs[prevIndex].Id}`,
        },
        {
          text: '➡️',
          callback_data: `photoset_next_${configs[nextIndex].Id}`,
        },
      ],
      [
        {
          text: 'Предпросмотр результата',
          callback_data: `photoset_preview_${current.Id}`,
        },
      ],
      [
        {
          text: 'Выбрать фотосессию',
          callback_data: `photoset_create_${current.Id}`,
        },
      ],
    ];
    return { current, keyboard };
  }

  async function showPhotosetCard(ctx, configs, index, mode) {
    const { current, keyboard } = buildPhotosetKeyboard(configs, index);
    const caption = `${current.Name}\n\n${current.Description}`;
    const coverBuffer = current.Image ? await downloadBlobBuffer(`PhotosetCovers/${current.Image}`) : null;

    if (mode === 'edit' && ctx.callbackQuery?.message) {
      const chatId = ctx.chat.id;
      const messageId = ctx.callbackQuery.message.message_id;
      if (coverBuffer) {
        await ctx.telegram.editMessageMedia(
          chatId,
          messageId,
          undefined,
          {
            type: 'photo',
            media: { source: coverBuffer, filename: current.Image },
            caption,
          },
          {
            reply_markup: { inline_keyboard: keyboard },
          }
        );
      } else {
        await ctx.telegram.editMessageText(chatId, messageId, undefined, caption, {
          reply_markup: { inline_keyboard: keyboard },
        });
      }
    } else {
      if (coverBuffer) {
        await ctx.replyWithPhoto(
          { source: coverBuffer, filename: current.Image },
          {
            caption,
            reply_markup: { inline_keyboard: keyboard },
          }
        );
      } else {
        await ctx.reply(caption, {
          reply_markup: { inline_keyboard: keyboard },
        });
      }
    }
  }

  async function sendPresetCard(ctx, presetId) {
    const stopTyping = startTyping(ctx.telegram, ctx.chat?.id);
    try {
      const preset = await models.Presets.findByPk(presetId);
      if (!preset) {
        return ctx.reply('Этот пресет недоступен. Попробуй другой.');
      }
      const chatId = ctx.chat.id;
      pendingPresets.set(chatId, { presetId });
      const text = 'Отправь фото — я создам изображение в выбранном стиле.';
      const imageBuffer = preset.Image
        ? await downloadBlobBuffer(`PresetImages/${preset.Image}`)
        : null;
      if (imageBuffer) {
        await ctx.replyWithPhoto(
          { source: imageBuffer, filename: preset.Image },
          { caption: text }
        );
      } else {
        await ctx.reply(text);
      }
    } finally {
      stopTyping();
    }
  }

  async function runPresetGeneration(ctx, imageParts, presetId) {
    const chatId = ctx.chat.id;
    const preset = await models.Presets.findByPk(presetId);
    if (!preset) {
      await ctx.reply('Этот пресет больше недоступен.');
      return;
    }
    const prompt = preset.Prompt;
    const { total } = await getAvailableGenerations(chatId);
    if (total < 1) {
      const msg = await getNoGenerationsMessage();
      await ctx.reply(msg, noGenerationsReplyMarkup);
      return;
    }
    const stopTyping = startTyping(ctx.telegram, chatId);
    const processingMsg = await ctx.reply('📸 Создаю изображение по выбранному стилю...');
    try {
      const modelId = await getGeminiModelForUser(chatId);
      let user = await models.Users.findOne({ where: { TelegramChatId: chatId } });
      if (!user) {
        try {
          const initialFree = await getGenerationsPerRegistration();
          user = await models.Users.create({
            TelegramChatId: chatId,
            TelegramUserName: ctx.from?.username ?? null,
            DateJoined: Sequelize.literal('GETUTCDATE()'),
            FreeGenerationsRemaining: initialFree,
          });
        } catch (e) {
          if (e?.name === 'SequelizeUniqueConstraintError') {
            user = await models.Users.findOne({ where: { TelegramChatId: chatId } });
          } else {
            throw e;
          }
        }
      }
      const requestId = randomUUID();
      const { requestDir, responseDir } = await ensureMediaDirs(chatId, requestId);
      const attachedNames = [];
      for (let i = 0; i < imageParts.length; i++) {
        const part = imageParts[i];
        const ext = part.mimeType === 'image/png' ? 'png' : 'jpg';
        const name = `${requestId}_att_${i + 1}.${ext}`;
        await writeBufferToFile(part.buffer, join(requestDir, name));
        attachedNames.push(name);
      }
      let auditId = null;
      try {
        auditId = await createGenerationAudit(
          chatId, user.Id, prompt, requestId, attachedNames.join(','), null
        );
      } catch (e) {
        console.error('Audit create for preset:', e);
      }
      const images = await imagesAndTextToImage(imageParts, prompt, modelId);
      if (!images || images.length === 0) {
        await updateGenerationAuditError(auditId, 'No image in response (preset)');
        await ctx.telegram.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
        await ctx.reply('Не удалось создать изображение. Попробуй ещё раз.');
        return;
      }
      const fileName = `${requestId}_result.png`;
      await writeBufferToFile(images[0], join(responseDir, fileName));
      await updateGenerationAuditSuccess(auditId, fileName);
      await ctx.telegram.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
      await ctx.replyWithPhoto({ source: images[0], filename: 'image.png' });
      await consumeWithDailyBonus(chatId, 1);
      await recordImageGenerations(chatId, 1);
    } catch (err) {
      console.error('Preset generation error:', err);
      await updateGenerationAuditError(auditId, err?.message ?? String(err));
      const presetErrText = err?.message?.includes('SAFETY') ? safetyBlockMessage : 'Не удалось обработать изображение. Попробуй ещё раз.';
      await ctx.telegram
        .editMessageText(chatId, processingMsg.message_id, null, presetErrText)
        .catch(() => {});
    } finally {
      stopTyping();
    }
  }

  async function getPhotosetCarouselConfigs(selectedConfigId = null) {
    const configsDesc = await models.PhotosetConfigs.findAll({
      order: [['Id', 'DESC']],
    });

    if (!configsDesc || configsDesc.length === 0) return { configs: [], index: 0 };
    const configs = configsDesc;
    let index = 0; // start from latest Id by default

    if (selectedConfigId != null) {
      const foundIndex = configs.findIndex((c) => c.Id === selectedConfigId);
      if (foundIndex >= 0) {
        index = foundIndex;
      } else {
        const explicit = await models.PhotosetConfigs.findByPk(selectedConfigId);
        if (explicit) {
          configs.unshift(explicit);
          index = 0;
        }
      }
    }

    return { configs, index };
  }

  async function sendPhotosetCard(ctx, configId = null) {
    const stopTyping = startTyping(ctx.telegram, ctx.chat?.id);
    try {
      const { configs, index } = await getPhotosetCarouselConfigs(configId);
      if (!configs || configs.length === 0) {
        return ctx.reply('Фотосеты скоро появятся — мы готовим для тебя лучшие подборки.');
      }
      await showPhotosetCard(ctx, configs, index, 'reply');
    } finally {
      stopTyping();
    }
  }

  bot.command('photosets', async (ctx) => {
    await sendPhotosetCard(ctx, null);
  });

  bot.action(/^photoset_(prev|next)_(\d+)$/, async (ctx) => {
    const stopTyping = startTyping(ctx.telegram, ctx.chat?.id);
    try {
      const targetId = parseInt(ctx.match[2], 10);
      if (ctx.callbackQuery) await ctx.answerCbQuery();
      const { configs } = await getPhotosetCarouselConfigs(null);
      if (!configs || configs.length === 0) {
        return ctx.reply('Фотосеты скоро появятся — мы готовим для тебя лучшие подборки.');
      }
      const index = configs.findIndex((c) => c.Id === targetId);
      if (index === -1) {
        return sendPhotosetCard(ctx, null);
      }
      await showPhotosetCard(ctx, configs, index, 'edit');
    } finally {
      stopTyping();
    }
  });

  bot.action(/^photoset_create_(\d+)$/, async (ctx) => {
    const stopTyping = startTyping(ctx.telegram, ctx.chat?.id);
    try {
      if (ctx.callbackQuery) await ctx.answerCbQuery();
      const configId = parseInt(ctx.match[1], 10);
      const chatId = ctx.chat?.id;
      const configRow = await models.PhotosetConfigs.findByPk(configId);
      if (!configRow) {
        return ctx.reply('Этот фотосет больше недоступен. Попробуй выбрать другой.');
      }

      const photosetsCount = await models.Photosets.count({
        where: { PhotosetConfigId: configId },
      });
      if (photosetsCount === 0) {
        return ctx.reply('Для этого фотосета ещё не настроены промпты. Скоро добавим.');
      }

      pendingPhotosetPreviews.delete(chatId);
      pendingPhotosets.set(chatId, { configId });
      await ctx.reply(
        'Отправь одну или несколько исходных фото людей одним сообщением. Я использую их как основу для этого фотосета.'
      );
    } finally {
      stopTyping();
    }
  });

  bot.action(/^photoset_preview_(\d+)$/, async (ctx) => {
    const stopTyping = startTyping(ctx.telegram, ctx.chat?.id);
    try {
      if (ctx.callbackQuery) await ctx.answerCbQuery();
      const configId = parseInt(ctx.match[1], 10);
      const chatId = ctx.chat?.id;
      const configRow = await models.PhotosetConfigs.findByPk(configId);
      if (!configRow) {
        return ctx.reply('Этот фотосет больше недоступен. Попробуй выбрать другой.');
      }
      const photosetsCount = await models.Photosets.count({
        where: { PhotosetConfigId: configId },
      });
      pendingPhotosets.delete(chatId);
      pendingPresets.delete(chatId);
      pendingPhotosetPreviews.set(chatId, { configId });
      await ctx.reply(
        '🔎 Предпросмотр результата\n\n' +
          'Отправь одну или несколько исходных фото людей одним сообщением. Я использую их как основу для этого фотосета.'
      );
    } finally {
      stopTyping();
    }
  });

  // —— Pay: show payment method options ——
  bot.command(['pay', 'buy'], async (ctx) => {
    const stopTyping = startTyping(ctx.telegram, ctx.chat?.id);
    try {
      await ctx.reply(
        'Выбери удобный способ оплаты ниже 👇',
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🤝 Пригласить друзей и получить бонусы', callback_data: 'pay_referrals' }
            ],
            [
              { text: 'Оплатить звездами ⭐', callback_data: 'pay_stars_show' },
            ],
          ],
        },
      }
      );
    } finally {
      stopTyping();
    }
  });

  // —— Inline: "Докупить генерации" from account → show same pay options as /pay ——
  bot.action('pay_menu', async (ctx) => {
    const stopTyping = startTyping(ctx.telegram, ctx.chat?.id);
    try {
      if (ctx.callbackQuery) await ctx.answerCbQuery();
      await ctx.reply('Выбери удобный способ оплаты ниже 👇', {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🤝 Пригласить друзей и получить бонусы', callback_data: 'pay_referrals' }
            ],
            [
              { text: 'Оплатить звездами ⭐', callback_data: 'pay_stars_show' },
            ],
          ],
        },
      });
    } finally {
      stopTyping();
    }
  });

  // —— Inline: "Оплатить звездами" → show packages (text + package buttons) ——
  bot.action('pay_stars_show', async (ctx) => {
    const stopTyping = startTyping(ctx.telegram, ctx.chat?.id);
    try {
      await ctx.answerCbQuery();
      const pricings = await models.Pricings.findAll({
      where: { PriceInStars: { [Op.ne]: null } },
      order: [['SortOrder', 'ASC']],
    });
      if (pricings.length === 0) {
        return ctx.reply('Пакеты с оплатой звёздами временно недоступны.');
      }
      const intro =
      'Твоя идеальная съемка за 1 минуту\n' +
      'Фотографии, которыми хочется делиться\n\n' +
      '◆ Создавай виральный контент за минуты\n' +
      '◆ Забудь про обработку: идеальный свет и кожа на каждом кадре\n' +
      '◆ Выгляди на миллион: премиальные образы без затрат на стилистов\n' +
      '◆ Разовая оплата, без подписок и автоматических списаний\n\n' +
      'Осуществляя платеж с использованием платежного сервиса, вы соглашаетесь с условиями оферты. Сделать возврат можно написав в поддержку @nariman_ovv';
      const buttons = pricings.map((p) => [
        {
          text: `${p.GenerationsCount} генераций – ${p.PriceInStars} ⭐${p.PriceUSD ? ` (~${p.PriceUSD} USD)` : ''}`,
          callback_data: `pay_stars_${p.Id}`,
        },
      ]);
      await ctx.reply(intro, {
        reply_markup: { inline_keyboard: buttons },
      });
    } finally {
      stopTyping();
    }
  });

  // —— Inline: package chosen → send Telegram Stars invoice ——
  bot.action(/^pay_stars_(\d+)$/, async (ctx) => {
    const stopTyping = startTyping(ctx.telegram, ctx.chat?.id);
    try {
      const pricingId = parseInt(ctx.match[1], 10);
      await ctx.answerCbQuery();
      const pricing = await models.Pricings.findByPk(pricingId);
      if (!pricing || pricing.PriceInStars == null || pricing.PriceInStars < 1) {
        return ctx.reply('Этот пакет недоступен для оплаты звёздами.');
      }
      const payload = JSON.stringify({ pricingId: pricing.Id });
      const usdSuffix = pricing.PriceUSD ? ` (~${pricing.PriceUSD})` : '';
      const title = `${pricing.Name} – ${pricing.GenerationsCount} генераций${usdSuffix}`;
      const description = `Пакет «${pricing.Name}»: ${pricing.GenerationsCount} генераций изображений. Оплата Telegram Stars.${usdSuffix ? ` Примерно ${pricing.PriceUSD}.` : ''}`;
      try {
        await ctx.telegram.sendInvoice(ctx.chat.id, {
          title,
          description,
          payload,
          provider_token: '', // empty for Telegram Stars (XTR)
          currency: 'XTR',
          prices: [{ label: `${pricing.GenerationsCount} генераций`, amount: pricing.PriceInStars }],
        });
      } catch (err) {
        const msg = err?.response?.body?.description ?? err?.message ?? String(err);
        console.error('Send invoice error:', msg, err);
        await ctx.reply(
          `Не удалось создать счёт. Попробуй позже.${msg ? ` (${msg})` : ''}`
        );
      }
    } finally {
      stopTyping();
    }
  });

  // —— Other pay actions (placeholders) ——
  bot.action('pay_show_packages', async (ctx) => {
    const stopTyping = startTyping(ctx.telegram, ctx.chat?.id);
    try {
      await ctx.answerCbQuery();
      await ctx.reply('Выбери «Оплатить звездами ⭐» ниже, чтобы увидеть пакеты.');
    } finally {
      stopTyping();
    }
  });
  bot.action('pay_in_bot', async (ctx) => {
    const stopTyping = startTyping(ctx.telegram, ctx.chat?.id);
    try {
      await ctx.answerCbQuery();
      await ctx.reply('Оплата в боте будет доступна в следующей версии.');
    } finally {
      stopTyping();
    }
  });
  // —— Referral program: stats, personal link, "Invite friend" (t.me/share url) ——
  async function sendReferralScreen(ctx) {
    const stopTyping = startTyping(ctx.telegram, ctx.chat?.id);
    try {
      if (ctx.callbackQuery) await ctx.answerCbQuery();
      const chatId = ctx.chat?.id;
      const user = await models.Users.findOne({ where: { TelegramChatId: chatId } });
      const generationsPerReferral = Math.max(1, await getConfigInt('GenerationsPerReferral', 1));
      const enableBonusGens = (await getConfigInt('EnableReferralBonusGenerations', 1)) !== 0;
      const invited = user
        ? await models.Referrals.count({ where: { ReferrerUserId: user.Id } })
        : 0;
      const bonusesReceived = invited * generationsPerReferral;
      const referralLink =
        botUsername && chatId
          ? `https://t.me/${botUsername}?start=${chatId}`
          : '(настрой BOT_USERNAME)';

      const REFERRAL_TEMPLATE =
        'Привет\nЕсли хочешь сделать фотосессию через искусственный интеллект, рекомендую этого бота. В ссылке промокод на бонусы.';
      // Телеграм сам подставляет ссылку из параметра url в первую строку сообщения,
      // поэтому в text отправляем только описание, без повторной ссылки.
      const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(
        referralLink
      )}&text=${encodeURIComponent(REFERRAL_TEMPLATE)}`;

      const genWord =
        generationsPerReferral === 1
          ? 'генерацию'
          : generationsPerReferral >= 2 && generationsPerReferral <= 4
          ? 'генерации'
          : 'генераций';

      const earnings = user ? await getReferralEarningsSummary(user.Id) : null;
      const minPayoutUsdCents = 1000;

      const parts = [];
      parts.push('Приглашение пользователей даёт 2 вещи:\n');
      parts.push('1. Бесплатную фотосессию за каждого приглашенного пользователя.\n');
      parts.push('2. Реальные деньги — да, мы делимся доходом\n');
      parts.push('— 30% с оплат приглашённых пользователей');
      parts.push('— 20% с оплат тех, кого пригласили те, кого пригласил ты\n');
      parts.push('Выплаты:');
      parts.push(`— Минимум для снятия: ${formatUsdCents(minPayoutUsdCents)}`);
      parts.push('— Перевод на карту (занимает до 48 часов)\n');
      parts.push('Текущий баланс');
      parts.push(`— Доступно: ${formatUsdCents(earnings?.available || 0)}`);
      parts.push(`— Выплачено: ${formatUsdCents(earnings?.paid || 0)}`);
      parts.push('');
      parts.push('Приглашай друзей по персональной ссылке');
      parts.push(referralLink);

      const text = parts.join('\n');

      const inline_keyboard = [
        [
          {
            text: '🔥 Пригласить друга',
            url: shareUrl,
          },
        ],
      ];
      if (user) {
        inline_keyboard.push([{ text: '💸 Запросить выплату', callback_data: 'withdraw_request' }]);
      }

      await ctx.reply(text, {
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard,
        },
      });
    } finally {
      stopTyping();
    }
  }

  bot.command('referrals', sendReferralScreen);
  bot.action('pay_referrals', sendReferralScreen);
  bot.command('withdraw', async (ctx) => {
    const stopTyping = startTyping(ctx.telegram, ctx.chat?.id);
    try {
      const chatId = ctx.chat?.id;
      const user = await models.Users.findOne({ where: { TelegramChatId: chatId } });
      if (!user) return ctx.reply('Сначала отправь /start.');
      const minPayoutUsdCents = 1000;
      const res = await requestPayoutForUser(user.Id, minPayoutUsdCents);
      if (res.ok) {
        return ctx.reply(
          `✅ Заявка на выплату принята.\nСумма: ${formatUsdCents(res.requestedUsdCents)}\nСрок обработки: до 48 часов.`
        );
      }
      if (res.error === 'Already requested') {
        return ctx.reply('⏳ Заявка уже отправлена. Мы обработаем её в течение 48 часов.');
      }
      if (res.error === 'Below minimum') {
        return ctx.reply(
          `Минимальная сумма для выплаты: ${formatUsdCents(res.minUsdCents)}.\n` +
            `Сейчас доступно: ${formatUsdCents(res.availableUsdCents)}.`
        );
      }
      return ctx.reply('Не удалось создать заявку. Попробуй позже.');
    } finally {
      stopTyping();
    }
  });

  bot.action('withdraw_request', async (ctx) => {
    const stopTyping = startTyping(ctx.telegram, ctx.chat?.id);
    try {
      if (ctx.callbackQuery) await ctx.answerCbQuery();
      const chatId = ctx.chat?.id;
      const user = await models.Users.findOne({ where: { TelegramChatId: chatId } });
      if (!user) return ctx.reply('Сначала отправь /start.');
      const minPayoutUsdCents = 1000;
      const res = await requestPayoutForUser(user.Id, minPayoutUsdCents);
      if (res.ok) {
        return ctx.reply(
          `✅ Заявка на выплату принята.\nСумма: ${formatUsdCents(res.requestedUsdCents)}\nСрок обработки: до 48 часов.`
        );
      }
      if (res.error === 'Already requested') {
        return ctx.reply('⏳ Заявка уже отправлена. Мы обработаем её в течение 48 часов.');
      }
      if (res.error === 'Below minimum') {
        return ctx.reply(
          `Минимальная сумма для выплаты: ${formatUsdCents(res.minUsdCents)}.\n` +
            `Сейчас доступно: ${formatUsdCents(res.availableUsdCents)}.`
        );
      }
      return ctx.reply('Не удалось создать заявку. Попробуй позже.');
    } finally {
      stopTyping();
    }
  });

  // —— Pre-checkout: confirm payment ——
  bot.on('pre_checkout_query', async (ctx) => {
    await ctx.answerPreCheckoutQuery(true);
  });

  // —— Successful payment: create TelegramPayment + UserPurchase ——
  bot.on('successful_payment', async (ctx) => {
    const payment = ctx.message.successful_payment;
    const telegramPaymentChargeId = payment.telegram_payment_charge_id;
    let payload;
    try {
      payload = JSON.parse(payment.invoice_payload || '{}');
    } catch {
      console.error('Invalid invoice_payload:', payment.invoice_payload);
      return;
    }
    const pricingId = payload.pricingId;
    if (!pricingId) {
      console.error('Missing pricingId in payload:', payment.invoice_payload);
      return;
    }
    const pricing = await models.Pricings.findByPk(pricingId);
    if (!pricing) {
      console.error('Pricing not found:', pricingId);
      return;
    }
    const chatId = ctx.chat.id;
    let user = await models.Users.findOne({ where: { TelegramChatId: chatId } });
    if (!user) {
      try {
        const initialFree = await getGenerationsPerRegistration();
        user = await models.Users.create({
          TelegramChatId: chatId,
          TelegramUserName: ctx.from?.username ?? null,
          DateJoined: Sequelize.literal('GETUTCDATE()'),
          FreeGenerationsRemaining: initialFree,
        });
      } catch (e) {
        if (e?.name === 'SequelizeUniqueConstraintError') {
          user = await models.Users.findOne({ where: { TelegramChatId: chatId } });
        } else throw e;
      }
    }
    const existing = await models.TelegramPayments.findOne({
      where: { TelegramPaymentChargeId: telegramPaymentChargeId },
    });
    if (existing) {
      await ctx.reply('Оплата уже зачислена. Генерации доступны.');
      return;
    }
    const paidAt = new Date();
    const telegramPayment = await models.TelegramPayments.create({
      UserId: user.Id,
      PricingId: pricing.Id,
      TelegramPaymentChargeId: telegramPaymentChargeId,
      ProviderPaymentChargeId: payment.provider_payment_charge_id || null,
      InvoicePayload: payment.invoice_payload || '',
      StarsAmount: payment.total_amount,
      Currency: payment.currency || 'XTR',
      Status: 'completed',
      PaidAt: paidAt,
    });
    await models.UserPurchases.create({
      UserId: user.Id,
      PricingId: pricing.Id,
      PurchasedAt: paidAt,
      GenerationsIncluded: pricing.GenerationsCount,
      BalanceRemaining: pricing.GenerationsCount,
      TelegramPaymentId: telegramPayment.Id,
    });

    // Referral revenue-share (2-level). Commissions are held for 48h before becoming available.
    try {
      await createCommissionEarnings({
        buyerUserId: user.Id,
        telegramPaymentId: telegramPayment.Id,
        pricing,
        paidAtUtc: paidAt,
      });
    } catch (e) {
      console.error('createCommissionEarnings error:', e?.message ?? e);
    }

    await ctx.reply(
      `✅ Оплата получена! Зачислено ${pricing.GenerationsCount} генераций. Можешь создавать изображения.`
    );
  });

  /** User-facing message when Gemini blocks due to safety/policy (e.g. sexual content). */
  const safetyBlockMessage =
    'Запрос заблокирован фильтрами безопасности. Попробуй другое описание или другое фото.';

  async function getNoGenerationsMessage() {
    const generationsPerReferral = Math.max(1, await getConfigInt('GenerationsPerReferral', 1));
    const genWord =
      generationsPerReferral === 1
        ? 'генерацию'
        : generationsPerReferral >= 2 && generationsPerReferral <= 4
        ? 'генерации'
        : 'генераций';
    return (
      '⛔️ Ты использовал все бесплатные генерации\n\n' +
      'Каждая картинка стоит нам реальных денег 💸\n\n' +
      `🤝 Приведи друга — за каждого приглашённого друга тебе начислят ${generationsPerReferral} ${genWord}. Поделись ссылкой из раздела «Бонусы за друзей» (/referrals).\n\n` +
      '💎 Докупить генерации'
    );
  }

  const noGenerationsReplyMarkup = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🤝 Приведи друга', callback_data: 'pay_referrals' }],
        [{ text: 'Докупить генерации 🏆', callback_data: 'pay_menu' }],        
      ],
    },
  };

  // Text message → text-to-image
  bot.on('text', async (ctx) => {
    if (!ctx.chat?.id) return;
    const prompt = ctx.message.text.trim();
    if (!prompt) return ctx.reply('Опиши, какую картинку нужно сгенерировать.');

    const needed = config.maxImagesPerRequest;
    const { total } = await getAvailableGenerations(ctx.chat.id);
    if (total < needed) {
      const msg = await getNoGenerationsMessage();
      return ctx.reply(msg, noGenerationsReplyMarkup);
    }

    const stopTyping = startTyping(ctx.telegram, ctx.chat.id);
    const msg = await ctx.reply('⏳ Генерирую изображение...');
    const modelId = await getGeminiModelForUser(ctx.chat.id);
    const requestId = randomUUID();
    const user = await models.Users.findOne({ where: { TelegramChatId: ctx.chat.id } });
    let auditId = null;
    try {
      auditId = await createGenerationAudit(ctx.chat.id, user?.Id ?? null, prompt, requestId, null);
      await ensureMediaDirs(ctx.chat.id, requestId);
    } catch (e) {
      console.error('Audit create:', e);
    }
    try {
      const images = await generateImagesFromText(prompt, Math.min(needed, config.maxImagesPerRequest), modelId);
      if (images.length === 0) {
        await updateGenerationAuditError(auditId, 'No image in response');
        await ctx.telegram.editMessageText(
          ctx.chat.id, msg.message_id, null,
          'Изображение не создано. Попробуй другой запрос.'
        );
        return;
      }
      const { responseDir } = await ensureMediaDirs(ctx.chat.id, requestId);
      const resultNames = images.map((_, i) =>
        images.length > 1 ? `${requestId}_result_${i + 1}.png` : `${requestId}_result.png`
      );
      await Promise.all(images.map((img, i) => writeBufferToFile(img, join(responseDir, resultNames[i]))));
      await updateGenerationAuditSuccess(auditId, resultNames.join(','));
      await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id);
      for (const buffer of images) {
        await ctx.replyWithPhoto({ source: buffer, filename: 'image.png' });
      }
      await consumeGenerations(ctx.chat.id, images.length);
      await recordImageGenerations(ctx.chat.id, images.length);
    } catch (err) {
      console.error('Text-to-image error:', err);
      await updateGenerationAuditError(auditId, err?.message ?? String(err));
      const text = err?.message?.includes('SAFETY')
        ? safetyBlockMessage
        : 'Что-то пошло не так. Попробуй ещё раз.';
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, text).catch(() => {});
    } finally {
      stopTyping();
    }
  });

  // Photoset generation helper: reuse uploaded images as references for all prompts in the set
  async function runPhotosetGeneration(ctx, imageParts, configId) {
    const chatId = ctx.chat.id;

    const photosets = await models.Photosets.findAll({
      where: { PhotosetConfigId: configId },
      include: [{ model: models.Presets }],
      order: [['Id', 'ASC']],
    });
    const prompts = photosets
      .map((p) => p.Preset?.Prompt)
      .filter((p) => typeof p === 'string' && p.trim().length > 0);

    if (prompts.length === 0) {
      await ctx.reply('Для этого фотосета ещё не настроены промпты. Скоро добавим.');
      return;
    }

    const { total } = await getAvailableGenerations(chatId);
    const needed = prompts.length;
    if (total < needed) {
      const msg = await getNoGenerationsMessage();
      await ctx.reply(msg, noGenerationsReplyMarkup);
      return;
    }

    const stopTyping = startTyping(ctx.telegram, chatId);
    const processingMsg = await ctx.reply('📸 Создаю фотосессию по выбранному стилю...');

    try {
      const modelId = await getGeminiModelForUser(chatId);
      let user = await models.Users.findOne({ where: { TelegramChatId: chatId } });
      if (!user) {
        try {
          const initialFree = await getGenerationsPerRegistration();
          user = await models.Users.create({
            TelegramChatId: chatId,
            TelegramUserName: ctx.from?.username ?? null,
            DateJoined: Sequelize.literal('GETUTCDATE()'),
            FreeGenerationsRemaining: initialFree,
          });
        } catch (e) {
          if (e?.name === 'SequelizeUniqueConstraintError') {
            user = await models.Users.findOne({ where: { TelegramChatId: chatId } });
          } else {
            throw e;
          }
        }
      }

      let generatedCount = 0;

      for (const row of photosets) {
        const prompt = row.Preset?.Prompt;
        if (!prompt) continue;
        const photosetRetouchPrompt =
          prompt +
          '\n\n' +
          'Дополнительная обработка лица: аккуратно убери припухлости, мелкие раны и покраснения кожи естественным способом, ' +
          'как это делает профессиональный фотограф при ретуши. Сохрани естественность, текстуру кожи и узнаваемость человека.';

        const requestId = randomUUID();
        const { requestDir, responseDir } = await ensureMediaDirs(chatId, requestId);

        const attachedNames = [];
        for (let i = 0; i < imageParts.length; i++) {
          const part = imageParts[i];
          const ext = part.mimeType === 'image/png' ? 'png' : 'jpg';
          const name = `${requestId}_att_${i + 1}.${ext}`;
          await writeBufferToFile(part.buffer, join(requestDir, name));
          attachedNames.push(name);
        }

        const userPhotoset = await models.UserPhotosets.create({
          UserId: user.Id,
          PhotosetId: row.Id,
          DateTimeUtc: new Date(),
          NumberOfPicturesInPhotoset: 1,
        });

        let auditId = null;
        try {
          auditId = await createGenerationAudit(
            chatId,
            user.Id,
            photosetRetouchPrompt,
            requestId,
            attachedNames.join(','),
            userPhotoset.Id
          );
        } catch (e) {
          console.error('Audit create for photoset:', e);
        }

        try {
          const images = await imagesAndTextToImage(imageParts, photosetRetouchPrompt, modelId);
          if (!images || images.length === 0) {
            await updateGenerationAuditError(auditId, 'No image in response (photoset)');
            continue;
          }
          const fileName = `${requestId}_result.png`;
          await writeBufferToFile(images[0], join(responseDir, fileName));
          await updateGenerationAuditSuccess(auditId, fileName);
          await ctx.replyWithPhoto({ source: images[0], filename: 'image.png' });
          generatedCount += 1;
        } catch (err) {
          console.error('Photoset generation error:', err);
          await updateGenerationAuditError(auditId, err?.message ?? String(err));
        }
      }

      if (generatedCount > 0) {
        await consumeGenerations(chatId, generatedCount);
        await recordImageGenerations(chatId, generatedCount);
        await ctx.telegram.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
        await ctx.reply('Готово! Вот твой фотосет.');
      } else {
        await ctx.telegram.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
        await ctx.reply(
          'Не удалось создать фотосессию. Попробуй ещё раз позже или выбери другой стиль.'
        );
      }
    } finally {
      stopTyping();
    }
  }

  async function runPhotosetPreviewGeneration(ctx, imageParts, configId) {
    const chatId = ctx.chat.id;
    const config = await models.PhotosetConfigs.findByPk(configId);
    if (!config) {
      await ctx.reply('Этот фотосет больше недоступен.');
      return;
    }
    const photosetsCount = await models.Photosets.count({
      where: { PhotosetConfigId: configId },
    });
    const firstPhotosetRow = await models.Photosets.findOne({
      where: { PhotosetConfigId: configId },
      include: [{ model: models.Presets, attributes: ['Prompt'] }],
      order: [['Id', 'ASC']],
    });
    const previewPrompt = firstPhotosetRow?.Preset?.Prompt;
    if (!previewPrompt || !String(previewPrompt).trim()) {
      await ctx.reply('Для этого фотосета ещё не настроены промпты. Скоро добавим.');
      return;
    }

    const stopTyping = startTyping(ctx.telegram, chatId);
    const processingMsg = await ctx.reply('🔎 Делаю предпросмотр в стиле выбранной фотосессии...');
    try {
      const modelId = await getGeminiModelForUser(chatId);
      const images = await imagesAndTextToImage(imageParts, previewPrompt, modelId);
      if (!images || images.length === 0) {
        await ctx.telegram.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
        await ctx.reply('Не удалось создать предпросмотр. Попробуй ещё раз.');
        return;
      }
      const coverBuffer = config.Image ? await downloadBlobBuffer(`PhotosetCovers/${config.Image}`) : null;

      await ctx.telegram.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
      const caption =
        '✅ Предпросмотр готов.\n' +
        'Это первая фотография из будущего набора.\n' +
        `Вы получите ${Math.max(photosetsCount, 1)} фотографий.\n` +
        'Финальный результат фотосессии будет лучше, в HD-качестве.';

      if (coverBuffer) {
        await ctx.replyWithMediaGroup([
          {
            type: 'photo',
            media: { source: images[0], filename: 'preview.png' },
            caption,
          },
          {
            type: 'photo',
            media: { source: coverBuffer, filename: config.Image || 'photoset-cover.jpg' },
          },
        ]);
      } else {
        await ctx.replyWithPhoto(
          { source: images[0], filename: 'preview.png' },
          { caption }
        );
      }
      await ctx.reply('Выбери следующее действие 👇', {
        reply_markup: {
          inline_keyboard: [[{ text: 'Заказать фотосессию', callback_data: `photoset_create_${configId}` }]],
        },
      });
    } catch (err) {
      console.error('Photoset preview generation error:', err);
      const text = err?.message?.includes('SAFETY')
        ? safetyBlockMessage
        : 'Не удалось создать предпросмотр. Попробуй ещё раз.';
      await ctx.telegram.editMessageText(chatId, processingMsg.message_id, null, text).catch(() => {});
    } finally {
      stopTyping();
    }
  }

  // Media group buffer: when user sends album, Telegram sends one update per photo with same media_group_id
  const MEDIA_GROUP_DELAY_MS = 1200;
  const MAX_PHOTOS_IN_GROUP = 10;
  const mediaGroupBuffers = new Map();

  async function processMediaGroup(mediaGroupId) {
    const buf = mediaGroupBuffers.get(mediaGroupId);
    if (!buf) return;
    mediaGroupBuffers.delete(mediaGroupId);
    if (buf.timeoutId) clearTimeout(buf.timeoutId);
    const { items, caption, ctx } = buf;
    if (items.length === 0) return;
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    // If user has a pending photoset preview request, generate preview first.
    const pendingPreview = pendingPhotosetPreviews.get(chatId);
    if (pendingPreview) {
      pendingPhotosetPreviews.delete(chatId);
      const downloadResults = await Promise.all(items.map((item) => downloadPhotoBuffer(bot, item.file_id)));
      const imageParts = downloadResults.map(({ buffer, filePath }) => ({
        buffer,
        mimeType: getPhotoMimeType(filePath),
      }));
      await runPhotosetPreviewGeneration(ctx, imageParts, pendingPreview.configId);
      return;
    }

    // If user has a pending photoset selection, use these images as input for that photoset
    const pending = pendingPhotosets.get(chatId);
    if (pending) {
      pendingPhotosets.delete(chatId);
      const downloadResults = await Promise.all(items.map((item) => downloadPhotoBuffer(bot, item.file_id)));
      const imageParts = downloadResults.map(({ buffer, filePath }) => ({
        buffer,
        mimeType: getPhotoMimeType(filePath),
      }));
      await runPhotosetGeneration(ctx, imageParts, pending.configId);
      return;
    }

    // If user has a pending preset selection, use these images as input for that preset
    const pendingPreset = pendingPresets.get(chatId);
    if (pendingPreset) {
      pendingPresets.delete(chatId);
      const downloadResults = await Promise.all(items.map((item) => downloadPhotoBuffer(bot, item.file_id)));
      const imageParts = downloadResults.map(({ buffer, filePath }) => ({
        buffer,
        mimeType: getPhotoMimeType(filePath),
      }));
      await runPresetGeneration(ctx, imageParts, pendingPreset.presetId);
      return;
    }

    const { total } = await getAvailableGenerations(chatId);
    if (total < 1) {
      const msg = await getNoGenerationsMessage();
      await ctx.reply(msg, noGenerationsReplyMarkup);
      return;
    }

    const stopTyping = startTyping(ctx.telegram, chatId);
    const msg = await ctx.reply('💫 Обрабатываю твой запрос, сейчас будет красиво...');
    const modelId = await getGeminiModelForUser(chatId);
    const requestId = randomUUID();
    const { requestDir, responseDir } = await ensureMediaDirs(chatId, requestId);
    const user = await models.Users.findOne({ where: { TelegramChatId: chatId } });
    let auditId = null;
    try {
      auditId = await createGenerationAudit(chatId, user?.Id ?? null, caption, requestId, null);
    } catch (e) {
      console.error('Audit create:', e);
    }
    try {
      const imageParts = [];
      const attachedNames = [];
      const downloadResults = await Promise.all(items.map((item) => downloadPhotoBuffer(bot, item.file_id)));
      for (let i = 0; i < downloadResults.length; i++) {
        const { buffer, filePath } = downloadResults[i];
        const ext = (getPhotoMimeType(filePath) === 'image/png') ? 'png' : 'jpg';
        const name = `${requestId}_att_${i + 1}.${ext}`;
        await writeBufferToFile(buffer, join(requestDir, name));
        attachedNames.push(name);
        imageParts.push({ buffer, mimeType: getPhotoMimeType(filePath) });
      }
      if (auditId != null) {
        await models.GenerationAudits.update(
          { AttachedImageFileNames: attachedNames.join(',') },
          { where: { Id: auditId } }
        );
      }
      const images = await imagesAndTextToImage(imageParts, caption, modelId);
      if (images.length === 0) {
        await updateGenerationAuditError(auditId, 'No image in response');
        await ctx.telegram.editMessageText(
          ctx.chat.id, msg.message_id, null,
          'Изображение не создано. Попробуй другое фото или подпись.'
        );
        return;
      }
      const resultNames = images.map((_, i) =>
        images.length > 1 ? `${requestId}_result_${i + 1}.png` : `${requestId}_result.png`
      );
      await Promise.all(images.map((img, i) => writeBufferToFile(img, join(responseDir, resultNames[i]))));
      await updateGenerationAuditSuccess(auditId, resultNames.join(','));
      await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id);
      for (const buffer of images) {
        await ctx.replyWithPhoto({ source: buffer, filename: 'image.png' });
      }
      await consumeGenerations(ctx.chat.id, images.length);
      await recordImageGenerations(ctx.chat.id, images.length);
    } catch (err) {
      console.error('Image+text-to-image (group) error:', err);
      await updateGenerationAuditError(auditId, err?.message ?? String(err));
      const groupErrText = err?.message?.includes('SAFETY') ? safetyBlockMessage : 'Не удалось обработать изображение. Попробуй ещё раз.';
      await ctx.telegram
        .editMessageText(ctx.chat.id, msg.message_id, null, groupErrText)
        .catch(() => {});
    } finally {
      stopTyping();
    }
  }

  // Photo (with optional caption) → image + text to image. Multiple photos in album = one request.
  bot.on('photo', async (ctx) => {
    if (!ctx.chat?.id) return;
    const caption = (ctx.message.caption || '').trim();
    const photo = ctx.message.photo.slice(-1)[0];
    const mediaGroupId = ctx.message.media_group_id;

    if (mediaGroupId) {
      if (!mediaGroupBuffers.has(mediaGroupId)) {
        mediaGroupBuffers.set(mediaGroupId, {
          items: [],
          caption: '',
          timeoutId: null,
          ctx,
        });
      }
      const buf = mediaGroupBuffers.get(mediaGroupId);
      buf.items.push({ file_id: photo.file_id });
      if (caption) buf.caption = caption;
      if (buf.items.length > MAX_PHOTOS_IN_GROUP) {
        if (buf.timeoutId) clearTimeout(buf.timeoutId);
        mediaGroupBuffers.delete(mediaGroupId);
        await ctx.reply(`Отправь не более ${MAX_PHOTOS_IN_GROUP} фото в одном альбоме.`);
        return;
      }
      if (buf.timeoutId) clearTimeout(buf.timeoutId);
      buf.timeoutId = setTimeout(() => processMediaGroup(mediaGroupId), MEDIA_GROUP_DELAY_MS);
      return;
    }

    // Single photo (no album)
    const pendingPreview = pendingPhotosetPreviews.get(ctx.chat.id);
    if (pendingPreview) {
      pendingPhotosetPreviews.delete(ctx.chat.id);
      const { buffer: imageBuffer, filePath } = await downloadPhotoBuffer(bot, photo.file_id);
      const mimeType = getPhotoMimeType(filePath);
      await runPhotosetPreviewGeneration(ctx, [{ buffer: imageBuffer, mimeType }], pendingPreview.configId);
      return;
    }

    const pending = pendingPhotosets.get(ctx.chat.id);
    if (pending) {
      pendingPhotosets.delete(ctx.chat.id);
      const { buffer: imageBuffer, filePath } = await downloadPhotoBuffer(bot, photo.file_id);
      const mimeType = getPhotoMimeType(filePath);
      await runPhotosetGeneration(ctx, [{ buffer: imageBuffer, mimeType }], pending.configId);
      return;
    }

    const pendingPreset = pendingPresets.get(ctx.chat.id);
    if (pendingPreset) {
      pendingPresets.delete(ctx.chat.id);
      const { buffer: imageBuffer, filePath } = await downloadPhotoBuffer(bot, photo.file_id);
      const mimeType = getPhotoMimeType(filePath);
      await runPresetGeneration(ctx, [{ buffer: imageBuffer, mimeType }], pendingPreset.presetId);
      return;
    }

    const { total } = await getAvailableGenerations(ctx.chat.id);
    if (total < 1) {
      const msg = await getNoGenerationsMessage();
      return ctx.reply(msg, noGenerationsReplyMarkup);
    }

    const stopTyping = startTyping(ctx.telegram, ctx.chat.id);
    const msg = await ctx.reply('💫 Обрабатываю твой запрос, сейчас будет красиво...');
    const modelId = await getGeminiModelForUser(ctx.chat.id);
    const requestId = randomUUID();
    const { requestDir, responseDir } = await ensureMediaDirs(ctx.chat.id, requestId);
    const user = await models.Users.findOne({ where: { TelegramChatId: ctx.chat.id } });
    let auditId = null;
    try {
      auditId = await createGenerationAudit(ctx.chat.id, user?.Id ?? null, caption, requestId, null);
    } catch (e) {
      console.error('Audit create:', e);
    }
    try {
      const { buffer: imageBuffer, filePath } = await downloadPhotoBuffer(bot, photo.file_id);
      const mimeType = getPhotoMimeType(filePath);
      const ext = mimeType === 'image/png' ? 'png' : 'jpg';
      const attName = `${requestId}_att_1.${ext}`;
      await writeBufferToFile(imageBuffer, join(requestDir, attName));
      if (auditId != null) {
        await models.GenerationAudits.update(
          { AttachedImageFileNames: attName },
          { where: { Id: auditId } }
        );
      }
      const images = await imageAndTextToImage(imageBuffer, mimeType, caption, modelId);
      if (images.length === 0) {
        await updateGenerationAuditError(auditId, 'No image in response');
        await ctx.telegram.editMessageText(
          ctx.chat.id, msg.message_id, null,
          'Изображение не создано. Попробуй другое фото или подпись.'
        );
        return;
      }
      const resultNames = images.map((_, i) =>
        images.length > 1 ? `${requestId}_result_${i + 1}.png` : `${requestId}_result.png`
      );
      await Promise.all(images.map((img, i) => writeBufferToFile(img, join(responseDir, resultNames[i]))));
      await updateGenerationAuditSuccess(auditId, resultNames.join(','));
      await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id);
      for (const buffer of images) {
        await ctx.replyWithPhoto({ source: buffer, filename: 'image.png' });
      }
      await consumeGenerations(ctx.chat.id, images.length);
      await recordImageGenerations(ctx.chat.id, images.length);
    } catch (err) {
      console.error('Image+text-to-image error:', err);
      await updateGenerationAuditError(auditId, err?.message ?? String(err));
      const photoErrText = err?.message?.includes('SAFETY') ? safetyBlockMessage : 'Не удалось обработать изображение. Попробуй ещё раз.';
      await ctx.telegram
        .editMessageText(ctx.chat.id, msg.message_id, null, photoErrText)
        .catch(() => {});
    } finally {
      stopTyping();
    }
  });

  bot.catch((err, ctx) => {
    console.error('Bot error:', err);
    return ctx.reply('Произошла ошибка. Попробуй позже.');
  });
}

async function main() {
  process.stdout.write('App: main() started\n');

  const port = process.env.PORT || 3000;

  // ── Step 1: bind the HTTP port immediately so Azure health probes get 200 OK ──
  const app = express();
  app.get('/', (_req, res) => res.status(200).send('OK'));

  // Admin Mini App
  app.use('/api/admin', express.json({ limit: '20mb' }), adminRouter);
  app.get('/api/admin/bot-info', (_req, res) => res.json({ botUsername: runtimeBotUsername }));
  app.use('/admin', express.static(join(__dirname, '..', 'public', 'admin')));
  app.use('/stat', express.static(join(__dirname, '..', 'public', 'stat')));

  // ── User Mini App: ideas gallery (presets), public API ─────────────────────
  app.get('/api/app/bot-info', (_req, res) => res.json({ botUsername: runtimeBotUsername }));
  app.get('/api/app/audiences', async (_req, res) => {
    try {
      const rows = await models.Audiences.findAll({
        order: [['SortOrder', 'ASC'], ['Id', 'ASC']],
        attributes: ['Id', 'Name', 'SortOrder'],
      });
      res.json(rows.map((r) => ({ id: r.Id, name: r.Name, sortOrder: r.SortOrder })));
    } catch (err) {
      console.error('GET /api/app/audiences:', err);
      res.status(500).json({ error: 'Failed to load audiences' });
    }
  });
  app.get('/api/app/themes', async (_req, res) => {
    try {
      const rows = await models.Themes.findAll({
        order: [['SortOrder', 'ASC'], ['Id', 'ASC']],
        attributes: ['Id', 'Name', 'ParentId', 'SortOrder'],
      });
      res.json(
        rows.map((r) => ({ id: r.Id, name: r.Name, parentId: r.ParentId, sortOrder: r.SortOrder }))
      );
    } catch (err) {
      console.error('GET /api/app/themes:', err);
      res.status(500).json({ error: 'Failed to load themes' });
    }
  });
  app.get('/api/app/presets', async (req, res) => {
    try {
      const audienceParam = (req.query.audience || '').toString().trim();
      const themeParam = (req.query.theme || '').toString().trim();
      const audienceIds = audienceParam
        ? audienceParam.split(',').map((s) => parseInt(s, 10)).filter((n) => Number.isInteger(n) && n > 0)
        : [];
      const themeIds = themeParam
        ? themeParam.split(',').map((s) => parseInt(s, 10)).filter((n) => Number.isInteger(n) && n > 0)
        : [];
      const limit = Math.min(
        60,
        Math.max(1, parseInt((req.query.limit || '30').toString(), 10) || 30)
      );
      const offset = Math.max(0, parseInt((req.query.offset || '0').toString(), 10) || 0);

      const baseWhere = {
        [Op.and]: [{ Image: { [Op.ne]: null } }, { Image: { [Op.ne]: '' } }],
      };
      const include = [];
      if (audienceIds.length > 0) {
        include.push({
          model: models.Audiences,
          where: { Id: { [Op.in]: audienceIds } },
          required: true,
          attributes: [],
          through: { attributes: [] },
        });
      }
      if (themeIds.length > 0) {
        include.push({
          model: models.Themes,
          where: { Id: { [Op.in]: themeIds } },
          required: true,
          attributes: [],
          through: { attributes: [] },
        });
      }

      const result = await models.Presets.findAndCountAll({
        where: baseWhere,
        include: include.length > 0 ? include : undefined,
        order: [['Id', 'ASC']],
        attributes: ['Id', 'Prompt', 'Image'],
        distinct: true,
        limit,
        offset,
      });
      res.json({
        items: result.rows,
        hasMore: offset + result.rows.length < result.count,
        total: result.count,
      });
    } catch (err) {
      console.error('GET /api/app/presets:', err);
      res.status(500).json({ error: 'Failed to load presets' });
    }
  });
  app.get('/api/app/preset-image/:fileName', async (req, res) => {
    try {
      const connStr = config.azureStorageConnectionString;
      if (!connStr) return res.status(503).send('Storage not configured');
      const client = BlobServiceClient.fromConnectionString(connStr);
      const container = client.getContainerClient(config.azureStorageContainer);
      const fileName = req.params.fileName;
      const blobName = fileName.startsWith('PresetImages/') ? fileName : `PresetImages/${fileName}`;
      const blob = container.getBlockBlobClient(blobName);
      const download = await blob.download(0);
      res.set('Content-Type', download.contentType || 'image/jpeg');
      res.set('Cache-Control', 'public, max-age=86400');
      download.readableStreamBody.pipe(res);
    } catch (err) {
      console.error('App preset-image proxy:', err?.message);
      res.status(404).send('Not found');
    }
  });
  app.get('/api/app/photoset-configs', async (req, res) => {
    try {
      const audienceParam = (req.query.audience || '').toString().trim();
      const themeParam = (req.query.theme || '').toString().trim();
      const audienceIds = audienceParam
        ? audienceParam.split(',').map((s) => parseInt(s, 10)).filter((n) => Number.isInteger(n) && n > 0)
        : [];
      const themeIds = themeParam
        ? themeParam.split(',').map((s) => parseInt(s, 10)).filter((n) => Number.isInteger(n) && n > 0)
        : [];
      const limit = Math.min(
        60,
        Math.max(1, parseInt((req.query.limit || '30').toString(), 10) || 30)
      );
      const offset = Math.max(0, parseInt((req.query.offset || '0').toString(), 10) || 0);

      const include = [];
      if (audienceIds.length > 0) {
        include.push({
          model: models.Audiences,
          where: { Id: { [Op.in]: audienceIds } },
          required: true,
          attributes: [],
          through: { attributes: [] },
        });
      }
      if (themeIds.length > 0) {
        include.push({
          model: models.Themes,
          where: { Id: { [Op.in]: themeIds } },
          required: true,
          attributes: [],
          through: { attributes: [] },
        });
      }

      const result = await models.PhotosetConfigs.findAndCountAll({
        include: include.length > 0 ? include : undefined,
        order: [['Id', 'ASC']],
        attributes: ['Id', 'Name', 'Description', 'Image'],
        distinct: true,
        limit,
        offset,
      });
      res.json({
        items: result.rows,
        hasMore: offset + result.rows.length < result.count,
        total: result.count,
      });
    } catch (err) {
      console.error('GET /api/app/photoset-configs:', err);
      res.status(500).json({ error: 'Failed to load photoset configs' });
    }
  });
  app.get('/api/app/photoset-cover/:fileName', async (req, res) => {
    try {
      const connStr = config.azureStorageConnectionString;
      if (!connStr) return res.status(503).send('Storage not configured');
      const client = BlobServiceClient.fromConnectionString(connStr);
      const container = client.getContainerClient(config.azureStorageContainer);
      const fileName = req.params.fileName;
      const blobName = fileName.startsWith('PhotosetCovers/') ? fileName : `PhotosetCovers/${fileName}`;
      const blob = container.getBlockBlobClient(blobName);
      const download = await blob.download(0);
      res.set('Content-Type', download.contentType || 'image/jpeg');
      res.set('Cache-Control', 'public, max-age=86400');
      download.readableStreamBody.pipe(res);
    } catch (err) {
      console.error('App photoset-cover proxy:', err?.message);
      res.status(404).send('Not found');
    }
  });
  app.use('/app', express.static(join(__dirname, '..', 'public', 'app')));

  await new Promise((resolve) => app.listen(port, resolve));
  console.log('HTTP server listening on port', port);

  // ── Step 2: validate env vars (logs error but keeps server alive if missing) ──
  try {
    checkEnvLoaded();
  } catch (err) {
    console.error('Env error:', err.message);
    console.error('Set TELEGRAM_BOT_TOKEN and GEMINI_API_KEY in Azure App Service → Configuration → Application settings.');
    return;
  }

  // ── Step 3: create bot (handlers registered after getMe so we have botUsername) ──
  const bot = new Telegraf(config.telegramBotToken, { handlerTimeout: 300_000 });

  console.log('Checking Telegram connection (getMe)...');
  let botUsername = '';
  try {
    const me = await Promise.race([
      bot.telegram.getMe(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Connection to Telegram timed out')), 10000)
      ),
    ]);
    botUsername = me?.username || process.env.BOT_USERNAME || '';
    runtimeBotUsername = botUsername;
    console.log('Telegram OK.', botUsername ? `@${botUsername}` : '(username not set)');
  } catch (err) {
    console.error('Cannot reach Telegram:', err.message);
    return;
  }

  const appBaseUrl = (process.env.ADMIN_APP_URL || config.webhookUrl || '').replace(/\/$/, '');
  registerHandlers(bot, { botUsername, appBaseUrl });

  // Set menu commands (shown when user taps Menu in bottom-left; emoji = icon next to command)
  const menuCommands = [
    { command: 'start', description: 'ℹ️ Что умеет бот' },
    { command: 'photosets', description: '📸 Ознакомиться с фотосессиями' },
    { command: 'referrals', description: '🎁 Бонусы за друзей' },
    { command: 'account', description: '💳 Мой баланс' },
    { command: 'help', description: '❓ Помощь' },
  ];
  try {
    await bot.telegram.setMyCommands(menuCommands);
    console.log('Menu commands set.');
  } catch (err) {
    console.error('Failed to set menu commands:', err.message);
  }

  if (config.isProduction) {
    // Production: receive updates via webhook
    app.use(express.json());
    app.use(bot.webhookCallback('/'));
    const webhookUrl = config.webhookUrl.replace(/\/$/, '');
    console.log('Setting webhook:', webhookUrl);
    try {
      await bot.telegram.setWebhook(webhookUrl);
      console.log('Webhook set. Bot is ready – send /start in Telegram.');
    } catch (err) {
      console.error('Failed to set webhook:', err.message);
    }
  } else {
    // Local/testing: receive updates via long polling (no public URL needed)
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    await bot.launch();
    console.log('Polling started. Bot is ready – send /start in Telegram.');
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
