const IS_DEV = process.env.APP_VARIANT === "development";

module.exports = ({ config }) => ({
  ...config,
  name: IS_DEV ? "CT Dev" : config.name,
  ios: {
    ...config.ios,
    infoPlist: {
      ...config.ios?.infoPlist,
      CFBundleDisplayName: IS_DEV
        ? "CT Dev"
        : config.ios?.infoPlist?.CFBundleDisplayName,
    },
    bundleIdentifier: IS_DEV
      ? "com.ctpickup.mobile.dev"
      : config.ios.bundleIdentifier,
  },
});
