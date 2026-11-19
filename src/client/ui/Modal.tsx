import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

/** Dialog: lembar bawah di HP, kartu tengah di layar lebar. */
export function Modal({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-3 bottom-[calc(12px+env(safe-area-inset-bottom))] z-50 max-h-[88dvh] overflow-y-auto rounded-[28px] border border-border bg-surface-raised p-5 shadow-soft md:inset-x-auto md:top-1/2 md:bottom-auto md:left-1/2 md:w-[min(560px,calc(100vw-48px))] md:-translate-x-1/2 md:-translate-y-1/2 md:p-6"
        >
          <div className="mb-4 flex items-center justify-between gap-4">
            <Dialog.Title className="text-lg font-bold">{title}</Dialog.Title>
            <Dialog.Close
              aria-label="Tutup"
              className="grid size-11 shrink-0 place-items-center rounded-full hover:bg-surface-muted"
            >
              <X size={22} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
