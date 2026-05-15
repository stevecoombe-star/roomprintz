import type { ReactNode } from "react";
import { SignOutButton } from "@/components/auth/SignOutButton";

type MyFurnitureHeaderProps = {
  onReturnToCanvas: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onAddItem: () => void;
  tokenBadge?: ReactNode;
};

export function MyFurnitureHeader({
  onReturnToCanvas,
  onRefresh,
  isRefreshing,
  onAddItem,
  tokenBadge,
}: MyFurnitureHeaderProps) {
  return (
    <header className="rounded-2xl border border-slate-800/80 bg-slate-900/55 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <button
            type="button"
            onClick={onReturnToCanvas}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white"
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
              className="h-3.5 w-3.5"
            >
              <path
                d="M11.75 4.5L6.25 10L11.75 15.5M6.5 10H16"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Return to Canvas
          </button>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">My Furniture</h1>
          <p className="mt-1 text-xs text-slate-400">Your saved items, ready to reuse instantly.</p>
        </div>
        <div className="flex items-center gap-2">
          {tokenBadge}
          <button
            type="button"
            onClick={onAddItem}
            className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-900 transition hover:bg-white"
          >
            Add item
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white disabled:opacity-50"
          >
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
          <SignOutButton className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white disabled:opacity-50" />
        </div>
      </div>
    </header>
  );
}
