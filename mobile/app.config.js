const IS_DEV = process.env.APP_VARIANT === "development";

module.exports = ({ config }) => ({
  ...config,
  name: IS_DEV ? "CT Pickup Dev" : config.name,
  ios: {
    ...config.ios,
    bundleIdentifier: IS_DEV ? "com.ctpickup.mobile.dev" : config.ios.bundleIdentifier,
  },
});
