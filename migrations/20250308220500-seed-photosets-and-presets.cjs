'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;

    async function tableIsEmpty(tableName) {
      const [rows] = await qi.sequelize.query(
        `SELECT COUNT(*) AS cnt FROM [dbo].[${tableName}]`
      );
      const count = rows[0]?.cnt ?? rows[0]?.CNT ?? 0;
      return Number(count) === 0;
    }

    // 1) Seed PhotosetConfigs if empty
    if (await tableIsEmpty('PhotosetConfigs')) {
      await qi.bulkInsert(
        { tableName: 'PhotosetConfigs', schema: 'dbo' },
        [
          {
            Name: 'Стильная студийная съемка для пары ❤️',
            Description:
              'Как получить: оплати по кнопке ниже, загрузи фото и получи готовый фотосет в течении 3х минут!\n\nЭти кадры отлично будут смотреться в ваших соцсетях',
            Image: '1.jpg',
          },
          {
            Name: 'Женский фотосет к 14 февраля 💕',
            Description:
              'Как получить: оплати по кнопке ниже, загрузи фото и получи готовый фотосет в течении 3х минут!\n\nЭти кадры передают атмосферу праздника и смотрятся очень эффектно\n\nЭти кадры отлично будут смотреться в ваших соцсетях',
            Image: '2.jpg',
          },
          {
            Name: 'Валентинки в стиле Love is по вашей совместной фотографии 💕',
            Description:
              'Как получить: оплати по кнопке ниже, загрузи фото и получи готовый фотосет в течении 3х минут!\n\nКак получить: оплати по кнопке ниже, загрузи фото и получи готовый фотосет в течении 3х минут!\n\nПорадуй его / её на День Святого Валентина',
            Image: '3.jpg',
          },
        ]
      );
    }

    // Reload configs (we rely on Name matching the three above)
    const [configRows] = await qi.sequelize.query(
      "SELECT Id, Name FROM [dbo].[PhotosetConfigs] WHERE Name IN (" +
        "'Стильная студийная съемка для пары ❤️'," +
        "'Женский фотосет к 14 февраля 💕'," +
        "'Валентинки в стиле Love is по вашей совместной фотографии 💕'" +
        ')'
    );
    const configsByName = {};
    for (const row of configRows) {
      configsByName[row.Name] = row.Id;
    }

    // 2) Seed Presets (text prompts)
    const presetPrompts = [
      // Стильная студийная съемка для пары ❤️
      'Стильная студийная съемка для пары в классических чёрных нарядах, мягкий студийный свет, нейтральный тёмный фон, лёгкая глянцевая обработка, акцент на эмоциях и близости.',
      'Портрет пары по пояс, он и она в элегантных образах, мягкий свет сбоку, лёгкий блеск на коже, стильный минималистичный фон, кинематографичный кадр.',
      'Пара сидит на тёмном диване в студии, строгие позы, уверенный взгляд в камеру, модный журнальный стиль, аккуратная цветокоррекция без перегруза.',
      'Парень дарит девушке большой букет красных роз, искренние улыбки, студийный свет, минимальный фон, акцент на эмоциях и деталях букета.',

      // Женский фотосет к 14 февраля 💕
      'Романтичный женский портрет в розовом платье, мягкий розовый фон, сердечки и лёгкий боке, атмосфера праздника и влюблённости.',
      'Девушка сидит с большим розовым сердцем в стиле открытки, нежные пастельные оттенки, лёгкий винтажный эффект, иллюстративный стиль Love is.',
      'Женский портрет в студии с шарами-сердцами, розовая гамма, мягкий свет, воздушное настроение, акцент на улыбке и взгляде.',
      'Девушка позирует сидя на полу на фоне сердечного света, романтичный образ, плавные линии позы, аккуратная обработка кожи и платья.',

      // Валентинки в стиле Love is 💕
      'Иллюстрация в стиле Love is: влюблённая пара сидит рядом, тёплые пастельные цвета, лёгкая штриховка, уютная атмосфера, подпись внизу открытки.',
      'Love is: пара обнимается, тёплый домашний интерьер, мягкий свет, акцент на эмоциях и мимике, стиль журнальной иллюстрации.',
      'Открытка Love is: пара идёт по дороге, фон с лёгкими сердечками, тёплые оттенки, рукописная подпись внизу кадра.',
      'Love is: нежные объятия пары, крупный портрет, мягкий свет, рисованный стиль карандаш+цифровая заливка, романтичное настроение.',
    ];

    // Insert presets only if none of these prompts exist yet
    const [existingPresets] = await qi.sequelize.query(
      'SELECT Prompt FROM [dbo].[Presets] WHERE Prompt IN (' +
        presetPrompts.map((p) => "'" + p.replace(/'/g, "''") + "'").join(',') +
        ')'
    );
    const existingPromptSet = new Set(existingPresets.map((r) => r.Prompt));
    const presetsToInsert = presetPrompts
      .filter((p) => !existingPromptSet.has(p))
      .map((p) => ({ Prompt: p }));

    if (presetsToInsert.length > 0) {
      await qi.bulkInsert({ tableName: 'Presets', schema: 'dbo' }, presetsToInsert);
    }

    const [presetRows] = await qi.sequelize.query(
      'SELECT Id, Prompt FROM [dbo].[Presets] WHERE Prompt IN (' +
        presetPrompts.map((p) => "'" + p.replace(/'/g, "''") + "'").join(',') +
        ')'
    );
    const presetByPrompt = {};
    for (const row of presetRows) {
      presetByPrompt[row.Prompt] = row.Id;
    }

    // 3) Seed Photosets (link configs to presets)
    const photosetsToInsert = [];

    function addPhotosetRows(configName, prompts) {
      const configId = configsByName[configName];
      if (!configId) return;
      for (const p of prompts) {
        const presetId = presetByPrompt[p];
        if (!presetId) continue;
        photosetsToInsert.push({
          PhotosetConfigId: configId,
          PresetId: presetId,
        });
      }
    }

    addPhotosetRows('Стильная студийная съемка для пары ❤️', presetPrompts.slice(0, 4));
    addPhotosetRows('Женский фотосет к 14 февраля 💕', presetPrompts.slice(4, 8));
    addPhotosetRows(
      'Валентинки в стиле Love is по вашей совместной фотографии 💕',
      presetPrompts.slice(8, 12)
    );

    if (photosetsToInsert.length > 0) {
      // Avoid duplicating rows: only insert combinations that do not exist yet
      const [existingPhotosets] = await qi.sequelize.query(
        'SELECT PhotosetConfigId, PresetId FROM [dbo].[Photosets]'
      );
      const existingSet = new Set(
        existingPhotosets.map(
          (r) => `${r.PhotosetConfigId}:${r.PresetId}`
        )
      );
      const finalToInsert = photosetsToInsert.filter(
        (r) => !existingSet.has(`${r.PhotosetConfigId}:${r.PresetId}`)
      );
      if (finalToInsert.length > 0) {
        await qi.bulkInsert({ tableName: 'Photosets', schema: 'dbo' }, finalToInsert);
      }
    }
  },

  async down(queryInterface) {
    const qi = queryInterface;

    const presetPrompts = [
      'Стильная студийная съемка для пары в классических чёрных нарядах, мягкий студийный свет, нейтральный тёмный фон, лёгкая глянцевая обработка, акцент на эмоциях и близости.',
      'Портрет пары по пояс, он и она в элегантных образах, мягкий свет сбоку, лёгкий блеск на коже, стильный минималистичный фон, кинематографичный кадр.',
      'Пара сидит на тёмном диване в студии, строгие позы, уверенный взгляд в камеру, модный журнальный стиль, аккуратная цветокоррекция без перегруза.',
      'Парень дарит девушке большой букет красных роз, искренние улыбки, студийный свет, минимальный фон, акцент на эмоциях и деталях букета.',
      'Романтичный женский портрет в розовом платье, мягкий розовый фон, сердечки и лёгкий боке, атмосфера праздника и влюблённости.',
      'Девушка сидит с большим розовым сердцем в стиле открытки, нежные пастельные оттенки, лёгкий винтажный эффект, иллюстративный стиль Love is.',
      'Женский портрет в студии с шарами-сердцами, розовая гамма, мягкий свет, воздушное настроение, акцент на улыбке и взгляде.',
      'Девушка позирует сидя на полу на фоне сердечного света, романтичный образ, плавные линии позы, аккуратная обработка кожи и платья.',
      'Иллюстрация в стиле Love is: влюблённая пара сидит рядом, тёплые пастельные цвета, лёгкая штриховка, уютная атмосфера, подпись внизу открытки.',
      'Love is: пара обнимается, тёплый домашний интерьер, мягкий свет, акцент на эмоциях и мимике, стиль журнальной иллюстрации.',
      'Открытка Love is: пара идёт по дороге, фон с лёгкими сердечками, тёплые оттенки, рукописная подпись внизу кадра.',
      'Love is: нежные объятия пары, крупный портрет, мягкий свет, рисованный стиль карандаш+цифровая заливка, романтичное настроение.',
    ];

    // Delete Photosets that link to our presets/configs
    await qi.bulkDelete(
      { tableName: 'Photosets', schema: 'dbo' },
      null
    );

    // Delete our Presets
    await qi.bulkDelete(
      { tableName: 'Presets', schema: 'dbo' },
      {
        Prompt: presetPrompts,
      }
    );

    // Delete our PhotosetConfigs
    await qi.bulkDelete(
      { tableName: 'PhotosetConfigs', schema: 'dbo' },
      {
        Name: [
          'Стильная студийная съемка для пары ❤️',
          'Женский фотосет к 14 февраля 💕',
          'Валентинки в стиле Love is по вашей совместной фотографии 💕',
        ],
      }
    );
  },
};

