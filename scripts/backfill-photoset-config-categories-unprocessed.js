/**
 * Backfill PhotosetConfigAudiences and PhotosetConfigThemes ONLY for
 * PhotosetConfigs that do not have any audience/theme records yet.
 * Uses PhotosetConfigs.Description for AI classification.
 *
 * Run from project root:
 *   node scripts/backfill-photoset-config-categories-unprocessed.js
 *
 * Optional: DRY_RUN=1 to log only (no DB writes).
 */
import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import { config } from '../src/config.js';
import { sequelize } from '../src/db.js';

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-2.0-flash';

function getTextFromResponse(response) {
  const parts = response?.candidates?.[0]?.content?.parts ?? [];
  const textPart = parts.find((p) => p.text != null);
  return textPart?.text ?? '';
}

/**
 * Call Gemini to classify a photoset config description into audience and theme IDs.
 * @returns {{ audienceIds: number[], themeIds: number[] }}
 */
async function classifyDescription(description, audienceList, themeList) {
  const audienceStr = audienceList.map((a) => `  ${a.Id}: ${a.Name}`).join('\n');
  const themeStr = themeList.map((t) => `  ${t.Id}: ${t.Name}${t.ParentId ? ' (child)' : ''}`).join('\n');

  const systemPrompt =
    'You are a classifier for photo session / photoset descriptions (in Russian). For the given description of a photoset (a set of related photo ideas), choose which target audiences and which theme categories apply. ' +
    'Reply with ONLY a valid JSON object, no other text. Use the exact IDs from the lists below.\n' +
    'Format: {"audienceIds": [1, 2], "themeIds": [3, 5, 10]}\n' +
    'If none apply, use empty arrays. Choose at least one audience and at least one theme when the description clearly fits.\n\n' +
    'Audiences (Id: Name):\n' +
    audienceStr +
    '\n\nThemes (Id: Name):\n' +
    themeStr;

  const userPrompt = `Description to classify:\n${(description || '').slice(0, 2000)}`;

  const response = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: [{ text: systemPrompt + '\n\n' + userPrompt }],
  });

  const text = getTextFromResponse(response);
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON in response: ' + text.slice(0, 200));
  }
  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error('Invalid JSON: ' + jsonMatch[0].slice(0, 300));
  }
  const audienceIds = Array.isArray(parsed.audienceIds)
    ? parsed.audienceIds.map((n) => parseInt(n, 10)).filter((n) => Number.isInteger(n) && n > 0)
    : [];
  const themeIds = Array.isArray(parsed.themeIds)
    ? parsed.themeIds.map((n) => parseInt(n, 10)).filter((n) => Number.isInteger(n) && n > 0)
    : [];
  return { audienceIds, themeIds };
}

async function main() {
  console.log('Backfill photoset config categories (UNPROCESSED ONLY). DRY_RUN =', DRY_RUN);

  if (!config.geminiApiKey) {
    console.error('GEMINI_API_KEY is required.');
    process.exit(1);
  }

  await sequelize.authenticate();
  console.log('DB connected.');

  const [audiences] = await sequelize.query(
    'SELECT Id, Name, SortOrder FROM [dbo].[Audiences] ORDER BY SortOrder ASC, Id ASC'
  );
  const [themes] = await sequelize.query(
    'SELECT Id, Name, ParentId, SortOrder FROM [dbo].[Themes] ORDER BY SortOrder ASC, Id ASC'
  );

  const [configs] = await sequelize.query(
    `SELECT c.Id, c.Description
     FROM [dbo].[PhotosetConfigs] c
     LEFT JOIN [dbo].[PhotosetConfigAudiences] pca ON pca.PhotosetConfigId = c.Id
     LEFT JOIN [dbo].[PhotosetConfigThemes] pct ON pct.PhotosetConfigId = c.Id
     WHERE pca.PhotosetConfigId IS NULL AND pct.PhotosetConfigId IS NULL`
  );

  const validAudienceIds = new Set(audiences.map((a) => a.Id));
  const validThemeIds = new Set(themes.map((t) => t.Id));

  console.log(
    'Audiences:',
    audiences.length,
    'Themes:',
    themes.length,
    'PhotosetConfigs without categories:',
    configs.length
  );

  for (const cfg of configs) {
    try {
      const { audienceIds, themeIds } = await classifyDescription(cfg.Description, audiences, themes);
      const filteredAudienceIds = audienceIds.filter((id) => validAudienceIds.has(id));
      const filteredThemeIds = themeIds.filter((id) => validThemeIds.has(id));

      if (DRY_RUN) {
        console.log(
          `PhotosetConfig ${cfg.Id}: audienceIds=[${filteredAudienceIds.join(',')}] themeIds=[${filteredThemeIds.join(',')}]`
        );
        continue;
      }

      await sequelize.transaction(async (t) => {
        await sequelize.query(
          'DELETE FROM [dbo].[PhotosetConfigAudiences] WHERE PhotosetConfigId = :configId',
          { replacements: { configId: cfg.Id }, transaction: t }
        );
        await sequelize.query(
          'DELETE FROM [dbo].[PhotosetConfigThemes] WHERE PhotosetConfigId = :configId',
          { replacements: { configId: cfg.Id }, transaction: t }
        );

        for (const aid of filteredAudienceIds) {
          await sequelize.query(
            'INSERT INTO [dbo].[PhotosetConfigAudiences] (PhotosetConfigId, AudienceId) VALUES (:configId, :audienceId)',
            { replacements: { configId: cfg.Id, audienceId: aid }, transaction: t }
          );
        }
        for (const tid of filteredThemeIds) {
          await sequelize.query(
            'INSERT INTO [dbo].[PhotosetConfigThemes] (PhotosetConfigId, ThemeId) VALUES (:configId, :themeId)',
            { replacements: { configId: cfg.Id, themeId: tid }, transaction: t }
          );
        }
      });

      console.log(
        `PhotosetConfig ${cfg.Id}: saved ${filteredAudienceIds.length} audiences, ${filteredThemeIds.length} themes.`
      );
    } catch (err) {
      console.error(`PhotosetConfig ${cfg.Id} error:`, err.message);
    }
  }

  console.log('Done.');
  await sequelize.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
