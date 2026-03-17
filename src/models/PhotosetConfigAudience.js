import { DataTypes } from 'sequelize';

export default function definePhotosetConfigAudience(sequelize) {
  const PhotosetConfigAudience = sequelize.define(
    'PhotosetConfigAudience',
    {
      PhotosetConfigId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
      },
      AudienceId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
      },
    },
    {
      tableName: 'PhotosetConfigAudiences',
      schema: 'dbo',
      timestamps: false,
    }
  );
  return PhotosetConfigAudience;
}
