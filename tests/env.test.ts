import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/server/env";

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
