'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const run = (sql) => queryInterface.sequelize.query(sql);

    try {
      await run(`ALTER TABLE [dbo].[UserPurchases] ADD [TelegramPaymentId] INT NULL`);
    } catch (e) {
      // Column may already exist from a previous partial run
    }

    try {
      await run(`CREATE INDEX [IX_UserPurchases_TelegramPaymentId] ON [dbo].[UserPurchases] ([TelegramPaymentId])`);
    } catch (e) {
      // Index may already exist
    }

    try {
      await run(
        `ALTER TABLE [dbo].[UserPurchases] ADD CONSTRAINT [FK_UserPurchases_TelegramPayments] FOREIGN KEY ([TelegramPaymentId]) REFERENCES [dbo].[TelegramPayments] ([Id]) ON UPDATE CASCADE ON DELETE SET NULL`
      );
    } catch (e) {
      // Constraint may already exist
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `ALTER TABLE [dbo].[UserPurchases] DROP CONSTRAINT [FK_UserPurchases_TelegramPayments]`
    );
    await queryInterface.sequelize.query(
      `DROP INDEX [IX_UserPurchases_TelegramPaymentId] ON [dbo].[UserPurchases]`
    ).catch(() => {});
    await queryInterface.sequelize.query(
      `ALTER TABLE [dbo].[UserPurchases] DROP COLUMN [TelegramPaymentId]`
    );
  },
};
