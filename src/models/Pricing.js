import { DataTypes } from 'sequelize';

/**
 * Code-first Pricing model. Package definitions (e.g. Новичок 10 images 199₽).
 */
export default function definePricing(sequelize) {
  const Pricing = sequelize.define(
    'Pricing',
    {
      Id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      Name: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      GenerationsCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      PriceRubles: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      PriceInStars: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      Tag: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      SortOrder: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      PriceUSD: {
        type: DataTypes.STRING(100),
        allowNull: false,
      }
    },
    {
      tableName: 'Pricings',
      schema: 'dbo',
      timestamps: false,
      indexes: [{ fields: ['SortOrder'] }],
    }
  );
  return Pricing;
}
