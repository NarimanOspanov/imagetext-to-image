'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      { tableName: 'RequiredChannels', schema: 'dbo' },
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
        JoinUrl: {
          type: Sequelize.STRING(500),
          allowNull: false,
        },
        IsActive: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        SortOrder: {
          type: Sequelize.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        CreatedAtUtc: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.fn('GETUTCDATE'),
        },
      }
    );

    await queryInterface.addIndex(
      { tableName: 'RequiredChannels', schema: 'dbo' },
      ['ChannelId'],
      { unique: true }
    );
    await queryInterface.addIndex(
      { tableName: 'RequiredChannels', schema: 'dbo' },
      ['IsActive', 'SortOrder']
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable({ tableName: 'RequiredChannels', schema: 'dbo' });
  },
};

