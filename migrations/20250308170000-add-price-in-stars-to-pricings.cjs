'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn(
      { tableName: 'Pricings', schema: 'dbo' },
      'PriceInStars',
      {
        type: Sequelize.INTEGER,
        allowNull: true,
      }
    );
    // Backfill from image-style pricing: 10→130, 25→270, 100→540, 250→890, 500→1490
    await queryInterface.sequelize.query(`
      UPDATE [dbo].[Pricings] SET [PriceInStars] = 130 WHERE [SortOrder] = 1;
      UPDATE [dbo].[Pricings] SET [PriceInStars] = 270 WHERE [SortOrder] = 2;
      UPDATE [dbo].[Pricings] SET [PriceInStars] = 540 WHERE [SortOrder] = 3;
      UPDATE [dbo].[Pricings] SET [PriceInStars] = 890 WHERE [SortOrder] = 4;
      UPDATE [dbo].[Pricings] SET [PriceInStars] = 1490 WHERE [SortOrder] = 5;
    `);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn(
      { tableName: 'Pricings', schema: 'dbo' },
      'PriceInStars'
    );
  },
};
