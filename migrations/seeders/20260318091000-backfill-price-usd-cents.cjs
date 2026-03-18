'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // NOTE: Adjust these numbers to your real USD pricing.
    // This seeder provides a safe placeholder backfill based on SortOrder.
    // Values are in USD cents.
    await queryInterface.sequelize.query(`
      UPDATE [dbo].[Pricings] SET [PriceUsdCents] = 199 WHERE [SortOrder] = 1 AND [PriceUsdCents] IS NULL;
      UPDATE [dbo].[Pricings] SET [PriceUsdCents] = 399 WHERE [SortOrder] = 2 AND [PriceUsdCents] IS NULL;
      UPDATE [dbo].[Pricings] SET [PriceUsdCents] = 899 WHERE [SortOrder] = 3 AND [PriceUsdCents] IS NULL;
      UPDATE [dbo].[Pricings] SET [PriceUsdCents] = 1499 WHERE [SortOrder] = 4 AND [PriceUsdCents] IS NULL;
      UPDATE [dbo].[Pricings] SET [PriceUsdCents] = 2499 WHERE [SortOrder] = 5 AND [PriceUsdCents] IS NULL;
    `);
  },

  async down(queryInterface) {
    // Revert only the placeholder values to NULL.
    await queryInterface.sequelize.query(`
      UPDATE [dbo].[Pricings] SET [PriceUsdCents] = NULL
      WHERE [PriceUsdCents] IN (199,399,899,1499,2499);
    `);
  },
};

