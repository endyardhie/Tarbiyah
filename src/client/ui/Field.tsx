import {
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
  useId,
} from "react";

/** Gaya input tanpa lebar — pakai ini bila memberi lebar tetap (w-24, w-auto, …). */
export const inputBase =
  "min-h-12 rounded-2xl border border-border bg-surface-raised px-4 text-text placeholder:text-text2/70 transition-colors focus:border-primary focus:outline-none disabled:opacity-60";
export const inputClass = `${inputBase} w-full`;

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold">
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-sm text-text2">{hint}</p>}
    </div>
  );
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${inputClass} ${className}`} {...props} />;
}

export function Textarea({
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${inputClass} py-3 ${className}`} rows={3} {...props} />;
}

export function Checkbox({
  label,
  description,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; description?: ReactNode }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl px-1 py-2 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
      <input
        type="checkbox"
        className="mt-0.5 size-5 shrink-0 accent-[var(--primary)]"
        {...props}
      />
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        {description && <span className="block text-sm text-text2">{description}</span>}
      </span>
    </label>
  );
}

export function ErrorAlert({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="rounded-2xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger"
    >
      {children}
    </p>
  );
}
