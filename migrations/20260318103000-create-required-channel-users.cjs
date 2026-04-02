'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      { tableName: 'RequiredChannelUsers', schema: 'dbo' },
      {
        Id: {
          type: Sequelize.INTEGER,
          autoIncrement: true,
          primaryKey: true,
          allowNull: false,
        },
        ChannelId: {
          type: Sequelize.STRING(64),
          allowNull: false,
        },
        UserId: {
          type: Sequelize.BIGINT,
          allowNull: false,
        },
        DateTime: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.fn('GETUTCDATE'),
        },
      }
    );

    await queryInterface.addIndex(
      { tableName: 'RequiredChannelUsers', schema: 'dbo' },
      ['ChannelId', 'UserId'],
      { unique: true }
    );
    await queryInterface.addIndex(
      { tableName: 'RequiredChannelUsers', schema: 'dbo' },
      ['DateTime']
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable({ tableName: 'RequiredChannelUsers', schema: 'dbo' });
  },
};

