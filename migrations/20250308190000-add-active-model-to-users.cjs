'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn(
      { tableName: 'Users', schema: 'dbo' },
      'ActiveModel',
      {
        type: Sequelize.STRING(50),
        allowNull: true,
      }
    );
  },

  async down(queryInterface) {
    await queryInterface.removeColumn(
      { tableName: 'Users', schema: 'dbo' },
      'ActiveModel'
    );
  },
};
