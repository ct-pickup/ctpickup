import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
type Cfg = { name: string; ios: { bundleIdentifier: string; infoPlist: { CFBundleDisplayName: string } } };
const { applyVariant, devBackendProblems, supabaseRefFromKey } = require("../mobile/buildVariant.js") as {
  applyVariant: (config: Cfg, env: Record<string, string | undefined>) => Cfg;
  devBackendProblems: (env: Record<string, string | undefined>) => string[];
  supabaseRefFromKey: (k: string) => string | null;
};

const jwt = (ref: string) => `x.${Buffer.from(JSON.stringify({ ref, role: "anon" })).toString("base64url")}.y`;
const DEV = "plratvhywezrtedwipsm";
const goodEnv = {
  APP_VARIANT: "testflight-dev",
  EXPO_PUBLIC_SUPABASE_URL: `https://${DEV}.supabase.co`,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: jwt(DEV),
  EXPO_PUBLIC_SITE_URL: "https://ctpickup-git-claude-fields-step1.vercel.app",
};
const base = JSON.parse(readFileSync("mobile/app.json", "utf8")).expo as Cfg;

describe("testflight-dev build variant", () => {
  it("reads the project ref from an anon key without needing the key to be valid elsewhere", () => {
    expect(supabaseRefFromKey(jwt(DEV))).toBe(DEV);
    expect(supabaseRefFromKey("garbage")).toBeNull();
  });
  it("accepts the dev backend", () => {
    expect(devBackendProblems(goodEnv)).toEqual([]);
  });
  it("refuses a production Supabase URL, a production anon key, a production site, http, and missing values", () => {
    expect(devBackendProblems({ ...goodEnv, EXPO_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co" }).length).toBe(1);
    expect(devBackendProblems({ ...goodEnv, EXPO_PUBLIC_SUPABASE_ANON_KEY: jwt("abcdefghijklmnop") }).length).toBe(1);
    expect(devBackendProblems({ ...goodEnv, EXPO_PUBLIC_SITE_URL: "https://www.ctpickup.net" }).length).toBe(1);
    expect(devBackendProblems({ ...goodEnv, EXPO_PUBLIC_SITE_URL: "http://192.168.1.5:3000" }).length).toBe(1);
    expect(devBackendProblems({}).length).toBe(3);
    expect(devBackendProblems({ ...goodEnv, EXPO_PUBLIC_CTPLUS_ENABLED: "true" }).length).toBe(1);
  });
  it("throws without echoing any key", () => {
    const secretish = jwt("abcdefghijklmnop");
    try {
      applyVariant(base, { ...goodEnv, EXPO_PUBLIC_SUPABASE_ANON_KEY: secretish });
      throw new Error("should have thrown");
    } catch (e) {
      expect(String((e as Error).message)).toContain("refused");
      expect(String((e as Error).message)).not.toContain(secretish);
    }
  });
  it("renames the app 'CT Dev' but keeps the bundle id", () => {
    const c = applyVariant(base, goodEnv);
    expect(c.name).toBe("CT Dev");
    expect(c.ios.infoPlist.CFBundleDisplayName).toBe("CT Dev");
    expect(c.ios.bundleIdentifier).toBe("com.ctpickup.mobile");
  });
  it("leaves the real app and the dev-client variant as they were", () => {
    const real = applyVariant(base, {});
    expect(real.name).toBe(base.name);
    expect(real.ios.bundleIdentifier).toBe("com.ctpickup.mobile");
    expect(real.ios.infoPlist.CFBundleDisplayName).toBe("CT");
    expect(applyVariant(base, { APP_VARIANT: "development" }).ios.bundleIdentifier).toBe("com.ctpickup.mobile.dev");
  });
});

describe("mobile/eas.json", () => {
  const eas = JSON.parse(readFileSync("mobile/eas.json", "utf8"));
  it("testflight-dev is a store build with auto-increment, dev variant and a dev Sentry environment", () => {
    const p = eas.build["testflight-dev"];
    expect(p.distribution).toBe("store");
    expect(p.autoIncrement).toBe(true);
    expect(p.env.APP_VARIANT).toBe("testflight-dev");
    expect(p.env.EXPO_PUBLIC_APP_ENV).toBe("dev-testflight");
  });
  it("keeps secrets and feature flags out of the file, and the production profile unchanged", () => {
    const text = JSON.stringify(eas);
    expect(text).not.toMatch(/supabase\.co|eyJ|sk_|pk_|whsec|https:\/\//);
    expect(eas.build.production).toEqual({
      distribution: "store",
      environment: "production",
      autoIncrement: true,
      ios: { resourceClass: "m-medium" },
      android: { buildType: "app-bundle" },
    });
  });
});
