'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn(
      { tableName: 'PromoCodes', schema: 'dbo' },
      'InitialGenerations',
      {
        type: Sequelize.INTEGER,
        allowNull: true,
      }
    );
  },

  async down(queryInterface) {
    await queryInterface.removeColumn(
      { tableName: 'PromoCodes', schema: 'dbo' },
      'InitialGenerations'
    );
  },
};
