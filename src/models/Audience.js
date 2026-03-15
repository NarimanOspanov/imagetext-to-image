import { DataTypes } from 'sequelize';

export default function defineAudience(sequelize) {
  const Audience = sequelize.define(
    'Audience',
    {
      Id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      Name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      SortOrder: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: 'Audiences',
      schema: 'dbo',
      timestamps: false,
    }
  );

  return Audience;
}
