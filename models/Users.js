const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('Users', {
    Id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    TelegramUserName: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    TelegramChatId: {
      type: DataTypes.BIGINT,
      allowNull: false,
      unique: "UQ__Users__1925E0220F944409"
    },
    DateJoined: {
      type: DataTypes.DATE,
      allowNull: false
    },
    Promocode: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    IsBlocked: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    MuteBotUntil: {
      type: DataTypes.DATE,
      allowNull: true
    },
    Timezone: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    sequelize,
    tableName: 'Users',
    schema: 'dbo',
    timestamps: false,
    indexes: [
      {
        name: "PK__Users__3214EC07E7CF45EB",
        unique: true,
        fields: [
          { name: "Id" },
        ]
      },
      {
        name: "UQ__Users__1925E0220F944409",
        unique: true,
        fields: [
          { name: "TelegramChatId" },
        ]
      },
    ]
  });
};
