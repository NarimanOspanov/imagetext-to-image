'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      { tableName: 'UserPurchases', schema: 'dbo' },
      {
        Id: {
          type: Sequelize.INTEGER,
          autoIncrement: true,
          primaryKey: true,
          allowNull: false,
        },
        UserId: {
          type: Sequelize.INTEGER,
          allowNull: false,
          references: { model: { tableName: 'Users', schema: 'dbo' }, key: 'Id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        PricingId: {
          type: Sequelize.INTEGER,
          allowNull: false,
          references: { model: { tableName: 'Pricings', schema: 'dbo' }, key: 'Id' },
          onUpdate: 'CASCADE',
          onDelete: 'NO ACTION',
        },
        PurchasedAt: {
          type: Sequelize.DATE,
          allowNull: false,
        },
        GenerationsIncluded: {
          type: Sequelize.INTEGER,
          allowNull: false,
        },
        BalanceRemaining: {
          type: Sequelize.INTEGER,
          allowNull: false,
        },
      }
    );
    await queryInterface.addIndex(
      { tableName: 'UserPurchases', schema: 'dbo' },
      ['UserId']
    );
    await queryInterface.addIndex(
      { tableName: 'UserPurchases', schema: 'dbo' },
      ['PurchasedAt']
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable({ tableName: 'UserPurchases', schema: 'dbo' });
  },
};
