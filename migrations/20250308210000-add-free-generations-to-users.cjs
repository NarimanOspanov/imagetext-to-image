'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const [rows] = await queryInterface.sequelize.query(
      "SELECT 1 AS c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Users' AND COLUMN_NAME = 'FreeGenerationsRemaining'"
    );
    if (rows && rows.length > 0) return;
    await queryInterface.sequelize.query(
      'ALTER TABLE dbo.Users ADD FreeGenerationsRemaining INT NOT NULL CONSTRAINT DF_Users_FreeGenerationsRemaining DEFAULT 3'
    );
  },

  async down(queryInterface) {
    try {
      await queryInterface.sequelize.query(
        'ALTER TABLE dbo.Users DROP CONSTRAINT DF_Users_FreeGenerationsRemaining'
      );
    } catch (_) {}
    await queryInterface.removeColumn(
      { tableName: 'Users', schema: 'dbo' },
      'FreeGenerationsRemaining'
    );
  },
};
