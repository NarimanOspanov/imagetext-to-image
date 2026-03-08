'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      { tableName: 'UserImageGenerations', schema: 'dbo' },
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
        GeneratedAt: {
          type: Sequelize.DATE,
          allowNull: false,
        },
        ResultFileName: {
          type: Sequelize.STRING(255),
          allowNull: false,
        },
      }
    );
    await queryInterface.addIndex(
      { tableName: 'UserImageGenerations', schema: 'dbo' },
      ['UserId']
    );
    await queryInterface.addIndex(
      { tableName: 'UserImageGenerations', schema: 'dbo' },
      ['GeneratedAt']
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable({ tableName: 'UserImageGenerations', schema: 'dbo' });
  },
};
