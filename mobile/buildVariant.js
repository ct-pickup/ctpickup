/**
 * Build variants for app.config.js. Plain CommonJS so the config and the unit test can both load it.
 *
 *   (unset)         the real app: com.ctpickup.mobile, "CT". Untouched.
 *   development     dev-client builds: com.ctpickup.mobile.dev, "CT Dev".
 *   testflight-dev  a store-distributed build for TestFlight that talks to the DEV backend only. Same bundle id as the
 *                   real app (so it uploads to the existing App Store Connect record), display name "CT Dev".
 */

const DEV_SUPABASE_REF = "plratvhywezrtedwipsm";

/** Decode the `ref` claim of a Supabase anon key (a JWT). Returns null if it is not readable. Never logs the key. */
function supabaseRefFromKey(key) {
  try {
    const part = String(key || "").split(".")[1];
    if (!part) return null;
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const ref = JSON.parse(json).ref;
    return typeof ref === "string" ? ref : null;
  } catch {
    return null;
  }
}

/**
 * Fails the build (throws) unless this is provably the DEV backend. Messages never include a key or a URL.
 * Returns a list of problems; empty means safe.
 */
function devBackendProblems(env) {
  const problems = [];
  const url = String(env.EXPO_PUBLIC_SUPABASE_URL || "").trim();
  const key = String(env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  const site = String(env.EXPO_PUBLIC_SITE_URL || "").trim();
  let host = "";
  try {
    host = url ? new URL(url).host : "";
  } catch {
    host = "";
  }
  if (!host) problems.push("EXPO_PUBLIC_SUPABASE_URL is missing or not a URL");
  else if (host !== `${DEV_SUPABASE_REF}.supabase.co`) problems.push("EXPO_PUBLIC_SUPABASE_URL is not the dev Supabase project");
  if (!key) problems.push("EXPO_PUBLIC_SUPABASE_ANON_KEY is missing");
  else {
    const ref = supabaseRefFromKey(key);
    if (ref !== DEV_SUPABASE_REF) problems.push("EXPO_PUBLIC_SUPABASE_ANON_KEY is not an anon key of the dev Supabase project");
  }
  if (!site) problems.push("EXPO_PUBLIC_SITE_URL is missing (use the Vercel preview URL)");
  else if (!/^https:\/\//i.test(site)) problems.push("EXPO_PUBLIC_SITE_URL must be an https URL (iOS blocks plain http)");
  else if (/^https:\/\/(www\.)?ctpickup\.net(\/|$)/i.test(site)) problems.push("EXPO_PUBLIC_SITE_URL points at the production site");
  if (String(env.EXPO_PUBLIC_CTPLUS_ENABLED || "").toLowerCase() === "true") problems.push("EXPO_PUBLIC_CTPLUS_ENABLED must stay off");
  return problems;
}

function applyVariant(config, env) {
  const variant = env.APP_VARIANT;
  if (variant === "testflight-dev") {
    const problems = devBackendProblems(env);
    if (problems.length) {
      throw new Error("testflight-dev build refused:\n - " + problems.join("\n - "));
    }
  }
  const named = variant === "development" || variant === "testflight-dev";
  return {
    ...config,
    name: named ? "CT Dev" : config.name,
    ios: {
      ...config.ios,
      infoPlist: {
        ...config.ios?.infoPlist,
        CFBundleDisplayName: named ? "CT Dev" : config.ios?.infoPlist?.CFBundleDisplayName,
      },
      bundleIdentifier: variant === "development" ? "com.ctpickup.mobile.dev" : config.ios.bundleIdentifier,
    },
  };
}

module.exports = { DEV_SUPABASE_REF, supabaseRefFromKey, devBackendProblems, applyVariant };
