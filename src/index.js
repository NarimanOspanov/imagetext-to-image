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

/** Map our model id (Users.ActiveModel) to Gemini API model id. Env overrides: GEMINI_IMAGE_MODEL, GEMINI_IMAGE_MODEL_PRO, etc. */
function resolveGeminiModelId(ourModelId) {
  const id = (ourModelId && String(ourModelId).trim()) || IMAGE_MODELS[0]?.id || 'standard';
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

/** Resolve user's ActiveModel to Gemini API model id. Uses IMAGE_MODELS[0].id when user has no selection. */
async function getGeminiModelForUser(chatId) {
  const user = await models.Users.findOne({ where: { TelegramChatId: chatId } });
  const active = user?.ActiveModel || IMAGE_MODELS[0].id;
  if (!IMAGE_MODELS.some((m) => m.id === active)) {
    return resolveGeminiModelId(IMAGE_MODELS[0].id);
  }
  return resolveGeminiModelId(active);
}

const INITIAL_FREE_GENERATIONS = 20;

/** Get integer config value by key (e.g. GenerationsPerReferral). Returns defaultVal if missing. */
async function getConfigInt(key, defaultVal = 0) {
  try {
    const row = await models.Configs?.findOne({ where: { Keys: key } });
    return row != null ? (row.Value ?? defaultVal) : defaultVal;
  } catch {
    return defaultVal;
  }
}

/** Total generations available: free (new user) + referral bonuses (unused) + purchase balance. */
async function getAvailableGenerations(chatId) {
  try {
    const user = await models.Users.findOne({ where: { TelegramChatId: chatId } });
    if (!user) return { total: 0, fromFree: 0, fromReferrals: 0, fromPurchases: 0, totalEver: 0 };
    const generationsPerReferral = Math.max(1, await getConfigInt('GenerationsPerReferral', 1));
    const fromFree = Math.max(0, user.FreeGenerationsRemaining ?? 0);
    const [referralCount, referralTotalCount, purchases] = await Promise.all([
      models.Referrals.count({ where: { ReferrerUserId: user.Id, BonusUsed: false } }),
      models.Referrals.count({ where: { ReferrerUserId: user.Id } }),
      models.UserPurchases.findAll({
        where: { UserId: user.Id },
        order: [['PurchasedAt', 'ASC']],
        attributes: ['Id', 'BalanceRemaining', 'GenerationsIncluded'],
      }),
    ]);
    const fromReferrals = referralCount * generationsPerReferral;
    const fromPurchases = purchases.reduce((s, p) => s + (p.BalanceRemaining || 0), 0);
    const totalEver =
      INITIAL_FREE_GENERATIONS +
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
    const fromReferrals = referralRows.length * generationsPerReferral;
    const takeFromReferrals = Math.min(left, fromReferrals);
    const rowsToMark = Math.ceil(takeFromReferrals / generationsPerReferral);
    for (let i = 0; i < rowsToMark && i < referralRows.length; i++) {
      await referralRows[i].update({ BonusUsed: true }, { transaction: t });
    }
    left -= takeFromReferrals;
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

function registerHandlers(bot, options = {}) {
  const botUsername = options.botUsername || '';

  bot.start(async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    pendingPhotosets.delete(chatId);
    pendingPresets.delete(chatId);
    const stopTyping = startTyping(ctx.telegram, chatId);
    try {
      const username = ctx.from?.username ?? null;
      const startPayload = (ctx.message?.text || '').trim().split(/\s+/)[1] || '';

      try {
      await sequelize.authenticate();
      let user = await models.Users.findOne({ where: { TelegramChatId: chatId } });
      const wasNew = !user;
      if (!user) {
        try {
          user = await models.Users.create({
            TelegramChatId: chatId,
            TelegramUserName: username,
            DateJoined: Sequelize.literal('GETUTCDATE()'),
          });
        } catch (createErr) {
          if (createErr?.name === 'SequelizeUniqueConstraintError') {
            user = await models.Users.findOne({ where: { TelegramChatId: chatId } });
          } else throw createErr;
        }
      } else if (username != null) {
        await user.update({ TelegramUserName: username });
      }

      // Referral: start=REFERRER_TELEGRAM_CHAT_ID means this user was referred
      if (startPayload && /^\d+$/.test(startPayload)) {
        if (String(chatId) !== startPayload) {
          const referrerChatIdNum = Number(startPayload);
          const referrer = await models.Users.findOne({
            where: {
              [Op.or]: [
                { TelegramChatId: startPayload },
                ...(Number.isSafeInteger(referrerChatIdNum) ? [{ TelegramChatId: referrerChatIdNum }] : []),
              ],
            },
          });
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
            if (ref && ref.isNewRecord) {
              const perRef = Math.max(1, await getConfigInt('GenerationsPerReferral', 1));
              const refGenWord = perRef === 1 ? 'генерацию' : (perRef >= 2 && perRef <= 4 ? 'генерации' : 'генераций');
              // Coerce to number so Telegram API gets a serializable chat_id (BigInt would break JSON)
              const referrerChatId = Number(referrer.TelegramChatId) || String(referrer.TelegramChatId);
              const celebration =
                `🎉 По вашей ссылке зарегистрировался друг!\n\n` +
                `✨ Вам начислено +${perRef} ${refGenWord} — можно создавать изображения прямо сейчас. Спасибо, что приглашаете!`;
              try {
                await ctx.telegram.sendMessage(referrerChatId, celebration);
              } catch (e) {
                console.error('Notify referrer error:', e?.response?.body ?? e?.message ?? e);
              }
            }
          }
        }
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
        'Создаю реалистичные, стильные портреты, как после съёмки у топового фотографа ✨\n\n' +
        'Загрузите фото и короткое описание образа, и я покажу вашу лучшую версию.\n\n' +
        'Выбери, что хочешь сделать';
      const replyMarkup = {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🖼 Хочу красивую картинку', callback_data: 'start_want_picture' }],
            [{ text: '💎 Посмотреть идеи', url: 'https://t.me/rabota_5g' }],
          ],
        },
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

  bot.action('start_want_picture', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('Отправь текст с описанием картинки или фото — и я создам изображение.');
  });

  bot.help(async (ctx) => {
    const stopTyping = startTyping(ctx.telegram, ctx.chat?.id);
    try {
      const text =
        '🔥 Как пользоваться?\n\n' +
        '📸 Просто отправь мне до 3х фото, затем описание, что с ним нужно сделать.\n\n' +
        'Загляните в наш канал, там лучшие стили и промпты:\n' +
        '[👇 Посмотреть идеи](https://t.me/rabota_5g)';
      const replyMarkup = {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [
            [{ text: '🟥 Не нравится результат', callback_data: 'help_dislike_result' }],
            [{ text: '💳 Как оплатить?', callback_data: 'help_how_to_pay' }],
            [{ text: '❗ Не открывается оплата', callback_data: 'help_payment_not_open' }],
            [{ text: '⚙️ Как сменить модель', callback_data: 'help_change_model' }],
            [{ text: 'Остались вопросы? ➢', url: 'https://t.me/great_future' }],
          ],
        },
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
      'Если окно оплаты не открывается, попробуй обновить приложение Telegram или оплатить с другого устройства. Если проблема сохраняется — напиши нам: @great_future'
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
    const currentId = user?.ActiveModel || IMAGE_MODELS[0].id;
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
        user = await models.Users.create({
          TelegramChatId: ctx.chat.id,
          TelegramUserName: ctx.from?.username ?? null,
          DateJoined: Sequelize.literal('GETUTCDATE()'),
          ActiveModel: modelId,
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
          text: 'Создать фотосессию',
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
      await ctx.reply(noGenerationsMessage, noGenerationsReplyMarkup);
      return;
    }
    const stopTyping = startTyping(ctx.telegram, chatId);
    const processingMsg = await ctx.reply('📸 Создаю изображение по выбранному стилю...');
    try {
      const modelId = await getGeminiModelForUser(chatId);
      let user = await models.Users.findOne({ where: { TelegramChatId: chatId } });
      if (!user) {
        try {
          user = await models.Users.create({
            TelegramChatId: chatId,
            TelegramUserName: ctx.from?.username ?? null,
            DateJoined: Sequelize.literal('GETUTCDATE()'),
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
      await consumeGenerations(chatId, 1);
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

  async function sendPhotosetCard(ctx, configId = null) {
    const stopTyping = startTyping(ctx.telegram, ctx.chat?.id);
    try {
      const configs = await models.PhotosetConfigs.findAll({
        order: [['Id', 'ASC']],
      });
      if (!configs || configs.length === 0) {
        return ctx.reply('Фотосеты скоро появятся — мы готовим для тебя лучшие подборки.');
      }
      let index = 0;
      if (configId != null) {
        const foundIndex = configs.findIndex((c) => c.Id === configId);
        if (foundIndex >= 0) index = foundIndex;
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
      const configs = await models.PhotosetConfigs.findAll({
        order: [['Id', 'ASC']],
      });
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

      pendingPhotosets.set(chatId, { configId });
      await ctx.reply(
        'Отправь одну или несколько исходных фото людей одним сообщением. Я использую их как основу для этого фотосета.'
      );
    } finally {
      stopTyping();
    }
  });

  // —— Pay: show payment method options ——
  bot.command('pay', async (ctx) => {
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
      'Осуществляя платеж с использованием платежного сервиса, вы соглашаетесь с условиями оферты. Сделать возврат можно написав в поддержку @greate_future';
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
  // —— Referral program: stats, personal link, "Invite friend" (switch_inline_query) ——
  async function sendReferralScreen(ctx) {
    const stopTyping = startTyping(ctx.telegram, ctx.chat?.id);
    try {
      if (ctx.callbackQuery) await ctx.answerCbQuery();
      const chatId = ctx.chat?.id;
    const user = await models.Users.findOne({ where: { TelegramChatId: chatId } });
    const generationsPerReferral = Math.max(1, await getConfigInt('GenerationsPerReferral', 1));
    const invited = user
      ? await models.Referrals.count({ where: { ReferrerUserId: user.Id } })
      : 0;
    const bonusesReceived = invited * generationsPerReferral;
    const referralLink =
      botUsername && chatId
        ? `https://t.me/${botUsername}?start=${chatId}`
        : '(настрой BOT_USERNAME)';
    const REFERRAL_TEMPLATE =
      'Попробуй Alexa — оживляет фото в видео 🎬✨ Мне понравилось!';
    const switchQuery = `${referralLink}\n${REFERRAL_TEMPLATE}`.slice(0, 256);
    const genWord = generationsPerReferral === 1 ? 'генерацию' : (generationsPerReferral >= 2 && generationsPerReferral <= 4 ? 'генерации' : 'генераций');
    const text =
      `🤝 Приглашай друзей — получай +${generationsPerReferral} ${genWord} за каждого!\n\n` +
      'Хочешь больше генераций бесплатно? Просто приглашай друзей 👋\n\n' +
      'Твоя реферальная программа:\n' +
      `👥 Приглашено друзей: ${invited}\n` +
      `🎁 Получено бонусных генераций: ${bonusesReceived}\n\n` +
      'Ваша персональная ссылка:\n' +
      referralLink;
      await ctx.reply(text, {
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🔥 Пригласить друга',
                switch_inline_query: switchQuery,
              },
            ],
          ],
        },
      });
    } finally {
      stopTyping();
    }
  }

  bot.command('referrals', sendReferralScreen);
  bot.action('pay_referrals', sendReferralScreen);

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
        user = await models.Users.create({
          TelegramChatId: chatId,
          TelegramUserName: ctx.from?.username ?? null,
          DateJoined: Sequelize.literal('GETUTCDATE()'),
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
    await ctx.reply(
      `✅ Оплата получена! Зачислено ${pricing.GenerationsCount} генераций. Можешь создавать изображения.`
    );
  });

  /** User-facing message when Gemini blocks due to safety/policy (e.g. sexual content). */
  const safetyBlockMessage =
    'Запрос заблокирован фильтрами безопасности. Попробуй другое описание или другое фото.';
  const noGenerationsMessage =
    '⛔️ Ты использовал все бесплатные генерации\n\n' +
    'Каждая картинка стоит нам реальных денег 💸\n' +
    'Но мы сделали цену в разы ниже, чем у других —\n' +
    'чтобы ты мог творить без ограничений по оплате 🎨\n\n' +
    '🤝 Приведи друга — за каждого приглашённого друга тебе начислят бонусные генерации. Поделись ссылкой из раздела «Бонусы за друзей» (/referrals).\n\n' +
    '💎 Подключи Alexa Premium и получи:\n' +
    '• без ограничений по оплате и пробуй всё, что приходит в голову\n' +
    '• HD-качество и точность\n' +
    '• поддержку, идеи и вдохновение в любое время\n' +
    '• PRO-режим\n\n' +
    'и всё это — дешевле чашки кофе ☕️';
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
      return ctx.reply(noGenerationsMessage, noGenerationsReplyMarkup);
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
      await ctx.reply(noGenerationsMessage, noGenerationsReplyMarkup);
      return;
    }

    const stopTyping = startTyping(ctx.telegram, chatId);
    const processingMsg = await ctx.reply('📸 Создаю фотосессию по выбранному стилю...');

    try {
      const modelId = await getGeminiModelForUser(chatId);
      let user = await models.Users.findOne({ where: { TelegramChatId: chatId } });
      if (!user) {
        try {
          user = await models.Users.create({
            TelegramChatId: chatId,
            TelegramUserName: ctx.from?.username ?? null,
            DateJoined: Sequelize.literal('GETUTCDATE()'),
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
            prompt,
            requestId,
            attachedNames.join(','),
            userPhotoset.Id
          );
        } catch (e) {
          console.error('Audit create for photoset:', e);
        }

        try {
          const images = await imagesAndTextToImage(imageParts, prompt, modelId);
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
      await ctx.reply(noGenerationsMessage, noGenerationsReplyMarkup);
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
      return ctx.reply(noGenerationsMessage, noGenerationsReplyMarkup);
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

  registerHandlers(bot, { botUsername });

  // Set menu commands (shown when user taps Menu in bottom-left; emoji = icon next to command)
  const menuCommands = [
    { command: 'start', description: 'ℹ️ Что умеет бот' },
    { command: 'account', description: '⚙️ Мой профиль' },
    { command: 'model', description: '✨ Сменить модель' },
    { command: 'pay', description: '💎 Докупить генерации' },
    { command: 'referrals', description: '🎁 Бонусы за друзей' },
    { command: 'photosets', description: '📸 Готовые фотосеты' },
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
