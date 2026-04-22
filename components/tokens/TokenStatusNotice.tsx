"use client";

import Link from "next/link";
import { useTokenBalance } from "@/hooks/useTokenBalance";

type TokenStatusNoticeProps = {
  lowThreshold?: number;
  className?: string;
  showGetMoreTokensCta?: boolean;
};

export function TokenStatusNotice({
  lowThreshold = 10,
  className = "",
  showGetMoreTokensCta = false,
}: TokenStatusNoticeProps) {
  const { visible, balance, isLoading } = useTokenBalance();
  if (!visible || isLoading || typeof balance !== "number") return null;
  if (balance >= lowThreshold) return null;

  if (balance <= 0) {
    return (
      <div
        className={`rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100 ${className}`.trim()}
        role="status"
        aria-live="polite"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">You&apos;re out of tokens</span>
          {showGetMoreTokensCta ? (
            <Link
              href="/billing"
              className="rounded-md border border-rose-300/40 px-2 py-1 text-[11px] text-rose-100 transition hover:bg-rose-500/20"
            >
              Get more tokens
            </Link>
          ) : null}
        </div>
        <div className="mt-1 text-[11px] text-rose-200/90">
          Top up securely with Stripe and continue where you left off.
        </div>
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100 ${className}`.trim()}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>Low on tokens - you have {balance.toLocaleString()} remaining</span>
        {showGetMoreTokensCta ? (
          <Link
            href="/billing"
            className="rounded-md border border-amber-300/40 px-2 py-1 text-[11px] text-amber-100 transition hover:bg-amber-500/20"
          >
            Top up
          </Link>
        ) : null}
      </div>
    </div>
  );
}
