'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn(
      { tableName: 'Pricings', schema: 'dbo' },
      'PriceUsdCents',
      {
        type: Sequelize.INTEGER,
        allowNull: true,
      }
    );
    await queryInterface.addIndex(
      { tableName: 'Pricings', schema: 'dbo' },
      ['PriceUsdCents']
    );
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      { tableName: 'Pricings', schema: 'dbo' },
      ['PriceUsdCents']
    );
    await queryInterface.removeColumn(
      { tableName: 'Pricings', schema: 'dbo' },
      'PriceUsdCents'
    );
  },
};

