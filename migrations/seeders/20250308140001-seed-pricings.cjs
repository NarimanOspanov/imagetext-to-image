'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const now = new Date();
    await queryInterface.bulkInsert(
      { tableName: 'Pricings', schema: 'dbo' },
      [
        { Name: 'Новичок', GenerationsCount: 10, PriceRubles: 199, PriceInStars: 130, Tag: null, SortOrder: 1 },
        { Name: 'Базовый', GenerationsCount: 25, PriceRubles: 399, PriceInStars: 270, Tag: null, SortOrder: 2 },
        { Name: 'Стандарт', GenerationsCount: 100, PriceRubles: 899, PriceInStars: 540, Tag: 'Рекомендуем', SortOrder: 3 },
        { Name: 'Продвинутый', GenerationsCount: 250, PriceRubles: 1499, PriceInStars: 890, Tag: 'Удобно', SortOrder: 4 },
        { Name: 'Генератор', GenerationsCount: 500, PriceRubles: 2499, PriceInStars: 1490, Tag: 'VIP', SortOrder: 5 },
      ],
      {}
    );
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete(
      { tableName: 'Pricings', schema: 'dbo' },
      null,
      {}
    );
  },
};
