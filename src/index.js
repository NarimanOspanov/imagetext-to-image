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
    '👋 Привет! Я создаю изображения с помощью Gemini.\n\n' +
    '• Отправь *текст* — я создам картинку по твоему описанию.\n' +
    '• Отправь *фото* (с подписью или без) — создам новое изображение на его основе.\n\n' +
    'Примеры:\n' +
    '— «Кот в скафандре на Марсе»\n' +
    '— Фото с подписью: «сделай в стиле масляной живописи»',
    { parse_mode: 'Markdown' }
  );
});

bot.help((ctx) => {
  return ctx.reply(
    'Текст → картинка: отправь любое описание.\n' +
    'Фото + текст → картинка: отправь фото, в подписи укажи стиль или изменения.'
  );
});

// Text message → text-to-image
bot.on('text', async (ctx) => {
  const prompt = ctx.message.text.trim();
  if (!prompt) return ctx.reply('Опиши, какую картинку нужно сгенерировать.');

  const msg = await ctx.reply('⏳ Генерирую изображение...');
  try {
    const images = await generateImagesFromText(prompt, config.maxImagesPerRequest);
    if (images.length === 0) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        msg.message_id,
        null,
        'Изображение не создано. Попробуй другой запрос.'
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
      ? 'Запрос заблокирован фильтрами безопасности. Попробуй другое описание.'
      : 'Что-то пошло не так. Попробуй ещё раз.';
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, text).catch(() => {});
  }
});

// Photo (with optional caption) → image + text to image
bot.on('photo', async (ctx) => {
  const caption = (ctx.message.caption || '').trim();
  const photo = ctx.message.photo.slice(-1)[0];
  const msg = await ctx.reply('⏳ Обрабатываю фото и генерирую новое изображение...');

  try {
    const { buffer: imageBuffer, filePath } = await downloadPhotoBuffer(ctx, photo.file_id);
    const mimeType = getPhotoMimeType(filePath);
    const images = await imageAndTextToImage(imageBuffer, mimeType, caption);
    if (images.length === 0) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        msg.message_id,
        null,
        'Изображение не создано. Попробуй другое фото или подпись.'
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
        'Не удалось обработать изображение. Попробуй ещё раз.'
      )
      .catch(() => {});
  }
});

bot.catch((err, ctx) => {
  console.error('Bot error:', err);
  return ctx.reply('Произошла ошибка. Попробуй позже.');
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
