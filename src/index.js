import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { Telegraf } from 'telegraf';
import { config } from './config.js';
import {
  generateImagesFromText,
  imageAndTextToImage,
} from './gemini.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');

function checkEnvLoaded() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const geminiKey = process.env.GEMINI_API_KEY;
  console.log('Env check:');
  console.log('  .env path:', envPath, existsSync(envPath) ? '(found)' : '(not found)');
  console.log('  TELEGRAM_BOT_TOKEN:', token ? `${token.slice(0, 8)}...${token.slice(-4)} (length ${token.length})` : 'MISSING');
  console.log('  GEMINI_API_KEY:', geminiKey ? `${geminiKey.slice(0, 8)}... (length ${geminiKey.length})` : 'MISSING');
  if (!token || !geminiKey) {
    throw new Error('Set TELEGRAM_BOT_TOKEN and GEMINI_API_KEY in .env (see .env.example)');
  }
}

const bot = new Telegraf(config.telegramBotToken);

async function downloadPhotoBuffer(ctx, fileId) {
  const file = await ctx.telegram.getFile(fileId);
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

bot.start((ctx) => {
  return ctx.reply(
    '👋 Hi! I generate images with Gemini.\n\n' +
    '• Send me *text* and I\'ll create an image from your description.\n' +
    '• Send me a *photo* (with optional caption) and I\'ll create a new image based on it.\n\n' +
    'Examples:\n' +
    '— "A cat wearing a space suit on Mars"\n' +
    '— Send a photo with caption: "make it oil painting style"',
    { parse_mode: 'Markdown' }
  );
});

bot.help((ctx) => {
  return ctx.reply(
    'Text → image: send any description.\n' +
    'Image + text → image: send a photo; add a caption to guide the style or changes.'
  );
});

// Text message → text-to-image
bot.on('text', async (ctx) => {
  const prompt = ctx.message.text.trim();
  if (!prompt) return ctx.reply('Send a description of the image you want to generate.');

  const msg = await ctx.reply('⏳ Generating image...');
  try {
    const images = await generateImagesFromText(prompt, config.maxImagesPerRequest);
    if (images.length === 0) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        msg.message_id,
        null,
        'No image was generated. Try a different prompt.'
      );
      return;
    }
    await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id);
    for (const buffer of images) {
      await ctx.replyWithPhoto({ source: buffer, filename: 'image.png' });
    }
  } catch (err) {
    console.error('Text-to-image error:', err);
    const text = err?.message?.includes('SAFETY')
      ? 'The prompt was blocked by safety filters. Try a different description.'
      : 'Something went wrong. Please try again.';
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, text).catch(() => {});
  }
});

// Photo (with optional caption) → image + text to image
bot.on('photo', async (ctx) => {
  const caption = (ctx.message.caption || '').trim();
  const photo = ctx.message.photo.slice(-1)[0];
  const msg = await ctx.reply('⏳ Processing image and generating new one...');

  try {
    const { buffer: imageBuffer, filePath } = await downloadPhotoBuffer(ctx, photo.file_id);
    const mimeType = getPhotoMimeType(filePath);
    const images = await imageAndTextToImage(imageBuffer, mimeType, caption);
    if (images.length === 0) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        msg.message_id,
        null,
        'No image was generated. Try another photo or caption.'
      );
      return;
    }
    await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id);
    for (const buffer of images) {
      await ctx.replyWithPhoto({ source: buffer, filename: 'image.png' });
    }
  } catch (err) {
    console.error('Image+text-to-image error:', err);
    await ctx.telegram
      .editMessageText(
        ctx.chat.id,
        msg.message_id,
        null,
        'Failed to process the image. Please try again.'
      )
      .catch(() => {});
  }
});

bot.catch((err, ctx) => {
  console.error('Bot error:', err);
  return ctx.reply('An error occurred. Please try again later.');
});

async function main() {
  checkEnvLoaded();
  console.log('Starting bot...');

  console.log('Checking Telegram connection (getMe)...');
  try {
    await Promise.race([
      bot.telegram.getMe(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Connection to Telegram timed out (check network/proxy)')), 10000)
      ),
    ]);
  } catch (err) {
    throw new Error(
      `Cannot reach Telegram: ${err.message}. Check TELEGRAM_BOT_TOKEN and network (api.telegram.org).`
    );
  }
  console.log('Telegram OK. Launching long polling...');
  // Don't await launch() – in Telegraf it can hang forever during long polling (known issue #1989)
  bot.launch()
    .then(() => console.log('Bot is running. Send /start in Telegram.'))
    .catch((err) => {
      console.error('Launch failed:', err);
      process.exit(1);
    });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
