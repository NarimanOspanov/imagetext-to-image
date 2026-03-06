import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

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
 * Text → image: generate image from text prompt using gemini-3.1-flash-image-preview.
 */
export async function generateImagesFromText(prompt, count = 1) {
  const contents = [{ text: prompt }];

  const response = await ai.models.generateContent({
    model: config.geminiImageModel,
    contents,
  });

  const images = getImagesFromResponse(response);
  if (images.length === 0) {
    throw new Error('No image in response');
  }
  return images;
}

/**
 * Photo + caption (or photo only) → image: send image and optional text, get generated image.
 * Uses same pattern as example: contents = [{ text }, { inlineData: { mimeType, data } }].
 */
export async function imageAndTextToImage(imageBuffer, mimeType, userPrompt = '') {
  const base64 = imageBuffer.toString('base64');
  const text =
    userPrompt.trim() ||
    'Generate a new image based on this image (same subject and style, new variation).';

  const contents = [
    { text },
    {
      inlineData: {
        mimeType: mimeType || 'image/png',
        data: base64,
      },
    },
  ];

  const response = await ai.models.generateContent({
    model: config.geminiImageModel,
    contents,
  });

  const images = getImagesFromResponse(response);
  if (images.length === 0) {
    throw new Error('No image in response');
  }
  return images;
}
