import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { type ReactNode, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { Button } from "../ui/Button";
import { ErrorAlert } from "../ui/Field";
import { Modal } from "../ui/Modal";
import { EntityForm, type FieldDef } from "./EntityForm";

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <ul className="space-y-2" aria-busy="true" aria-label="Memuat">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="h-16 animate-pulse rounded-2xl bg-surface-muted" />
      ))}
    </ul>
  );
}

/**
 * Daftar data master + dialog tambah/ubah. `path` = endpoint API (mis. "/lokasi").
 * Hanya tampilan: server tetap memeriksa izin pada setiap perubahan.
 */
export function MasterList<T extends { id: string }>({
  title,
  description,
  path,
  queryKey,
  canEdit,
  fields,
  renderItem,
  newInitial,
  empty = "Belum ada data.",
  invalidate = [],
  itemAction,
}: {
  title: string;
  description?: ReactNode;
  path: string;
  queryKey: unknown[];
  canEdit: boolean;
  fields: FieldDef[];
  renderItem: (item: T) => ReactNode;
  newInitial?: Record<string, unknown>;
  empty?: string;
  invalidate?: unknown[][];
  itemAction?: (item: T) => ReactNode;
}) {
  const list = useQuery({
    queryKey,
    queryFn: () => api<T[]>(path + (queryKey[1] ? `?${queryKey[1]}` : "")),
  });
  const [editing, setEditing] = useState<T | "baru" | null>(null);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {description && <p className="text-sm text-text2">{description}</p>}
        </div>
        {canEdit && (
          <Button variant="secondary" onClick={() => setEditing("baru")}>
            <Plus size={18} /> Tambah
          </Button>
        )}
      </div>
      {list.isPending ? (
        <ListSkeleton />
      ) : list.isError ? (
        <ErrorAlert>{errorMessage(list.error)}</ErrorAlert>
      ) : list.data.length === 0 ? (
        <p className="rounded-2xl bg-surface-muted px-4 py-6 text-center text-text2">{empty}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {list.data.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3"
            >
              <div className="min-w-0 flex-1">{renderItem(item)}</div>
              {itemAction?.(item)}
              {canEdit && (
                <Button variant="ghost" className="shrink-0 px-4" onClick={() => setEditing(item)}>
                  Ubah
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={`${editing === "baru" ? "Tambah" : "Ubah"} ${title.toLowerCase()}`}
      >
        {editing !== null && (
          <EntityForm
            key={editing === "baru" ? "baru" : editing.id}
            fields={fields}
            endpoint={path}
            id={editing === "baru" ? undefined : editing.id}
            initial={editing === "baru" ? newInitial : (editing as Record<string, unknown>)}
            invalidate={[queryKey, ...invalidate]}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
    </section>
  );
}
