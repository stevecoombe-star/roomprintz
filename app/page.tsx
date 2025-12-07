// app/page.tsx
"use client";

import Link from "next/link";
import { AuthPanel } from "@/components/AuthPanel";

export default function LandingPage() {
  const scrollToAuth = () => {
    const el = document.getElementById("auth-panel");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 flex flex-col">
      <div className="flex-1 flex items-center">
        <div className="max-w-5xl mx-auto px-4 py-10 grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
          {/* Left: marketing copy */}
          <section className="space-y-6">
            <div className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/5 px-3 py-1 text-[11px] text-emerald-200 font-medium">
              RoomPrintz • Agent-Only Beta
            </div>

            <div className="space-y-3">
              <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
                AI-powered virtual staging
                <span className="block text-emerald-300">
                  designed for real estate agents.
                </span>
              </h1>
              <p className="text-sm md:text-base text-slate-300 max-w-xl">
                Transform empty or dated listing photos into magazine-ready
                interiors in seconds. RoomPrintz helps you win more listings,
                impress sellers, and stand out in a crowded market — without
                the cost of physical staging.
              </p>
            </div>

            <ul className="space-y-2 text-sm text-slate-300">
              <li>• Upload listing photos and apply premium design styles.</li>
              <li>• Organize staged rooms by property and share with clients.</li>
              <li>• Built for agents, teams, and brokerages — not hobbyists.</li>
            </ul>

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                type="button"
                onClick={scrollToAuth}
                className="inline-flex items-center justify-center rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-medium px-4 py-2.5 transition shadow-lg shadow-emerald-500/20"
              >
                Log in / Create account
              </button>
              <p className="text-[11px] text-slate-500 max-w-xs">
                Private beta for licensed real estate professionals. No credit
                card required during beta.
              </p>
            </div>
          </section>

          {/* Right: simple value props (no app UI) */}
          <section className="space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <h2 className="text-sm font-semibold mb-1">
                Why agents love RoomPrintz
              </h2>
              <ul className="space-y-1.5 text-xs text-slate-300">
                <li>• Turnaround in seconds, not days.</li>
                <li>• Multiple design styles for every listing.</li>
                <li>• Cleaner, brighter rooms without hiring a stager.</li>
                <li>• Perfect for condos, tenant-occupied homes, and flips.</li>
              </ul>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 space-y-2">
              <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wide">
                Built on the PetPrintz Compositor Engine™
              </h3>
              <p className="text-xs text-slate-400">
                The same custom AI compositing pipeline behind ultra-detailed
                pet portraits, now tuned for professional real estate photos.
              </p>
              <p className="text-[11px] text-slate-500">
                RoomPrintz is in active development. Features like property
                collections, client-ready presentations, and team accounts are
                coming soon.
              </p>
            </div>
          </section>
        </div>
      </div>

      {/* Auth section */}
      <section
        id="auth-panel"
        className="border-t border-slate-900/80 bg-slate-950/95"
      >
        <div className="max-w-3xl mx-auto px-4 py-6">
          <h2 className="text-sm font-semibold tracking-tight mb-1">
            Log in or create your RoomPrintz account
          </h2>
          <p className="text-[11px] text-slate-400 mb-3">
            Use your email and a password to access the agent dashboard. Once
            you sign in, you&apos;ll be taken directly to your staging workspace.
          </p>
          <AuthPanel redirectToAppOnAuth />
        </div>
      </section>

      <footer className="border-t border-slate-900/80 py-3 text-[11px] text-slate-500 bg-slate-950">
        <div className="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>© {new Date().getFullYear()} RoomPrintz. All rights reserved.</span>
          <span className="text-slate-600">
            Built on the PetPrintz Compositor Engine™.
          </span>
        </div>
      </footer>
    </main>
  );
}
