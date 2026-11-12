import { createContext, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

type ConfirmRequest = { title: string; message: string; resolve: (value: boolean) => void };
const ConfirmContext = createContext<(title: string, message: string) => Promise<boolean>>(() => Promise.resolve(false));

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const confirm = useCallback((title: string, message: string) => new Promise<boolean>((resolve) => setRequest({ title, message, resolve })), []);
  const close = (value: boolean) => {
    request?.resolve(value);
    setRequest(null);
  };
  useEffect(() => {
    if (!request) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request]);
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request ? (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/70 p-4 backdrop-blur-sm" onMouseDown={() => close(false)}>
          <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#171a29] p-5 shadow-2xl shadow-black/50" onMouseDown={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-start gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-rose-500/15 text-rose-300">!</div>
              <div>
                <h2 className="text-sm font-semibold text-slate-100">{request.title}</h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">{request.message}</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => close(false)} className="rounded-xl border border-white/10 px-3.5 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/[0.07]">Cancel</button>
              <button type="button" onClick={() => close(true)} className="rounded-xl bg-rose-500 px-3.5 py-2 text-xs font-semibold text-white shadow-lg shadow-rose-500/20 transition hover:bg-rose-400 active:scale-[0.98]">Delete</button>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmContext);
}

export function Card({
  children,
  className = "",
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <div
      className={`relative rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-4 shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset] ${
        interactive ? "transition hover:border-white/[0.16] hover:from-white/[0.08]" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

export function Button({
  children,
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  const variants: Record<ButtonVariant, string> = {
    primary: "bg-brand-500 text-white shadow-lg shadow-brand-500/25 hover:bg-brand-400 active:bg-brand-600",
    secondary:
      "bg-white/[0.07] text-slate-100 border border-white/10 hover:bg-white/[0.12] hover:border-white/[0.2] active:bg-white/[0.16]",
    ghost: "bg-transparent text-slate-400 hover:bg-white/[0.07] hover:text-slate-100",
    danger: "bg-rose-500 text-white hover:bg-rose-400 active:bg-rose-600",
  };
  const sizes: Record<ButtonSize, string> = {
    sm: "px-2.5 py-1.5 text-xs rounded-lg",
    md: "px-3.5 py-2 text-sm rounded-xl",
  };

  return (
    <button
      className={`inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.985] ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export type BadgeTone = "indigo" | "emerald" | "amber" | "rose" | "slate";

export function Badge({
  children,
  tone = "slate",
}: {
  children: ReactNode;
  tone?: BadgeTone;
}) {
  const tones: Record<BadgeTone, string> = {
    indigo: "bg-brand-500/15 text-brand-300 border-brand-500/30",
    emerald: "bg-emerald-500/15 text-emerald-300 border-emerald-400/30",
    amber: "bg-amber-500/15 text-amber-300 border-amber-400/30",
    rose: "bg-rose-500/15 text-rose-300 border-rose-400/30",
    slate: "bg-white/[0.08] text-slate-300 border-white/10",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-wide ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-300">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-slate-500">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  "w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 shadow-inner outline-none placeholder:text-slate-500 transition focus:border-brand-500/60 focus:ring-2 focus:ring-brand-500/25";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-8 text-center">
      <p className="text-sm font-medium text-slate-200">{title}</p>
      <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-slate-400">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Notice({
  title,
  children,
  tone = "warning",
}: {
  title: string;
  children: ReactNode;
  tone?: "warning" | "error" | "info";
}) {
  const styles = {
    warning: ["border-amber-400/20 bg-amber-400/[0.07]", "bg-amber-400/15 text-amber-300", "text-amber-200", "text-amber-100/60", "!"],
    error: ["border-rose-400/20 bg-rose-400/[0.07]", "bg-rose-400/15 text-rose-300", "text-rose-200", "text-rose-100/65", "×"],
    info: ["border-brand-400/20 bg-brand-400/[0.07]", "bg-brand-400/15 text-brand-200", "text-brand-200", "text-brand-100/60", "i"],
  }[tone];

  return (
    <div className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 ${styles[0]}`}>
      <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${styles[1]}`}>{styles[4]}</span>
      <div className="min-w-0 space-y-0.5">
        <p className={`text-[11px] font-semibold leading-4 ${styles[2]}`}>{title}</p>
        <div className={`text-[11px] leading-relaxed ${styles[3]}`}>{children}</div>
      </div>
    </div>
  );
}
