import type { Db, Tx } from "../db/client";
import { auditLog } from "../db/schema";

export type AuditEntry = {
  userId: string | null;
  aksi: string;
  entitas: string;
  entitasId?: string | null;
  sebelum?: unknown;
  sesudah?: unknown;
  ip?: string | null;
};

export async function audit(db: Db | Tx, e: AuditEntry) {
  await db.insert(auditLog).values({
    userId: e.userId,
    aksi: e.aksi,
    entitas: e.entitas,
    entitasId: e.entitasId ?? null,
    sebelum: e.sebelum ?? null,
    sesudah: e.sesudah ?? null,
    ip: e.ip ?? null,
  });
}
