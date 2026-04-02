import defineUser from './User.js';
import defineUserImageGeneration from './UserImageGeneration.js';
import defineGenerationAudit from './GenerationAudit.js';
import definePricing from './Pricing.js';
import defineUserPurchase from './UserPurchase.js';
import defineTelegramPayment from './TelegramPayment.js';
import defineReferral from './Referral.js';
import defineReferralEarning from './ReferralEarning.js';
import definePayoutRequest from './PayoutRequest.js';
import definePromoCode from './PromoCode.js';
import definePreset from './Preset.js';
import definePhotosetConfig from './PhotosetConfig.js';
import definePhotoset from './Photoset.js';
import defineUserPhotoset from './UserPhotoset.js';
import defineConfig from './Config.js';
import defineAudience from './Audience.js';
import defineTheme from './Theme.js';
import definePresetAudience from './PresetAudience.js';
import definePresetTheme from './PresetTheme.js';
import definePhotosetConfigAudience from './PhotosetConfigAudience.js';
import definePhotosetConfigTheme from './PhotosetConfigTheme.js';
import defineRequiredChannel from './RequiredChannel.js';
import defineRequiredChannelUser from './RequiredChannelUser.js';

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
  const ReferralEarning = defineReferralEarning(sequelize);
  const PayoutRequest = definePayoutRequest(sequelize);
  const PromoCode = definePromoCode(sequelize);
  const Preset = definePreset(sequelize);
  const PhotosetConfig = definePhotosetConfig(sequelize);
  const Photoset = definePhotoset(sequelize);
  const UserPhotoset = defineUserPhotoset(sequelize);
  const Audience = defineAudience(sequelize);
  const Theme = defineTheme(sequelize);
  const PresetAudience = definePresetAudience(sequelize);
  const PresetTheme = definePresetTheme(sequelize);
  const PhotosetConfigAudience = definePhotosetConfigAudience(sequelize);
  const PhotosetConfigTheme = definePhotosetConfigTheme(sequelize);
  const RequiredChannel = defineRequiredChannel(sequelize);
  const RequiredChannelUser = defineRequiredChannelUser(sequelize);

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

  User.hasMany(ReferralEarning, { foreignKey: 'BeneficiaryUserId' });
  ReferralEarning.belongsTo(User, { as: 'Beneficiary', foreignKey: 'BeneficiaryUserId' });
  User.hasMany(ReferralEarning, { foreignKey: 'SourceUserId' });
  ReferralEarning.belongsTo(User, { as: 'SourceUser', foreignKey: 'SourceUserId' });
  TelegramPayment.hasMany(ReferralEarning, { foreignKey: 'TelegramPaymentId' });
  ReferralEarning.belongsTo(TelegramPayment, { foreignKey: 'TelegramPaymentId' });
  Pricing.hasMany(ReferralEarning, { foreignKey: 'PricingId' });
  ReferralEarning.belongsTo(Pricing, { foreignKey: 'PricingId' });

  User.hasMany(PayoutRequest, { foreignKey: 'UserId' });
  PayoutRequest.belongsTo(User, { foreignKey: 'UserId' });

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

  Preset.belongsToMany(Audience, {
    through: PresetAudience,
    foreignKey: 'PresetId',
    otherKey: 'AudienceId',
  });
  Audience.belongsToMany(Preset, {
    through: PresetAudience,
    foreignKey: 'AudienceId',
    otherKey: 'PresetId',
  });
  Preset.belongsToMany(Theme, {
    through: PresetTheme,
    foreignKey: 'PresetId',
    otherKey: 'ThemeId',
  });
  Theme.belongsToMany(Preset, {
    through: PresetTheme,
    foreignKey: 'ThemeId',
    otherKey: 'PresetId',
  });
  Theme.belongsTo(Theme, { as: 'Parent', foreignKey: 'ParentId' });

  PhotosetConfig.belongsToMany(Audience, {
    through: PhotosetConfigAudience,
    foreignKey: 'PhotosetConfigId',
    otherKey: 'AudienceId',
  });
  Audience.belongsToMany(PhotosetConfig, {
    through: PhotosetConfigAudience,
    foreignKey: 'AudienceId',
    otherKey: 'PhotosetConfigId',
  });
  PhotosetConfig.belongsToMany(Theme, {
    through: PhotosetConfigTheme,
    foreignKey: 'PhotosetConfigId',
    otherKey: 'ThemeId',
  });
  Theme.belongsToMany(PhotosetConfig, {
    through: PhotosetConfigTheme,
    foreignKey: 'ThemeId',
    otherKey: 'PhotosetConfigId',
  });

  return {
    User,
    UserImageGeneration,
    GenerationAudit,
    Pricing,
    UserPurchase,
    TelegramPayment,
    Referral,
    ReferralEarning,
    PayoutRequest,
    Preset,
    PhotosetConfig,
    Photoset,
    UserPhotoset,
    RequiredChannel,
    RequiredChannelUser,
    Users: User,
    UserImageGenerations: UserImageGeneration,
    GenerationAudits: GenerationAudit,
    Pricings: Pricing,
    UserPurchases: UserPurchase,
    TelegramPayments: TelegramPayment,
    Referrals: Referral,
    ReferralEarnings: ReferralEarning,
    PayoutRequests: PayoutRequest,
    PromoCodes: PromoCode,
    Presets: Preset,
    PhotosetConfigs: PhotosetConfig,
    Photosets: Photoset,
    UserPhotosets: UserPhotoset,
    RequiredChannels: RequiredChannel,
    RequiredChannelUsers: RequiredChannelUser,
    Audience,
    Theme,
    Audiences: Audience,
    Themes: Theme,
    Config,
    Configs: Config,
  };
}
