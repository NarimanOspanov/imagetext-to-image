'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      { tableName: 'Referrals', schema: 'dbo' },
      {
        Id: {
          type: Sequelize.INTEGER,
          autoIncrement: true,
          primaryKey: true,
          allowNull: false,
        },
        ReferrerUserId: {
          type: Sequelize.INTEGER,
          allowNull: false,
          references: { model: { tableName: 'Users', schema: 'dbo' }, key: 'Id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        ReferredUserId: {
          type: Sequelize.INTEGER,
          allowNull: false,
          references: { model: { tableName: 'Users', schema: 'dbo' }, key: 'Id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        ReferredAt: {
          type: Sequelize.DATE,
          allowNull: false,
        },
        BonusUsed: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
      }
    );
    await queryInterface.addIndex(
      { tableName: 'Referrals', schema: 'dbo' },
      ['ReferrerUserId']
    );
    await queryInterface.addIndex(
      { tableName: 'Referrals', schema: 'dbo' },
      ['ReferredUserId']
    );
    await queryInterface.addIndex(
      { tableName: 'Referrals', schema: 'dbo' },
      ['ReferrerUserId', 'ReferredUserId'],
      { unique: true }
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable({ tableName: 'Referrals', schema: 'dbo' });
  },
};
