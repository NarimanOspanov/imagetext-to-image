"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;

    async function columnExists(tableName, columnName) {
      const [rows] = await qi.sequelize.query(
        `SELECT 1 AS existsFlag
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = :table AND COLUMN_NAME = :col`,
        { replacements: { table: tableName, col: columnName } }
      );
      return rows.length > 0;
    }

    if (!(await columnExists('Referrals', 'BonusRemaining'))) {
      await qi.addColumn(
        { tableName: 'Referrals', schema: 'dbo' },
        'BonusRemaining',
        {
          type: Sequelize.INTEGER,
          allowNull: true,
        }
      );
    }

    // Initialize BonusRemaining for existing rows where bonus was not yet fully used.
    // Try to read GenerationsPerReferral from Configs; fallback to 5.
    let generationsPerReferral = 5;
    try {
      const [rows] = await qi.sequelize.query(
        "SELECT TOP 1 Value FROM [dbo].[Config] WHERE Keys = 'GenerationsPerReferral'"
      );
      if (rows && rows.length > 0) {
        const val = parseInt(rows[0].Value, 10);
        if (Number.isInteger(val) && val > 0) generationsPerReferral = val;
      }
    } catch (e) {
      // If Config table doesn't exist yet or query fails, keep default 5.
    }

    await qi.sequelize.query(
      `UPDATE [dbo].[Referrals]
       SET BonusRemaining = CASE
         WHEN BonusUsed = 0 THEN :gpr
         ELSE 0
       END
       WHERE BonusRemaining IS NULL`,
      { replacements: { gpr: generationsPerReferral } }
    );
  },

  async down(queryInterface) {
    const qi = queryInterface;
    await qi.removeColumn({ tableName: 'Referrals', schema: 'dbo' }, 'BonusRemaining');
  },
};

