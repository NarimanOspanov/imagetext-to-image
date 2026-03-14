import { DataTypes } from 'sequelize';

/**
 * Partner promocodes for deeplink tracking. Link format: t.me/BotName?start=promo_CODE.
 * When a new user starts with this link, Users.Promocode is set to this Code so we track attribution.
 */
export default function definePromoCode(sequelize) {
  const PromoCode = sequelize.define(
    'PromoCode',
    {
      Id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      Code: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true,
        comment: 'Partner code, e.g. JOHN; used in start=promo_JOHN',
      },
      Label: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: 'Optional display name for the partner/campaign',
      },
      OwnerUserId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'Users', key: 'Id' },
        comment: 'Optional: User (partner) who owns this code',
      },
      InitialGenerations: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Free generations for new users who register via this code; null = use global default',
      },
      CreatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: sequelize.options.dialect === 'mssql' ? sequelize.literal('GETUTCDATE()') : DataTypes.NOW,
      },
    },
    {
      tableName: 'PromoCodes',
      schema: 'dbo',
      timestamps: false,
      indexes: [
        { unique: true, fields: ['Code'] },
        { fields: ['OwnerUserId'] },
      ],
    }
  );
  return PromoCode;
}
