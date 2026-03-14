'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      { tableName: 'PromoCodes', schema: 'dbo' },
      {
        Id: {
          type: Sequelize.INTEGER,
          autoIncrement: true,
          primaryKey: true,
          allowNull: false,
        },
        Code: {
          type: Sequelize.STRING(50),
          allowNull: false,
        },
        Label: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        OwnerUserId: {
          type: Sequelize.INTEGER,
          allowNull: true,
          references: { model: { tableName: 'Users', schema: 'dbo' }, key: 'Id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        CreatedAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('GETUTCDATE()'),
        },
      }
    );
    await queryInterface.addIndex(
      { tableName: 'PromoCodes', schema: 'dbo' },
      ['Code'],
      { unique: true }
    );
    await queryInterface.addIndex(
      { tableName: 'PromoCodes', schema: 'dbo' },
      ['OwnerUserId']
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable({ tableName: 'PromoCodes', schema: 'dbo' });
  },
};
