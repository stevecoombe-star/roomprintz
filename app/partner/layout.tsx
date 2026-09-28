import Link from "next/link";
import type { ReactNode } from "react";

import { SignOutButton } from "@/components/auth/SignOutButton";
import { resolvePartnerPortalContext } from "@/lib/vibode-stage/partner-portal-auth.server";
import type { PartnerPortalAuthResult } from "@/lib/vibode-stage/partner-portal-auth";
import { PartnerPortalNav } from "./PartnerPortalNav";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function deniedCopy(result: Extract<PartnerPortalAuthResult, { ok: false }>): string {
  if (result.status === 401) return "Sign in to continue.";
  if (result.status === 409) return result.error;
  if (result.status === 500) return result.error;
  return "This account is not authorized for the Partner Portal.";
}

function PartnerDenied({ result }: { result: Extract<PartnerPortalAuthResult, { ok: false }> }) {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 px-6 py-10">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-xl font-semibold">Partner Portal</h1>
        <p className="mt-3 text-sm text-slate-300">{deniedCopy(result)}</p>
        <p className="mt-1 text-xs text-slate-500">
          Ask your Vibode contact if this store should be available on your account.
        </p>
        <div className="mt-6">
          <SignOutButton className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-300" />
        </div>
      </div>
    </main>
  );
}

export default async function PartnerLayout({
  children,
}: {
  children: ReactNode;
}) {
  const auth = await resolvePartnerPortalContext();
  if (!auth.ok) return <PartnerDenied result={auth} />;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <header className="border-b border-slate-800 px-6 py-4">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/partner" className="min-w-0 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-300">
            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Vibode</p>
            <p className="truncate text-lg font-semibold tracking-tight">{auth.context.partner.name}</p>
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <PartnerPortalNav />
            <SignOutButton className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300" />
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
    </div>
  );
}
