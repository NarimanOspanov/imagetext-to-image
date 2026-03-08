'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.removeColumn(
      { tableName: 'Users', schema: 'dbo' },
      'GenerationsCount'
    );
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn(
      { tableName: 'Users', schema: 'dbo' },
      'GenerationsCount',
      {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 3,
      }
    );
  },
};
