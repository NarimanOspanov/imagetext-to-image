import { Router } from 'express';
import { createHmac, randomUUID } from 'node:crypto';
import { BlobServiceClient } from '@azure/storage-blob';
import { config } from './config.js';
import { models } from './db.js';

const router = Router();

const ADMIN_IDS = new Set(['5934959951', '110043646', '473160849']);

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

async function uploadCoverBlob(base64, originalName) {
  const connStr = config.azureStorageConnectionString;
  if (!connStr) throw new Error('AZURE_STORAGE_CONNECTION_STRING not configured');
  const ext = (originalName.split('.').pop() || 'jpg').toLowerCase();
  const blobFileName = `${randomUUID()}.${ext}`;
  const blobPath = `PhotosetCovers/${blobFileName}`;
  const buffer = Buffer.from(base64, 'base64');
  const client = BlobServiceClient.fromConnectionString(connStr);
  const container = client.getContainerClient(config.azureStorageContainer);
  const blob = container.getBlockBlobClient(blobPath);
  await blob.upload(buffer, buffer.length, {
    blobHTTPHeaders: { blobContentType: blobContentType(originalName) },
  });
  return blobFileName;
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

// ── PhotosetConfigs ───────────────────────────────────────────────────────────
router.get('/configs', adminAuth, async (_req, res) => {
  try {
    const rows = await models.PhotosetConfigs.findAll({
      include: [{ model: models.Photosets, include: [{ model: models.Presets }] }],
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
    const full = await models.PhotosetConfigs.findByPk(row.Id, {
      include: [{ model: models.Photosets, include: [{ model: models.Presets }] }],
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
    const full = await models.PhotosetConfigs.findByPk(id, {
      include: [{ model: models.Photosets, include: [{ model: models.Presets }] }],
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
    await models.Photosets.destroy({ where: { PhotosetConfigId: id } });
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
    const rows = await models.Presets.findAll({ order: [['Id', 'ASC']] });
    res.json(rows);
  } catch (err) {
    console.error('Admin GET /presets:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/presets', adminAuth, async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt?.trim()) return res.status(400).json({ error: 'prompt is required' });
    const row = await models.Presets.create({ Prompt: prompt.trim() });
    res.json(row);
  } catch (err) {
    console.error('Admin POST /presets:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/presets/:id', adminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { prompt } = req.body;
    if (!prompt?.trim()) return res.status(400).json({ error: 'prompt is required' });
    await models.Presets.update({ Prompt: prompt.trim() }, { where: { Id: id } });
    const row = await models.Presets.findByPk(id);
    res.json(row);
  } catch (err) {
    console.error('Admin PUT /presets/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/presets/:id', adminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await models.Photosets.destroy({ where: { PresetId: id } });
    await models.Presets.destroy({ where: { Id: id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('Admin DELETE /presets/:id:', err);
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
    await models.Photosets.destroy({ where: { Id: id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('Admin DELETE /links/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
