"use client";

import Link from "next/link";
import { useTokenBalance } from "@/hooks/useTokenBalance";

type TokenBalanceBadgeProps = {
  className?: string;
  shellClassName?: string;
  labelClassName?: string;
  separatorClassName?: string;
  valueClassName?: string;
};

export function TokenBalanceBadge({
  className = "",
  shellClassName = "border-slate-700 bg-slate-900/80 text-slate-200",
  labelClassName = "text-slate-400",
  separatorClassName = "mx-1 text-slate-600",
  valueClassName = "font-medium text-slate-100",
}: TokenBalanceBadgeProps) {
  const { visible, balance, isLoading, error } = useTokenBalance();
  if (!visible) return null;

  const hasBalance = typeof balance === "number";
  const displayValue = hasBalance ? balance.toLocaleString() : "—";
  const title = error
    ? `Token balance unavailable: ${error}. Open billing.`
    : "Current token balance. Open billing.";

  return (
    <Link
      href="/billing"
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs ${shellClassName} ${className}`.trim()}
      title={title}
      aria-live="polite"
    >
      <span className={labelClassName}>Tokens</span>
      <span className={separatorClassName}>:</span>
      <span className={valueClassName}>{isLoading && !hasBalance ? "…" : displayValue}</span>
    </Link>
  );
}
