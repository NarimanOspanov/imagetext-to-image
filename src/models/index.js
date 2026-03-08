import defineUser from './User.js';
import defineUserImageGeneration from './UserImageGeneration.js';
import definePricing from './Pricing.js';
import defineUserPurchase from './UserPurchase.js';
import defineTelegramPayment from './TelegramPayment.js';
import defineReferral from './Referral.js';

/**
 * Initialize code-first models and associations. Call with the shared Sequelize instance.
 */
export function initModels(sequelize) {
  const User = defineUser(sequelize);
  const UserImageGeneration = defineUserImageGeneration(sequelize);
  const Pricing = definePricing(sequelize);
  const UserPurchase = defineUserPurchase(sequelize);
  const TelegramPayment = defineTelegramPayment(sequelize);
  const Referral = defineReferral(sequelize);

  User.hasMany(UserImageGeneration, { foreignKey: 'UserId' });
  UserImageGeneration.belongsTo(User, { foreignKey: 'UserId' });

  Pricing.hasMany(UserPurchase, { foreignKey: 'PricingId' });
  UserPurchase.belongsTo(Pricing, { foreignKey: 'PricingId' });
  User.hasMany(UserPurchase, { foreignKey: 'UserId' });
  UserPurchase.belongsTo(User, { foreignKey: 'UserId' });

  User.hasMany(TelegramPayment, { foreignKey: 'UserId' });
  TelegramPayment.belongsTo(User, { foreignKey: 'UserId' });
  Pricing.hasMany(TelegramPayment, { foreignKey: 'PricingId' });
  TelegramPayment.belongsTo(Pricing, { foreignKey: 'PricingId' });

  TelegramPayment.hasOne(UserPurchase, { foreignKey: 'TelegramPaymentId' });
  UserPurchase.belongsTo(TelegramPayment, { foreignKey: 'TelegramPaymentId' });

  User.hasMany(Referral, { foreignKey: 'ReferrerUserId' });
  Referral.belongsTo(User, { as: 'Referrer', foreignKey: 'ReferrerUserId' });
  User.hasMany(Referral, { foreignKey: 'ReferredUserId' });
  Referral.belongsTo(User, { as: 'Referred', foreignKey: 'ReferredUserId' });

  return {
    User,
    UserImageGeneration,
    Pricing,
    UserPurchase,
    TelegramPayment,
    Referral,
    Users: User,
    UserImageGenerations: UserImageGeneration,
    Pricings: Pricing,
    UserPurchases: UserPurchase,
    TelegramPayments: TelegramPayment,
    Referrals: Referral,
  };
}
