import { describe, expect, it } from "vitest";
import { configWarnings, parseEnv } from "../src/server/env";

const valid = {
  APP_URL: "https://app.contoh.sch.id",
  DATABASE_URL: "postgres://u:p@db:5432/tarbiyah",
  APP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  TURNSTILE_SITE_KEY: "site",
  TURNSTILE_SECRET_KEY: "secret",
};

describe("parseEnv", () => {
  it("mengisi default", () => {
    const env = parseEnv(valid);
    expect(env).toMatchObject({
      PORT: 3000,
      DATA_DIR: "/data",
      TZ: "Asia/Jayapura",
      TRUST_CLOUDFLARE: false,
    });
  });

  it("gagal dengan pesan yang menyebut variabel yang kurang", () => {
    expect(() =>
      parseEnv({ ...valid, DATABASE_URL: undefined, APP_ENCRYPTION_KEY: "pendek" }),
    ).toThrow(/DATABASE_URL[\s\S]*APP_ENCRYPTION_KEY: harus 32 byte/);
  });

  it("TRUST_CLOUDFLARE=true dibaca sebagai boolean", () => {
    expect(parseEnv({ ...valid, TRUST_CLOUDFLARE: "true" }).TRUST_CLOUDFLARE).toBe(true);
  });
});

describe("konfigurasi server", () => {
  const testKeys = {
    TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  };

  it("production menolak kunci uji Turnstile", () => {
    expect(() => parseEnv({ ...valid, ...testKeys, NODE_ENV: "production" })).toThrow(
      /kunci uji Turnstile/,
    );
    expect(parseEnv({ ...valid, ...testKeys, NODE_ENV: "development" }).NODE_ENV).toBe(
      "development",
    );
  });

  it("staging memberi peringatan TRUST_CLOUDFLARE & kunci uji", () => {
    const w = configWarnings(parseEnv({ ...valid, ...testKeys, NODE_ENV: "staging" }));
    expect(w.join(" ")).toMatch(/TRUST_CLOUDFLARE=false/);
    expect(w.join(" ")).toMatch(/Kunci uji Turnstile/);
    expect(
      configWarnings(parseEnv({ ...valid, NODE_ENV: "production", TRUST_CLOUDFLARE: "true" })),
    ).toEqual([]);
    expect(configWarnings(parseEnv(valid))).toEqual([]);
  });
});
