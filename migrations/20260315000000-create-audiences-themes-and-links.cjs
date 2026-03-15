'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;

    async function tableExists(tableName) {
      const [rows] = await qi.sequelize.query(
        "SELECT 1 AS existsFlag FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = :name",
        { replacements: { name: tableName } }
      );
      return rows.length > 0;
    }

    async function indexExists(tableName, indexName) {
      const [rows] = await qi.sequelize.query(
        'SELECT 1 AS existsFlag FROM sys.indexes WHERE name = :indexName AND object_id = OBJECT_ID(:fullName)',
        {
          replacements: {
            indexName,
            fullName: `dbo.${tableName}`,
          },
        }
      );
      return rows.length > 0;
    }

    // Audiences
    if (!(await tableExists('Audiences'))) {
      await qi.createTable(
        { tableName: 'Audiences', schema: 'dbo' },
        {
          Id: {
            type: Sequelize.INTEGER,
            autoIncrement: true,
            primaryKey: true,
            allowNull: false,
          },
          Name: {
            type: Sequelize.STRING(255),
            allowNull: false,
          },
          SortOrder: {
            type: Sequelize.INTEGER,
            allowNull: false,
            defaultValue: 0,
          },
        }
      );
    }

    // Themes (create without self-FK first; add FK after so MSSQL accepts it)
    if (!(await tableExists('Themes'))) {
      await qi.createTable(
        { tableName: 'Themes', schema: 'dbo' },
        {
          Id: {
            type: Sequelize.INTEGER,
            autoIncrement: true,
            primaryKey: true,
            allowNull: false,
          },
          Name: {
            type: Sequelize.STRING(255),
            allowNull: false,
          },
          ParentId: {
            type: Sequelize.INTEGER,
            allowNull: true,
          },
          SortOrder: {
            type: Sequelize.INTEGER,
            allowNull: false,
            defaultValue: 0,
          },
        }
      );
    }
    // Optional: self-FK on Themes. Skipped to avoid dialect issues; ParentId is still used by app.
    // if (await tableExists('Themes')) {
    //   const [fkRows] = await qi.sequelize.query(
    //     "SELECT 1 AS ok FROM sys.foreign_keys WHERE parent_object_id = OBJECT_ID('dbo.Themes') AND name = 'FK_Themes_Parent'"
    //   );
    //   if (!fkRows || fkRows.length === 0) {
    //     await qi.sequelize.query(
    //       'ALTER TABLE [dbo].[Themes] ADD CONSTRAINT [FK_Themes_Parent] FOREIGN KEY ([ParentId]) REFERENCES [dbo].[Themes] ([Id]) ON UPDATE CASCADE ON DELETE SET NULL'
    //     );
    //   }
    // }
    if (!(await indexExists('Themes', 'themes__parent_id'))) {
      await qi.addIndex({ tableName: 'Themes', schema: 'dbo' }, ['ParentId']);
    }

    // PresetAudiences
    if (!(await tableExists('PresetAudiences'))) {
      await qi.createTable(
        { tableName: 'PresetAudiences', schema: 'dbo' },
        {
          PresetId: {
            type: Sequelize.INTEGER,
            allowNull: false,
            primaryKey: true,
            references: { model: { tableName: 'Presets', schema: 'dbo' }, key: 'Id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          AudienceId: {
            type: Sequelize.INTEGER,
            allowNull: false,
            primaryKey: true,
            references: { model: { tableName: 'Audiences', schema: 'dbo' }, key: 'Id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
        }
      );
    }
    if (!(await indexExists('PresetAudiences', 'preset_audiences__preset_id'))) {
      await qi.addIndex({ tableName: 'PresetAudiences', schema: 'dbo' }, ['PresetId']);
    }
    if (!(await indexExists('PresetAudiences', 'preset_audiences__audience_id'))) {
      await qi.addIndex({ tableName: 'PresetAudiences', schema: 'dbo' }, ['AudienceId']);
    }

    // PresetThemes
    if (!(await tableExists('PresetThemes'))) {
      await qi.createTable(
        { tableName: 'PresetThemes', schema: 'dbo' },
        {
          PresetId: {
            type: Sequelize.INTEGER,
            allowNull: false,
            primaryKey: true,
            references: { model: { tableName: 'Presets', schema: 'dbo' }, key: 'Id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          ThemeId: {
            type: Sequelize.INTEGER,
            allowNull: false,
            primaryKey: true,
            references: { model: { tableName: 'Themes', schema: 'dbo' }, key: 'Id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
        }
      );
    }
    if (!(await indexExists('PresetThemes', 'preset_themes__preset_id'))) {
      await qi.addIndex({ tableName: 'PresetThemes', schema: 'dbo' }, ['PresetId']);
    }
    if (!(await indexExists('PresetThemes', 'preset_themes__theme_id'))) {
      await qi.addIndex({ tableName: 'PresetThemes', schema: 'dbo' }, ['ThemeId']);
    }

    // Seed Audiences (only if empty)
    const [audienceCount] = await qi.sequelize.query('SELECT COUNT(*) AS cnt FROM [dbo].[Audiences]');
    const ac = audienceCount[0]?.cnt ?? audienceCount[0]?.CNT ?? 0;
    if (Number(ac) === 0) {
      await qi.bulkInsert(
        { tableName: 'Audiences', schema: 'dbo' },
        [
          { Name: 'Женский', SortOrder: 1 },
          { Name: 'Мужской', SortOrder: 2 },
          { Name: 'Парный', SortOrder: 3 },
          { Name: 'Семейный', SortOrder: 4 },
          { Name: 'Детский', SortOrder: 5 },
        ]
      );
    }

    // Seed Themes: parents first, then children (only if empty)
    const [themeCount] = await qi.sequelize.query('SELECT COUNT(*) AS cnt FROM [dbo].[Themes]');
    const tc = themeCount[0]?.cnt ?? themeCount[0]?.CNT ?? 0;
    if (Number(tc) === 0) {
      const parentThemes = [
        { Name: 'Lifestyle', ParentId: null, SortOrder: 1 },
        { Name: 'Стиль и мода', ParentId: null, SortOrder: 2 },
        { Name: 'Прически и внешний вид', ParentId: null, SortOrder: 3 },
        { Name: 'Одежда', ParentId: null, SortOrder: 4 },
        { Name: 'Примерка образов', ParentId: null, SortOrder: 5 },
        { Name: 'Социальные сети', ParentId: null, SortOrder: 6 },
        { Name: 'Подарочные фотосессии', ParentId: null, SortOrder: 7 },
        { Name: 'Спорт и активности', ParentId: null, SortOrder: 8 },
        { Name: 'Праздники', ParentId: null, SortOrder: 9 },
        { Name: 'Приколы и мемы', ParentId: null, SortOrder: 10 },
      ];
      await qi.bulkInsert({ tableName: 'Themes', schema: 'dbo' }, parentThemes);

      const [parentRows] = await qi.sequelize.query(
        "SELECT Id, Name FROM [dbo].[Themes] WHERE ParentId IS NULL ORDER BY SortOrder, Id"
      );
      const parentById = {};
      (parentRows || []).forEach((r) => {
        const id = r.Id ?? r.id;
        const name = r.Name ?? r.name;
        if (name != null) parentById[name] = id;
      });

      const childThemes = [
        { Name: 'Прогулки', ParentId: parentById['Lifestyle'], SortOrder: 1 },
        { Name: 'Путешествия', ParentId: parentById['Lifestyle'], SortOrder: 2 },
        { Name: 'Кафе', ParentId: parentById['Lifestyle'], SortOrder: 3 },
        { Name: 'Отдых', ParentId: parentById['Lifestyle'], SortOrder: 4 },
        { Name: 'Fashion', ParentId: parentById['Стиль и мода'], SortOrder: 1 },
        { Name: 'Street style', ParentId: parentById['Стиль и мода'], SortOrder: 2 },
        { Name: 'Блогер стиль', ParentId: parentById['Стиль и мода'], SortOrder: 3 },
        { Name: 'Деловой стиль', ParentId: parentById['Стиль и мода'], SortOrder: 4 },
        { Name: 'Luxury стиль', ParentId: parentById['Стиль и мода'], SortOrder: 5 },
        { Name: 'Новые стрижки', ParentId: parentById['Прически и внешний вид'], SortOrder: 1 },
        { Name: 'Барбершоп стиль', ParentId: parentById['Прически и внешний вид'], SortOrder: 2 },
        { Name: 'Укладки', ParentId: parentById['Прически и внешний вид'], SortOrder: 3 },
        { Name: 'Beauty портреты', ParentId: parentById['Прически и внешний вид'], SortOrder: 4 },
        { Name: 'Деловые костюмы', ParentId: parentById['Одежда'], SortOrder: 1 },
        { Name: 'Вечерние образы', ParentId: parentById['Одежда'], SortOrder: 2 },
        { Name: 'Спортивная одежда', ParentId: parentById['Одежда'], SortOrder: 3 },
        { Name: 'Сезонные образы', ParentId: parentById['Одежда'], SortOrder: 4 },
        { Name: 'Очки', ParentId: parentById['Примерка образов'], SortOrder: 1 },
        { Name: 'Одежда', ParentId: parentById['Примерка образов'], SortOrder: 2 },
        { Name: 'Аксессуары', ParentId: parentById['Примерка образов'], SortOrder: 3 },
        { Name: 'Новые стили', ParentId: parentById['Примерка образов'], SortOrder: 4 },
        {
          Name: 'LinkedIn: деловые портреты, профессиональные профили',
          ParentId: parentById['Социальные сети'],
          SortOrder: 1,
        },
        {
          Name: 'Tinder: лайфстайл, прогулки, путешествия',
          ParentId: parentById['Социальные сети'],
          SortOrder: 2,
        },
        { Name: 'Романтические фотосеты', ParentId: parentById['Подарочные фотосессии'], SortOrder: 1 },
        { Name: 'Фотосессии для пары', ParentId: parentById['Подарочные фотосессии'], SortOrder: 2 },
        { Name: 'Праздничные фото', ParentId: parentById['Подарочные фотосессии'], SortOrder: 3 },
        { Name: 'Фитнес', ParentId: parentById['Спорт и активности'], SortOrder: 1 },
        { Name: 'Тренировки', ParentId: parentById['Спорт и активности'], SortOrder: 2 },
        { Name: 'Футбол', ParentId: parentById['Спорт и активности'], SortOrder: 3 },
        { Name: 'Рыбалка', ParentId: parentById['Спорт и активности'], SortOrder: 4 },
        { Name: 'Походы', ParentId: parentById['Спорт и активности'], SortOrder: 5 },
        { Name: 'Новый год', ParentId: parentById['Праздники'], SortOrder: 1 },
        { Name: 'День рождения', ParentId: parentById['Праздники'], SortOrder: 2 },
        { Name: 'Свадьба', ParentId: parentById['Праздники'], SortOrder: 3 },
        { Name: 'Свидание', ParentId: parentById['Праздники'], SortOrder: 4 },
        { Name: 'Мемные фотосессии', ParentId: parentById['Приколы и мемы'], SortOrder: 1 },
        { Name: 'Смешные сцены', ParentId: parentById['Приколы и мемы'], SortOrder: 2 },
        { Name: 'Пародии', ParentId: parentById['Приколы и мемы'], SortOrder: 3 },
        { Name: 'Шуточные фотомонтажи', ParentId: parentById['Приколы и мемы'], SortOrder: 4 },
      ].filter((t) => t.ParentId != null);

      await qi.bulkInsert({ tableName: 'Themes', schema: 'dbo' }, childThemes);
    }
  },

  async down(queryInterface) {
    const qi = queryInterface;
    await qi.dropTable({ tableName: 'PresetThemes', schema: 'dbo' });
    await qi.dropTable({ tableName: 'PresetAudiences', schema: 'dbo' });
    await qi.dropTable({ tableName: 'Themes', schema: 'dbo' });
    await qi.dropTable({ tableName: 'Audiences', schema: 'dbo' });
  },
};
