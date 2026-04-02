import { Router } from 'express';
import { createHmac, randomUUID } from 'node:crypto';
import { BlobServiceClient } from '@azure/storage-blob';
import { GoogleGenAI } from '@google/genai';
import { Op } from 'sequelize';
import { config } from './config.js';
import { sequelize, models } from './db.js';

const router = Router();

const ADMIN_IDS = new Set(['5934959951', '110043646', '473160849']);

// ── AI classifier for audiences/themes (shared by presets & photosets) ───────
const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-2.0-flash';

function getTextFromResponse(response) {
  const parts = response?.candidates?.[0]?.content?.parts ?? [];
  const textPart = parts.find((p) => p.text != null);
  return textPart?.text ?? '';
}

async function classifyTextToCategories(text, audienceRows, themeRows) {
  const audienceStr = audienceRows.map((a) => `  ${a.Id}: ${a.Name}`).join('\n');
  const themeStr = themeRows.map((t) => `  ${t.Id}: ${t.Name}${t.ParentId ? ' (child)' : ''}`).join('\n');

  const systemPrompt =
    'You are a classifier for photo session prompts and photoset descriptions (in Russian). For the given text, choose which target audiences and which theme categories apply. ' +
    'Reply with ONLY a valid JSON object, no other text. Use the exact IDs from the lists below.\n' +
    'Format: {"audienceIds": [1, 2], "themeIds": [3, 5, 10]}\n' +
    'If none apply, use empty arrays. Choose at least one audience and at least one theme when the text clearly fits.\n\n' +
    'Audiences (Id: Name):\n' +
    audienceStr +
    '\n\nThemes (Id: Name):\n' +
    themeStr;

  const userPrompt = `Text to classify:\n${(text || '').slice(0, 2000)}`;

  const response = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: [{ text: systemPrompt + '\n\n' + userPrompt }],
  });

  const fullText = getTextFromResponse(response);
  const jsonMatch = fullText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in response from classifier');
  const parsed = JSON.parse(jsonMatch[0]);
  const audienceIds = Array.isArray(parsed.audienceIds)
    ? parsed.audienceIds.map((n) => parseInt(n, 10)).filter((n) => Number.isInteger(n) && n > 0)
    : [];
  const themeIds = Array.isArray(parsed.themeIds)
    ? parsed.themeIds.map((n) => parseInt(n, 10)).filter((n) => Number.isInteger(n) && n > 0)
    : [];
  return { audienceIds, themeIds };
}

async function classifyPresetCategories(presetId, prompt) {
  if (!config.geminiApiKey || !prompt) return;
  const [audiences, themes] = await Promise.all([
    models.Audiences.findAll({ attributes: ['Id', 'Name'], order: [['SortOrder', 'ASC'], ['Id', 'ASC']] }),
    models.Themes.findAll({ attributes: ['Id', 'Name', 'ParentId'], order: [['SortOrder', 'ASC'], ['Id', 'ASC']] }),
  ]);
  const { audienceIds, themeIds } = await classifyTextToCategories(prompt, audiences, themes);
  const validAudienceIds = new Set(audiences.map((a) => a.Id));
  const validThemeIds = new Set(themes.map((t) => t.Id));
  const filteredAudienceIds = audienceIds.filter((id) => validAudienceIds.has(id));
  const filteredThemeIds = themeIds.filter((id) => validThemeIds.has(id));

  await sequelize.transaction(async (t) => {
    await sequelize.query('DELETE FROM [dbo].[PresetAudiences] WHERE PresetId = :id', {
      replacements: { id: presetId },
      transaction: t,
    });
    await sequelize.query('DELETE FROM [dbo].[PresetThemes] WHERE PresetId = :id', {
      replacements: { id: presetId },
      transaction: t,
    });
    for (const aid of filteredAudienceIds) {
      await sequelize.query(
        'INSERT INTO [dbo].[PresetAudiences] (PresetId, AudienceId) VALUES (:id, :audienceId)',
        { replacements: { id: presetId, audienceId: aid }, transaction: t }
      );
    }
    for (const tid of filteredThemeIds) {
      await sequelize.query(
        'INSERT INTO [dbo].[PresetThemes] (PresetId, ThemeId) VALUES (:id, :themeId)',
        { replacements: { id: presetId, themeId: tid }, transaction: t }
      );
    }
  });
}

async function classifyPhotosetConfigCategories(configId, description) {
  if (!config.geminiApiKey || !description) return;
  const [audiences, themes] = await Promise.all([
    models.Audiences.findAll({ attributes: ['Id', 'Name'], order: [['SortOrder', 'ASC'], ['Id', 'ASC']] }),
    models.Themes.findAll({ attributes: ['Id', 'Name', 'ParentId'], order: [['SortOrder', 'ASC'], ['Id', 'ASC']] }),
  ]);
  const { audienceIds, themeIds } = await classifyTextToCategories(description, audiences, themes);
  const validAudienceIds = new Set(audiences.map((a) => a.Id));
  const validThemeIds = new Set(themes.map((t) => t.Id));
  const filteredAudienceIds = audienceIds.filter((id) => validAudienceIds.has(id));
  const filteredThemeIds = themeIds.filter((id) => validThemeIds.has(id));

  await sequelize.transaction(async (t) => {
    await sequelize.query('DELETE FROM [dbo].[PhotosetConfigAudiences] WHERE PhotosetConfigId = :id', {
      replacements: { id: configId },
      transaction: t,
    });
    await sequelize.query('DELETE FROM [dbo].[PhotosetConfigThemes] WHERE PhotosetConfigId = :id', {
      replacements: { id: configId },
      transaction: t,
    });
    for (const aid of filteredAudienceIds) {
      await sequelize.query(
        'INSERT INTO [dbo].[PhotosetConfigAudiences] (PhotosetConfigId, AudienceId) VALUES (:id, :audienceId)',
        { replacements: { id: configId, audienceId: aid }, transaction: t }
      );
    }
    for (const tid of filteredThemeIds) {
      await sequelize.query(
        'INSERT INTO [dbo].[PhotosetConfigThemes] (PhotosetConfigId, ThemeId) VALUES (:id, :themeId)',
        { replacements: { id: configId, themeId: tid }, transaction: t }
      );
    }
  });
}

/** Verify Telegram WebApp initData and return the user object, or null on failure. */
function verifyInitData(initData) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    const secret = createHmac('sha256', 'WebAppData').update(config.telegramBotToken).digest();
    const expected = createHmac('sha256', secret).update(dataCheckString).digest('hex');
    if (expected !== hash) return null;
    const userStr = params.get('user');
    return userStr ? JSON.parse(userStr) : {};
  } catch {
    return null;
  }
}

function adminAuth(req, res, next) {
  // In local dev (NODE_ENV !== 'production') skip Telegram auth so the panel
  // can be tested directly in the browser at http://localhost:<PORT>/admin
  if (process.env.NODE_ENV !== 'production') {
    return next();
  }
  const initData = req.headers['x-init-data'];
  if (!initData) return res.status(401).json({ error: 'Unauthorized' });
  const user = verifyInitData(initData);
  if (!user || !ADMIN_IDS.has(String(user.id))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  req.adminUser = user;
  next();
}

function blobContentType(fileName) {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
}

async function uploadImageBlob(base64, originalName, folder) {
  const connStr = config.azureStorageConnectionString;
  if (!connStr) throw new Error('AZURE_STORAGE_CONNECTION_STRING not configured');
  const ext = (originalName.split('.').pop() || 'jpg').toLowerCase();
  const blobFileName = `${randomUUID()}.${ext}`;
  const blobPath = `${folder}/${blobFileName}`;
  const buffer = Buffer.from(base64, 'base64');
  const client = BlobServiceClient.fromConnectionString(connStr);
  const container = client.getContainerClient(config.azureStorageContainer);
  const blob = container.getBlockBlobClient(blobPath);
  await blob.upload(buffer, buffer.length, {
    blobHTTPHeaders: { blobContentType: blobContentType(originalName) },
  });
  return blobFileName;
}

function uploadCoverBlob(base64, originalName) {
  return uploadImageBlob(base64, originalName, 'PhotosetCovers');
}

function uploadPresetImageBlob(base64, originalName) {
  return uploadImageBlob(base64, originalName, 'PresetImages');
}

// ── Storage config (public blob base URL) ────────────────────────────────────
router.get('/storage-config', adminAuth, (_req, res) => {
  const connStr = config.azureStorageConnectionString || '';
  const accountName = connStr.match(/AccountName=([^;]+)/)?.[1] || '';
  res.json({
    blobBaseUrl: accountName
      ? `https://${accountName}.blob.core.windows.net/${config.azureStorageContainer}`
      : null,
  });
});

// ── Reference data for admin (audiences & themes) ────────────────────────────
router.get('/audiences', adminAuth, async (_req, res) => {
  try {
    const rows = await models.Audiences.findAll({
      order: [['SortOrder', 'ASC'], ['Id', 'ASC']],
      attributes: ['Id', 'Name', 'SortOrder'],
    });
    res.json(rows);
  } catch (err) {
    console.error('Admin GET /audiences:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/themes', adminAuth, async (_req, res) => {
  try {
    const rows = await models.Themes.findAll({
      order: [['SortOrder', 'ASC'], ['Id', 'ASC']],
      attributes: ['Id', 'Name', 'ParentId', 'SortOrder'],
    });
    res.json(rows);
  } catch (err) {
    console.error('Admin GET /themes:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Founder stats (per-period aggregates for Mini App) ────────────────────────
router.get('/stats', adminAuth, async (req, res) => {
  try {
    const period = (req.query.period || '30d').toString().toLowerCase();
    const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
    const now = new Date();
    const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days, 0, 0, 0, 0));

    const dates = [];
    for (let d = new Date(startDate); d <= now; d.setUTCDate(d.getUTCDate() + 1)) {
      dates.push(d.toISOString().slice(0, 10));
    }

    const seriesByDate = {};
    dates.forEach((d) => {
      seriesByDate[d] = {
        date: d,
        generations: 0,
        usersJoined: 0,
        usersByInvite: 0,
        payments: 0,
        requiredChannelUsers: 0,
      };
    });

    const startStr = startDate.toISOString().slice(0, 19).replace('T', ' ');

    const [genRows] = await sequelize.query(
      `SELECT CONVERT(DATE, GeneratedAt) AS d, COUNT(*) AS c FROM [dbo].[UserImageGenerations] WHERE GeneratedAt >= :start GROUP BY CONVERT(DATE, GeneratedAt)`,
      { replacements: { start: startStr } }
    );
    (genRows || []).forEach((r) => {
      const d = r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d).slice(0, 10);
      if (seriesByDate[d]) seriesByDate[d].generations = Number(r.c) || 0;
    });

    const [userRows] = await sequelize.query(
      `SELECT CONVERT(DATE, DateJoined) AS d, COUNT(*) AS c FROM [dbo].[Users] WHERE DateJoined >= :start GROUP BY CONVERT(DATE, DateJoined)`,
      { replacements: { start: startStr } }
    );
    (userRows || []).forEach((r) => {
      const d = r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d).slice(0, 10);
      if (seriesByDate[d]) seriesByDate[d].usersJoined = Number(r.c) || 0;
    });

    // Exclude referrals where the referrer is the admin (chatId 5934959951) so stats show only real invites
    const [refRows] = await sequelize.query(
      `SELECT CONVERT(DATE, ReferredAt) AS d, COUNT(*) AS c FROM [dbo].[Referrals] r
       WHERE r.ReferredAt >= :start
         AND r.ReferrerUserId NOT IN (SELECT Id FROM [dbo].[Users] WHERE TelegramChatId = 5934959951)
       GROUP BY CONVERT(DATE, r.ReferredAt)`,
      { replacements: { start: startStr } }
    );
    (refRows || []).forEach((r) => {
      const d = r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d).slice(0, 10);
      if (seriesByDate[d]) seriesByDate[d].usersByInvite = Number(r.c) || 0;
    });

    const [payRows] = await sequelize.query(
      `SELECT CONVERT(DATE, PurchasedAt) AS d, COUNT(*) AS c FROM [dbo].[UserPurchases] WHERE PurchasedAt >= :start GROUP BY CONVERT(DATE, PurchasedAt)`,
      { replacements: { start: startStr } }
    );
    (payRows || []).forEach((r) => {
      const d = r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d).slice(0, 10);
      if (seriesByDate[d]) seriesByDate[d].payments = Number(r.c) || 0;
    });

    const [requiredChannelUserRows] = await sequelize.query(
      `SELECT CONVERT(DATE, DateTime) AS d, COUNT(*) AS c FROM [dbo].[RequiredChannelUsers] WHERE DateTime >= :start GROUP BY CONVERT(DATE, DateTime)`,
      { replacements: { start: startStr } }
    );
    (requiredChannelUserRows || []).forEach((r) => {
      const d = r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d).slice(0, 10);
      if (seriesByDate[d]) seriesByDate[d].requiredChannelUsers = Number(r.c) || 0;
    });

    const series = dates.map((d) => seriesByDate[d]);
    res.json({ period: period === '7d' ? '7d' : period === '90d' ? '90d' : '30d', series });
  } catch (err) {
    console.error('Admin GET /stats:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Referral payouts (manual) ────────────────────────────────────────────────
router.get('/referral/payout-requests', adminAuth, async (_req, res) => {
  try {
    // Refresh pending -> available globally
    await models.ReferralEarnings.update(
      { Status: 'available' },
      { where: { Status: 'pending', HoldUntilUtc: { [Op.lte]: new Date() } } }
    );

    const requests = await models.PayoutRequests.findAll({
      order: [['RequestedAtUtc', 'DESC']],
      include: [{ model: models.Users, attributes: ['Id', 'TelegramChatId', 'TelegramUserName'] }],
    });

    res.json(requests);
  } catch (err) {
    console.error('Admin GET /referral/payout-requests:', err);
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

router.get('/referral/earnings-summary/:userId', adminAuth, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: 'Invalid userId' });

    await models.ReferralEarnings.update(
      { Status: 'available' },
      { where: { Status: 'pending', HoldUntilUtc: { [Op.lte]: new Date() }, BeneficiaryUserId: userId } }
    );

    const rows = await models.ReferralEarnings.findAll({
      where: { BeneficiaryUserId: userId },
      attributes: ['Status', [sequelize.fn('SUM', sequelize.col('AmountUsdCents')), 'sum']],
      group: ['Status'],
      raw: true,
    });
    const byStatus = {};
    for (const r of rows) byStatus[r.Status] = Number(r.sum) || 0;

    res.json({
      pending: byStatus.pending || 0,
      available: byStatus.available || 0,
      reserved: byStatus.reserved || 0,
      paid: byStatus.paid || 0,
      void: byStatus.void || 0,
    });
  } catch (err) {
    console.error('Admin GET /referral/earnings-summary/:userId:', err);
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

router.post('/referral/payout-requests/:id/mark-paid', adminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
    const note = req.body?.note != null ? String(req.body.note).slice(0, 500) : null;

    const row = await models.PayoutRequests.findByPk(id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (row.Status !== 'requested') return res.status(409).json({ error: 'Already processed' });

    await sequelize.transaction(async (t) => {
      await models.PayoutRequests.update(
        { Status: 'paid', ProcessedAtUtc: new Date(), AdminNote: note },
        { where: { Id: id }, transaction: t }
      );
      await models.ReferralEarnings.update(
        { Status: 'paid' },
        { where: { BeneficiaryUserId: row.UserId, Status: 'reserved' }, transaction: t }
      );
    });

    const updated = await models.PayoutRequests.findByPk(id);
    res.json({ ok: true, request: updated });
  } catch (err) {
    console.error('Admin POST /referral/payout-requests/:id/mark-paid:', err);
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

router.post('/referral/payout-requests/:id/reject', adminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
    const note = req.body?.note != null ? String(req.body.note).slice(0, 500) : null;

    const row = await models.PayoutRequests.findByPk(id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (row.Status !== 'requested') return res.status(409).json({ error: 'Already processed' });

    await sequelize.transaction(async (t) => {
      await models.PayoutRequests.update(
        { Status: 'rejected', ProcessedAtUtc: new Date(), AdminNote: note },
        { where: { Id: id }, transaction: t }
      );
      // Return reserved earnings back to available for the user.
      await models.ReferralEarnings.update(
        { Status: 'available' },
        { where: { BeneficiaryUserId: row.UserId, Status: 'reserved' }, transaction: t }
      );
    });

    const updated = await models.PayoutRequests.findByPk(id);
    res.json({ ok: true, request: updated });
  } catch (err) {
    console.error('Admin POST /referral/payout-requests/:id/reject:', err);
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

// ── Cover image proxy ─────────────────────────────────────────────────────────
// No auth required — cover images are already shown to all bot users via
// replyWithPhoto, so they are not sensitive. <img> tags can't send headers.
router.get('/cover/:fileName', async (req, res) => {
  try {
    const connStr = config.azureStorageConnectionString;
    if (!connStr) return res.status(503).send('Storage not configured');
    const client = BlobServiceClient.fromConnectionString(connStr);
    const container = client.getContainerClient(config.azureStorageContainer);
    const fileName = req.params.fileName;
    const blobName = fileName.startsWith('PhotosetCovers/')
      ? fileName
      : `PhotosetCovers/${fileName}`;
    const blob = container.getBlockBlobClient(blobName);
    const download = await blob.download(0);
    res.set('Content-Type', download.contentType || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    download.readableStreamBody.pipe(res);
  } catch (err) {
    console.error('Cover proxy error:', err?.message);
    res.status(404).send('Not found');
  }
});

// ── Preset image proxy ────────────────────────────────────────────────────────
router.get('/preset-image/:fileName', async (req, res) => {
  try {
    const connStr = config.azureStorageConnectionString;
    if (!connStr) return res.status(503).send('Storage not configured');
    const client = BlobServiceClient.fromConnectionString(connStr);
    const container = client.getContainerClient(config.azureStorageContainer);
    const fileName = req.params.fileName;
    const blobName = fileName.startsWith('PresetImages/')
      ? fileName
      : `PresetImages/${fileName}`;
    const blob = container.getBlockBlobClient(blobName);
    const download = await blob.download(0);
    res.set('Content-Type', download.contentType || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    download.readableStreamBody.pipe(res);
  } catch (err) {
    console.error('Preset image proxy error:', err?.message);
    res.status(404).send('Not found');
  }
});

// ── PhotosetConfigs ───────────────────────────────────────────────────────────
router.get('/configs', adminAuth, async (_req, res) => {
  try {
    const rows = await models.PhotosetConfigs.findAll({
      include: [
        { model: models.Photosets, include: [{ model: models.Presets }] },
        { model: models.Audiences },
        { model: models.Themes },
      ],
      order: [['Id', 'ASC']],
    });
    res.json(rows);
  } catch (err) {
    console.error('Admin GET /configs:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/configs', adminAuth, async (req, res) => {
  try {
    const { name, description, imageBase64, imageFileName } = req.body;
    if (!name?.trim() || !description?.trim() || !imageBase64 || !imageFileName) {
      return res.status(400).json({ error: 'name, description, imageBase64 and imageFileName are required' });
    }
    const savedFileName = await uploadCoverBlob(imageBase64, imageFileName);
    const row = await models.PhotosetConfigs.create({
      Name: name.trim(),
      Description: description.trim(),
      Image: savedFileName,
    });
    try {
      await classifyPhotosetConfigCategories(row.Id, row.Description);
    } catch (e) {
      console.error('Classify photoset config error:', e?.message || e);
    }
    const full = await models.PhotosetConfigs.findByPk(row.Id, {
      include: [
        { model: models.Photosets, include: [{ model: models.Presets }] },
        { model: models.Audiences },
        { model: models.Themes },
      ],
    });
    res.json(full);
  } catch (err) {
    console.error('Admin POST /configs:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/configs/:id', adminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, description, imageBase64, imageFileName } = req.body;
    if (!name?.trim() || !description?.trim()) {
      return res.status(400).json({ error: 'name and description are required' });
    }
    const updates = { Name: name.trim(), Description: description.trim() };
    if (imageBase64 && imageFileName) {
      updates.Image = await uploadCoverBlob(imageBase64, imageFileName);
    }
    await models.PhotosetConfigs.update(updates, { where: { Id: id } });
    try {
      await classifyPhotosetConfigCategories(id, updates.Description);
    } catch (e) {
      console.error('Classify photoset config (PUT) error:', e?.message || e);
    }
    const full = await models.PhotosetConfigs.findByPk(id, {
      include: [
        { model: models.Photosets, include: [{ model: models.Presets }] },
        { model: models.Audiences },
        { model: models.Themes },
      ],
    });
    res.json(full);
  } catch (err) {
    console.error('Admin PUT /configs/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/configs/:id', adminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const photosetRows = await models.Photosets.findAll({ where: { PhotosetConfigId: id }, attributes: ['Id'] });
    const photosetIds = photosetRows.map((r) => r.Id);
    if (photosetIds.length > 0) {
      const userPhotosetIds = await models.UserPhotosets.findAll({
        where: { PhotosetId: photosetIds },
        attributes: ['Id'],
      }).then((rows) => rows.map((r) => r.Id));
      if (userPhotosetIds.length > 0) {
        await models.GenerationAudits.update(
          { UserPhotosetId: null },
          { where: { UserPhotosetId: userPhotosetIds } }
        );
        await models.UserPhotosets.destroy({ where: { PhotosetId: photosetIds } });
      }
      await models.Photosets.destroy({ where: { PhotosetConfigId: id } });
    }
    await models.PhotosetConfigs.destroy({ where: { Id: id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('Admin DELETE /configs/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Presets ───────────────────────────────────────────────────────────────────
router.get('/presets', adminAuth, async (_req, res) => {
  try {
    const rows = await models.Presets.findAll({
      include: [{ model: models.Audiences }, { model: models.Themes }],
      order: [['Id', 'ASC']],
    });
    res.json(rows);
  } catch (err) {
    console.error('Admin GET /presets:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/presets', adminAuth, async (req, res) => {
  try {
    const { prompt, imageBase64, imageFileName } = req.body;
    if (!prompt?.trim()) return res.status(400).json({ error: 'prompt is required' });
    const fields = { Prompt: prompt.trim() };
    if (imageBase64 && imageFileName) {
      fields.Image = await uploadPresetImageBlob(imageBase64, imageFileName);
    }
    const row = await models.Presets.create(fields);
    try {
      await classifyPresetCategories(row.Id, row.Prompt);
    } catch (e) {
      console.error('Classify preset error:', e?.message || e);
    }
    const full = await models.Presets.findByPk(row.Id, {
      include: [{ model: models.Audiences }, { model: models.Themes }],
    });
    res.json(full);
  } catch (err) {
    console.error('Admin POST /presets:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/presets/:id', adminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { prompt, imageBase64, imageFileName } = req.body;
    if (!prompt?.trim()) return res.status(400).json({ error: 'prompt is required' });
    const updates = { Prompt: prompt.trim() };
    if (imageBase64 && imageFileName) {
      updates.Image = await uploadPresetImageBlob(imageBase64, imageFileName);
    }
    await models.Presets.update(updates, { where: { Id: id } });
    try {
      await classifyPresetCategories(id, updates.Prompt);
    } catch (e) {
      console.error('Classify preset (PUT) error:', e?.message || e);
    }
    const row = await models.Presets.findByPk(id, {
      include: [{ model: models.Audiences }, { model: models.Themes }],
    });
    res.json(row);
  } catch (err) {
    console.error('Admin PUT /presets/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/presets/:id', adminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const photosetRows = await models.Photosets.findAll({ where: { PresetId: id }, attributes: ['Id'] });
    const photosetIds = photosetRows.map((r) => r.Id);
    if (photosetIds.length > 0) {
      const userPhotosetIds = await models.UserPhotosets.findAll({
        where: { PhotosetId: photosetIds },
        attributes: ['Id'],
      }).then((rows) => rows.map((r) => r.Id));
      if (userPhotosetIds.length > 0) {
        await models.GenerationAudits.update(
          { UserPhotosetId: null },
          { where: { UserPhotosetId: userPhotosetIds } }
        );
        await models.UserPhotosets.destroy({ where: { PhotosetId: photosetIds } });
      }
      await models.Photosets.destroy({ where: { PresetId: id } });
    }
    await models.Presets.destroy({ where: { Id: id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('Admin DELETE /presets/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Reclassify endpoints (manual trigger from admin UI) ──────────────────────
router.post('/configs/:id/reclassify', adminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const row = await models.PhotosetConfigs.findByPk(id);
    if (!row) return res.status(404).json({ error: 'PhotosetConfig not found' });
    await classifyPhotosetConfigCategories(id, row.Description);
    const full = await models.PhotosetConfigs.findByPk(id, {
      include: [
        { model: models.Photosets, include: [{ model: models.Presets }] },
        { model: models.Audiences },
        { model: models.Themes },
      ],
    });
    res.json(full);
  } catch (err) {
    console.error('Admin POST /configs/:id/reclassify:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/presets/:id/reclassify', adminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const row = await models.Presets.findByPk(id);
    if (!row) return res.status(404).json({ error: 'Preset not found' });
    await classifyPresetCategories(id, row.Prompt);
    const full = await models.Presets.findByPk(id, {
      include: [{ model: models.Audiences }, { model: models.Themes }],
    });
    res.json(full);
  } catch (err) {
    console.error('Admin POST /presets/:id/reclassify:', err);
    res.status(500).json({ error: err.message });
  }
});

// Manual category assignment (without AI)
router.post('/configs/:id/categories', adminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { audienceIds, themeIds } = req.body || {};
    const auds = Array.isArray(audienceIds)
      ? audienceIds.map((n) => parseInt(n, 10)).filter((n) => Number.isInteger(n) && n > 0)
      : [];
    const themes = Array.isArray(themeIds)
      ? themeIds.map((n) => parseInt(n, 10)).filter((n) => Number.isInteger(n) && n > 0)
      : [];

    await sequelize.transaction(async (t) => {
      await sequelize.query('DELETE FROM [dbo].[PhotosetConfigAudiences] WHERE PhotosetConfigId = :id', {
        replacements: { id },
        transaction: t,
      });
      await sequelize.query('DELETE FROM [dbo].[PhotosetConfigThemes] WHERE PhotosetConfigId = :id', {
        replacements: { id },
        transaction: t,
      });
      for (const aid of auds) {
        await sequelize.query(
          'INSERT INTO [dbo].[PhotosetConfigAudiences] (PhotosetConfigId, AudienceId) VALUES (:id, :audienceId)',
          { replacements: { id, audienceId: aid }, transaction: t }
        );
      }
      for (const tid of themes) {
        await sequelize.query(
          'INSERT INTO [dbo].[PhotosetConfigThemes] (PhotosetConfigId, ThemeId) VALUES (:id, :themeId)',
          { replacements: { id, themeId: tid }, transaction: t }
        );
      }
    });

    const full = await models.PhotosetConfigs.findByPk(id, {
      include: [
        { model: models.Photosets, include: [{ model: models.Presets }] },
        { model: models.Audiences },
        { model: models.Themes },
      ],
    });
    res.json(full);
  } catch (err) {
    console.error('Admin POST /configs/:id/categories:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/presets/:id/categories', adminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { audienceIds, themeIds } = req.body || {};
    const auds = Array.isArray(audienceIds)
      ? audienceIds.map((n) => parseInt(n, 10)).filter((n) => Number.isInteger(n) && n > 0)
      : [];
    const themes = Array.isArray(themeIds)
      ? themeIds.map((n) => parseInt(n, 10)).filter((n) => Number.isInteger(n) && n > 0)
      : [];

    await sequelize.transaction(async (t) => {
      await sequelize.query('DELETE FROM [dbo].[PresetAudiences] WHERE PresetId = :id', {
        replacements: { id },
        transaction: t,
      });
      await sequelize.query('DELETE FROM [dbo].[PresetThemes] WHERE PresetId = :id', {
        replacements: { id },
        transaction: t,
      });
      for (const aid of auds) {
        await sequelize.query(
          'INSERT INTO [dbo].[PresetAudiences] (PresetId, AudienceId) VALUES (:id, :audienceId)',
          { replacements: { id, audienceId: aid }, transaction: t }
        );
      }
      for (const tid of themes) {
        await sequelize.query(
          'INSERT INTO [dbo].[PresetThemes] (PresetId, ThemeId) VALUES (:id, :themeId)',
          { replacements: { id, themeId: tid }, transaction: t }
        );
      }
    });

    const full = await models.Presets.findByPk(id, {
      include: [{ model: models.Audiences }, { model: models.Themes }],
    });
    res.json(full);
  } catch (err) {
    console.error('Admin POST /presets/:id/categories:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Photoset links (junction rows) ───────────────────────────────────────────
router.post('/links', adminAuth, async (req, res) => {
  try {
    const { photosetConfigId, presetId } = req.body;
    if (!photosetConfigId || !presetId) {
      return res.status(400).json({ error: 'photosetConfigId and presetId are required' });
    }
    const exists = await models.Photosets.findOne({
      where: { PhotosetConfigId: photosetConfigId, PresetId: presetId },
    });
    if (exists) return res.status(409).json({ error: 'Already linked' });
    const row = await models.Photosets.create({ PhotosetConfigId: photosetConfigId, PresetId: presetId });
    res.json(row);
  } catch (err) {
    console.error('Admin POST /links:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/links/:id', adminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    // Photosets is referenced by UserPhotosets; UserPhotosets by GenerationAudits. Delete in FK order.
    const userPhotosetIds = await models.UserPhotosets.findAll({
      where: { PhotosetId: id },
      attributes: ['Id'],
    }).then((rows) => rows.map((r) => r.Id));
    if (userPhotosetIds.length > 0) {
      await models.GenerationAudits.update(
        { UserPhotosetId: null },
        { where: { UserPhotosetId: userPhotosetIds } }
      );
      await models.UserPhotosets.destroy({ where: { PhotosetId: id } });
    }
    await models.Photosets.destroy({ where: { Id: id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('Admin DELETE /links/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PromoCodes (partner deeplinks: t.me/BotName?start=promo_CODE) ─────────────
router.get('/promocodes', adminAuth, async (_req, res) => {
  try {
    const rows = await models.PromoCodes.findAll({
      include: [{ model: models.Users, as: 'Owner', attributes: ['Id', 'TelegramChatId', 'TelegramUserName'] }],
      order: [['CreatedAt', 'DESC']],
    });
    const withCount = await Promise.all(
      rows.map(async (r) => {
        const usedCount = await models.Users.count({ where: { Promocode: r.Code } });
        return { ...r.toJSON(), usedCount };
      })
    );
    res.json(withCount);
  } catch (err) {
    console.error('Admin GET /promocodes:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/promocodes', adminAuth, async (req, res) => {
  try {
    const { code, label, ownerUserId, initialGenerations } = req.body;
    const codeStr = (code ?? '').trim().replace(/\s+/g, '_');
    if (!codeStr || codeStr.length > 50) {
      return res.status(400).json({ error: 'code is required (max 50 chars, no spaces)' });
    }
    const existing = await models.PromoCodes.findOne({ where: { Code: codeStr } });
    if (existing) return res.status(409).json({ error: 'This promocode already exists' });
    const initial =
      initialGenerations != null && initialGenerations !== ''
        ? Math.max(0, parseInt(initialGenerations, 10) || 0)
        : null;
    const row = await models.PromoCodes.create({
      Code: codeStr,
      Label: label != null && String(label).trim() !== '' ? String(label).trim() : null,
      OwnerUserId: ownerUserId != null && ownerUserId !== '' ? parseInt(ownerUserId, 10) : null,
      InitialGenerations: initial,
    });
    res.status(201).json(row);
  } catch (err) {
    console.error('Admin POST /promocodes:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/promocodes/:id', adminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { label, ownerUserId, initialGenerations } = req.body;
    const updates = {};
    if (label !== undefined) updates.Label = label != null && String(label).trim() !== '' ? String(label).trim() : null;
    if (ownerUserId !== undefined) updates.OwnerUserId = ownerUserId != null && ownerUserId !== '' ? parseInt(ownerUserId, 10) : null;
    if (initialGenerations !== undefined) {
      updates.InitialGenerations =
        initialGenerations != null && initialGenerations !== ''
          ? Math.max(0, parseInt(initialGenerations, 10) || 0)
          : null;
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No fields to update' });
    await models.PromoCodes.update(updates, { where: { Id: id } });
    const row = await models.PromoCodes.findByPk(id);
    res.json(row);
  } catch (err) {
    console.error('Admin PUT /promocodes/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/promocodes/:id', adminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await models.PromoCodes.destroy({ where: { Id: id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('Admin DELETE /promocodes/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
