/* eslint-disable @typescript-eslint/no-require-imports */
const { applyVariant } = require("./buildVariant");

module.exports = ({ config }) => applyVariant(config, process.env);
