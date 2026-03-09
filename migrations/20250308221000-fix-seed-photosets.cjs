'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const qi = queryInterface;

    // If Photosets already has data, do nothing
    const [photosetCountRows] = await qi.sequelize.query(
      'SELECT COUNT(*) AS cnt FROM [dbo].[Photosets]'
    );
    const photosetCount = Number(photosetCountRows[0]?.cnt ?? photosetCountRows[0]?.CNT ?? 0);
    if (photosetCount > 0) {
      return;
    }

    // Load 3 configs ordered by Id
    const [configRows] = await qi.sequelize.query(
      'SELECT Id FROM [dbo].[PhotosetConfigs] ORDER BY Id ASC'
    );
    if (!configRows || configRows.length < 3) {
      // Not enough configs; nothing to do
      return;
    }

    // Load at least 12 presets in deterministic order
    const [presetRows] = await qi.sequelize.query(
      'SELECT Id FROM [dbo].[Presets] ORDER BY Id ASC'
    );
    if (!presetRows || presetRows.length < 12) {
      return;
    }

    const cfg1 = configRows[0].Id;
    const cfg2 = configRows[1].Id;
    const cfg3 = configRows[2].Id;

    const presets1 = presetRows.slice(0, 4).map((r) => r.Id);
    const presets2 = presetRows.slice(4, 8).map((r) => r.Id);
    const presets3 = presetRows.slice(8, 12).map((r) => r.Id);

    const rowsToInsert = [];
    for (const pid of presets1) rowsToInsert.push({ PhotosetConfigId: cfg1, PresetId: pid });
    for (const pid of presets2) rowsToInsert.push({ PhotosetConfigId: cfg2, PresetId: pid });
    for (const pid of presets3) rowsToInsert.push({ PhotosetConfigId: cfg3, PresetId: pid });

    if (rowsToInsert.length > 0) {
      await qi.bulkInsert({ tableName: 'Photosets', schema: 'dbo' }, rowsToInsert);
    }
  },

  async down(queryInterface) {
    const qi = queryInterface;
    await qi.bulkDelete({ tableName: 'Photosets', schema: 'dbo' }, null);
  },
};

