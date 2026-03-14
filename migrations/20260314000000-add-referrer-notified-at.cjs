'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn(
      { tableName: 'Referrals', schema: 'dbo' },
      'ReferrerNotifiedAt',
      {
        type: Sequelize.DATE,
        allowNull: true,
      }
    );
  },

  async down(queryInterface) {
    await queryInterface.removeColumn(
      { tableName: 'Referrals', schema: 'dbo' },
      'ReferrerNotifiedAt'
    );
  },
};
