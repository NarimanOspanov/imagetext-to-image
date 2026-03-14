import defineUser from './User.js';
import defineUserImageGeneration from './UserImageGeneration.js';
import defineGenerationAudit from './GenerationAudit.js';
import definePricing from './Pricing.js';
import defineUserPurchase from './UserPurchase.js';
import defineTelegramPayment from './TelegramPayment.js';
import defineReferral from './Referral.js';
import definePromoCode from './PromoCode.js';
import definePreset from './Preset.js';
import definePhotosetConfig from './PhotosetConfig.js';
import definePhotoset from './Photoset.js';
import defineUserPhotoset from './UserPhotoset.js';
import defineConfig from './Config.js';

/**
 * Initialize code-first models and associations. Call with the shared Sequelize instance.
 */
export function initModels(sequelize) {
  const User = defineUser(sequelize);
  const Config = defineConfig(sequelize);
  const UserImageGeneration = defineUserImageGeneration(sequelize);
  const GenerationAudit = defineGenerationAudit(sequelize);
  const Pricing = definePricing(sequelize);
  const UserPurchase = defineUserPurchase(sequelize);
  const TelegramPayment = defineTelegramPayment(sequelize);
  const Referral = defineReferral(sequelize);
  const PromoCode = definePromoCode(sequelize);
  const Preset = definePreset(sequelize);
  const PhotosetConfig = definePhotosetConfig(sequelize);
  const Photoset = definePhotoset(sequelize);
  const UserPhotoset = defineUserPhotoset(sequelize);

  User.hasMany(UserImageGeneration, { foreignKey: 'UserId' });
  UserImageGeneration.belongsTo(User, { foreignKey: 'UserId' });

  User.hasMany(GenerationAudit, { foreignKey: 'UserId' });
  GenerationAudit.belongsTo(User, { foreignKey: 'UserId' });

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

  User.hasMany(PromoCode, { foreignKey: 'OwnerUserId' });
  PromoCode.belongsTo(User, { as: 'Owner', foreignKey: 'OwnerUserId' });

  PhotosetConfig.hasMany(Photoset, { foreignKey: 'PhotosetConfigId' });
  Photoset.belongsTo(PhotosetConfig, { foreignKey: 'PhotosetConfigId' });
  Preset.hasMany(Photoset, { foreignKey: 'PresetId' });
  Photoset.belongsTo(Preset, { foreignKey: 'PresetId' });

  User.hasMany(UserPhotoset, { foreignKey: 'UserId' });
  UserPhotoset.belongsTo(User, { foreignKey: 'UserId' });
  Photoset.hasMany(UserPhotoset, { foreignKey: 'PhotosetId' });
  UserPhotoset.belongsTo(Photoset, { foreignKey: 'PhotosetId' });

  UserPhotoset.hasMany(GenerationAudit, { foreignKey: 'UserPhotosetId' });
  GenerationAudit.belongsTo(UserPhotoset, { foreignKey: 'UserPhotosetId' });

  return {
    User,
    UserImageGeneration,
    GenerationAudit,
    Pricing,
    UserPurchase,
    TelegramPayment,
    Referral,
    Preset,
    PhotosetConfig,
    Photoset,
    UserPhotoset,
    Users: User,
    UserImageGenerations: UserImageGeneration,
    GenerationAudits: GenerationAudit,
    Pricings: Pricing,
    UserPurchases: UserPurchase,
    TelegramPayments: TelegramPayment,
    Referrals: Referral,
    PromoCodes: PromoCode,
    Presets: Preset,
    PhotosetConfigs: PhotosetConfig,
    Photosets: Photoset,
    UserPhotosets: UserPhotoset,
    Config,
    Configs: Config,
  };
}
