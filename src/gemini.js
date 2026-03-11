import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

/** Max concurrent Gemini API calls to avoid event loop starvation and rate limits. */
const GEMINI_CONCURRENCY = Math.max(1, parseInt(process.env.GEMINI_CONCURRENCY, 10) || 4);
let activeCount = 0;
const waitQueue = [];

async function withConcurrencyLimit(fn) {
  while (activeCount >= GEMINI_CONCURRENCY) {
    await new Promise((resolve) => { waitQueue.push(resolve); });
  }
  activeCount++;
  try {
    return await fn();
  } finally {
    activeCount--;
    if (waitQueue.length > 0) waitQueue.shift()();
  }
}

/**
 * Extract image buffers from Gemini generateContent response (parts with inlineData).
 * Matches example: response.candidates[0].content.parts with part.inlineData
 */
function getImagesFromResponse(response) {
  const buffers = [];
  const candidates = response?.candidates ?? [];
  for (const c of candidates) {
    const parts = c.content?.parts ?? [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        buffers.push(Buffer.from(part.inlineData.data, 'base64'));
      }
    }
  }
  return buffers;
}

/**
 * Determine why the response has no image: safety block, policy, rate limit, or unknown.
 * Returns a short reason string for the error message (e.g. "SAFETY", "RECITATION", "RATE_LIMIT").
 */
function getNoImageReason(response) {
  if (!response) return null;
  // Prompt was blocked (e.g. safety filter on input)
  const promptFeedback = response.promptFeedback ?? response.prompt_feedback;
  const blockReason = promptFeedback?.blockReason ?? promptFeedback?.block_reason;
  if (blockReason != null && blockReason !== '') {
    const r = String(blockReason).toUpperCase();
    if (r.includes('SAFETY') || r.includes('PROHIBITED') || r.includes('BLOCK')) return 'SAFETY';
    return r;
  }
  // Candidate was blocked or stopped (e.g. safety on output, recitation)
  const c0 = response.candidates?.[0];
  const finishReason = c0?.finishReason ?? c0?.finish_reason;
  if (finishReason != null && finishReason !== '') {
    const r = String(finishReason).toUpperCase();
    if (r.includes('SAFETY') || r === 'RECITATION' || r.includes('BLOCK')) return 'SAFETY';
    if (r.includes('MAX_TOKENS') || r.includes('LENGTH')) return 'MAX_TOKENS';
    return r;
  }
  return null;
}

/**
 * Text → image: generate image from text prompt.
 * @param {string} prompt
 * @param {number} count
 * @param {string} [modelId] - optional Gemini model id; defaults to config.geminiImageModel
 */
export async function generateImagesFromText(prompt, count = 1, modelId = null) {
  return withConcurrencyLimit(async () => {
    const contents = [{ text: prompt }];
    const model = modelId || config.geminiImageModel;

    const response = await ai.models.generateContent({
      model,
      contents,
    });

    const images = getImagesFromResponse(response);
    if (images.length === 0) {
      const reason = getNoImageReason(response);
      const msg = reason ? `No image in response: ${reason}` : 'No image in response';
      if (reason) console.warn('Gemini no image:', reason, '(prompt may be blocked by safety or policy)');
      throw new Error(msg);
    }
    return images;
  });
}

/**
 * Photo + caption (or photo only) → image: send image and optional text, get generated image.
 * @param {string} [modelId] - optional Gemini model id; defaults to config.geminiImageModel
 */
export async function imageAndTextToImage(imageBuffer, mimeType, userPrompt = '', modelId = null) {
  return imagesAndTextToImage([{ buffer: imageBuffer, mimeType: mimeType || 'image/png' }], userPrompt, modelId);
}

/**
 * Multiple photos + prompt → one generated image. Single request with all images.
 * @param {{ buffer: Buffer, mimeType: string }[]} imageParts - one or more images
 * @param {string} [userPrompt]
 * @param {string} [modelId]
 */
export async function imagesAndTextToImage(imageParts, userPrompt = '', modelId = null) {
  return withConcurrencyLimit(async () => {
    const text =
      (userPrompt && userPrompt.trim()) ||
      'Generate a new image based on these images (same subject and style, new variation).';

    const contents = [{ text }];
    for (const part of imageParts) {
      if (part?.buffer) {
        contents.push({
          inlineData: {
            mimeType: part.mimeType || 'image/png',
            data: part.buffer.toString('base64'),
          },
        });
      }
    }

    const model = modelId || config.geminiImageModel;
    const response = await ai.models.generateContent({
      model,
      contents,
    });

    const images = getImagesFromResponse(response);
    if (images.length === 0) {
      const reason = getNoImageReason(response);
      const msg = reason ? `No image in response: ${reason}` : 'No image in response';
      if (reason) console.warn('Gemini no image:', reason, '(prompt or output may be blocked by safety or policy)');
      throw new Error(msg);
    }
    return images;
  });
}
