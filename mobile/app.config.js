const base = require("./app.json");

const IS_DEV = process.env.APP_VARIANT === "development";

module.exports = {
  ...base,
  expo: {
    ...base.expo,
    name: IS_DEV ? "CT Dev" : base.expo.name,
    ios: {
      ...base.expo.ios,
      infoPlist: {
        ...base.expo.ios.infoPlist,
        CFBundleDisplayName: IS_DEV ? "CT Dev" : base.expo.ios.infoPlist.CFBundleDisplayName,
      },
      bundleIdentifier: IS_DEV
        ? "com.ctpickup.mobile.dev"
        : base.expo.ios.bundleIdentifier,
    },
  },
};
