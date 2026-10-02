const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

// shared/theme lives at the repo root. Do not resolve it through mobile/lib sync.
config.watchFolders = [workspaceRoot];

module.exports = config;
