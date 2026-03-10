'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      { tableName: 'Pricings', schema: 'dbo' },
      {
        Id: {
          type: Sequelize.INTEGER,
          autoIncrement: true,
          primaryKey: true,
          allowNull: false,
        },
        Name: {
          type: Sequelize.STRING(100),
          allowNull: false,
        },
        GenerationsCount: {
          type: Sequelize.INTEGER,
          allowNull: false,
        },
        PriceRubles: {
          type: Sequelize.INTEGER,
          allowNull: false,
        },
        Tag: {
          type: Sequelize.STRING(50),
          allowNull: true,
        },
        SortOrder: {
          type: Sequelize.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
      }
    );
    await queryInterface.addIndex(
      { tableName: 'Pricings', schema: 'dbo' },
      ['SortOrder']
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable({ tableName: 'Pricings', schema: 'dbo' });
  },
};
