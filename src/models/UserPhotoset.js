import { DataTypes } from 'sequelize';

export default function defineUserPhotoset(sequelize) {
  const UserPhotoset = sequelize.define(
    'UserPhotoset',
    {
      Id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      UserId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'Id' },
      },
      PhotosetId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'Photosets', key: 'Id' },
      },
      DateTimeUtc: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      NumberOfPicturesInPhotoset: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
    },
    {
      tableName: 'UserPhotosets',
      schema: 'dbo',
      timestamps: false,
      indexes: [
        { fields: ['UserId'] },
        { fields: ['PhotosetId'] },
        { fields: ['DateTimeUtc'] },
      ],
    }
  );

  return UserPhotoset;
}

