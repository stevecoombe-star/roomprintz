import Link from "next/link";
import type { ReactNode } from "react";

import { SignOutButton } from "@/components/auth/SignOutButton";
import { resolvePartnerPortalContext } from "@/lib/vibode-stage/partner-portal-auth.server";
import type { PartnerPortalAuthResult } from "@/lib/vibode-stage/partner-portal-auth";

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
          Portal access requires an active STAGE Partner membership. Admin access is a separate authority.
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
        <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Partner Portal</p>
            <h1 className="text-lg font-semibold">{auth.context.partner.name}</h1>
            <p className="text-xs text-slate-400">
              {auth.context.partner.partnerId}
              {" · "}
              commercial status {auth.context.partner.status}
              {" · "}
              membership {auth.context.role}
            </p>
          </div>
          <nav className="flex items-center gap-3 text-sm">
            <Link className="text-slate-300 hover:text-white" href="/partner">Overview</Link>
            <Link className="text-slate-300 hover:text-white" href="/partner/catalog">Catalog</Link>
            <SignOutButton className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-300" />
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-6 py-6">{children}</div>
    </div>
  );
}
