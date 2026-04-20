"use client";

import { useTokenBalance } from "@/hooks/useTokenBalance";

type TokenBalanceBadgeProps = {
  className?: string;
};

export function TokenBalanceBadge({ className = "" }: TokenBalanceBadgeProps) {
  const { visible, balance, isLoading, error } = useTokenBalance();
  if (!visible) return null;

  const hasBalance = typeof balance === "number";
  const displayValue = hasBalance ? balance.toLocaleString() : "—";
  const title = error ? `Token balance unavailable: ${error}` : "Current token balance";

  return (
    <div
      className={`inline-flex items-center rounded-full border border-slate-700 bg-slate-900/80 px-2.5 py-1 text-xs text-slate-200 ${className}`.trim()}
      title={title}
      aria-live="polite"
    >
      <span className="text-slate-400">Tokens</span>
      <span className="mx-1 text-slate-600">:</span>
      <span className="font-medium text-slate-100">{isLoading && !hasBalance ? "…" : displayValue}</span>
    </div>
  );
}
