import { randomInt } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

/** Argon2id (bawaan @node-rs/argon2). */
export const hashPassword = (password: string) => hash(password);

export async function verifyPassword(passwordHash: string, password: string) {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;
/** Dipakai saat nomor tidak ditemukan agar waktu respons sama dengan password salah. */
export async function burnPasswordCheck(password: string) {
  dummyHash ??= hashPassword("dummy-password-tarbiyah");
  await verifyPassword(await dummyHash, password);
}

// Tanpa huruf/angka yang mudah tertukar (0/O, 1/l/I).
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export function tempPassword(length = 10) {
  return Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}
