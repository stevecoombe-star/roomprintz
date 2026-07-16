import type { ReactNode } from "react";

// Phase 0P-C: tiny presentational collapsible card for the 3D Room Lab.
// No localStorage, no scene-state interaction, no business logic.

type CollapsibleSectionProps = {
  title: string;
  open: boolean;
  onToggle: () => void;
  description?: string;
  meta?: ReactNode;
  contentClassName?: string;
  children: ReactNode;
};

export default function CollapsibleSection({
  title,
  open,
  onToggle,
  description,
  meta,
  contentClassName = "px-4 pb-4",
  children,
}: CollapsibleSectionProps) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 p-4 text-left transition hover:bg-slate-900"
      >
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="text-xs text-slate-500" aria-hidden="true">
              {open ? "▾" : "▸"}
            </span>
            <span className="text-sm font-medium text-slate-100">{title}</span>
          </span>
          {description ? (
            <span className="mt-1 block text-xs text-slate-400">{description}</span>
          ) : null}
        </span>
        {meta ? <span className="shrink-0 text-xs text-slate-400">{meta}</span> : null}
      </button>
      {open ? <div className={contentClassName}>{children}</div> : null}
    </section>
  );
}
