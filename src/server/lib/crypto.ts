import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** Naikkan bila APP_ENCRYPTION_KEY dirotasi; nilai lama tetap tercatat versinya. */
export const KEY_VERSION = 1;

export type Encrypted = { v: number; iv: string; tag: string; data: string };

export function encryptSecret(plain: string, keyBase64: string): Encrypted {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(keyBase64, "base64"), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return {
    v: KEY_VERSION,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
}

export function decryptSecret(e: Encrypted, keyBase64: string): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(keyBase64, "base64"),
    Buffer.from(e.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(e.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(e.data, "base64")), decipher.final()]).toString(
    "utf8",
  );
}
