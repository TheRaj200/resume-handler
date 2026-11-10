import type { ButtonHTMLAttributes, ReactNode } from "react";

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
      className={`relative rounded-xl border border-white/[0.07] bg-gradient-to-b from-white/[0.05] to-white/[0.02] shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset] ${
        interactive ? "transition hover:border-white/[0.13] hover:from-white/[0.06]" : ""
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
    primary:
      "bg-brand-500 text-white shadow-sm shadow-brand-500/25 hover:bg-brand-400 active:bg-brand-600",
    secondary:
      "bg-white/[0.07] text-slate-100 border border-white/10 hover:bg-white/[0.10] hover:border-white/[0.16] active:bg-white/[0.14]",
    ghost: "bg-transparent text-slate-300 hover:bg-white/[0.06] hover:text-slate-100",
    danger: "bg-rose-500/90 text-white hover:bg-rose-500 active:bg-rose-600",
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
    indigo: "bg-brand-500/15 text-brand-300 border-brand-500/25",
    emerald: "bg-emerald-500/15 text-emerald-300 border-emerald-400/25",
    amber: "bg-amber-500/15 text-amber-300 border-amber-400/25",
    rose: "bg-rose-500/15 text-rose-300 border-rose-400/25",
    slate: "bg-white/[0.06] text-slate-300 border-white/10",
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
  "w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 transition focus:border-brand-500/50 focus:ring-2 focus:ring-brand-500/20";

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
    <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-8 text-center">
      <p className="text-sm font-medium text-slate-200">{title}</p>
      <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-slate-500">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
