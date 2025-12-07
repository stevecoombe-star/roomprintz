// components/RealtorHeader.tsx
"use client";

import { useAgentProfile } from "@/lib/useAgentProfile";
import Link from "next/link";

export function RealtorHeader() {
  const { profile, loading } = useAgentProfile();

  // No user → no header (they're probably on landing page or not logged in)
  if (!profile && !loading) return null;

  return (
    <header className="mb-4 rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3 flex items-center gap-3">
      {loading ? (
        <>
          <div className="w-10 h-10 rounded-full bg-slate-800 animate-pulse" />
          <div className="flex-1 space-y-1">
            <div className="h-3 w-32 bg-slate-800 rounded animate-pulse" />
            <div className="h-3 w-48 bg-slate-900 rounded animate-pulse" />
            <div className="h-3 w-40 bg-slate-900 rounded animate-pulse" />
          </div>
        </>
      ) : (
        <>
          {/* Avatar */}
          <div className="w-24 h-24 rounded-full bg-slate-800 flex items-center justify-center overflow-hidden text-sm font-semibold text-slate-100 uppercase">
            {profile?.agent_photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.agent_photo_url}
                alt={profile.full_name ?? "Agent photo"}
                className="w-full h-full object-cover"
              />
            ) : (
              (profile?.full_name || profile?.email || "AG")[0]
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">
                  {profile?.full_name ?? profile?.email ?? "Your name"}
                </div>
                <div className="text-[11px] text-slate-400 truncate">
                  {profile?.brokerage_name ?? "Your brokerage"}{" "}
                  {profile?.brokerage_address
                    ? `• ${profile.brokerage_address}`
                    : ""}
                </div>
              </div>
              <div className="flex items-center gap-3 sm:text-right">
                <div className="text-[11px] text-slate-400 hidden sm:block">
                  {profile?.phone && (
                    <span className="block truncate">{profile.phone}</span>
                  )}
                  {profile?.email && (
                    <span className="block truncate">{profile.email}</span>
                  )}
                </div>
                <Link
                  href="/app/profile"
                  className="text-[11px] rounded-lg border border-slate-700 px-2 py-1 hover:border-emerald-400/70 hover:text-emerald-200 transition"
                >
                  Edit profile
                </Link>
              </div>
            </div>

            {/* On mobile, show contact under main text */}
            <div className="mt-1 text-[11px] text-slate-400 sm:hidden">
              {profile?.phone && (
                <span className="block truncate">{profile.phone}</span>
              )}
              {profile?.email && (
                <span className="block truncate">{profile.email}</span>
              )}
            </div>
          </div>
        </>
      )}
    </header>
  );
}
