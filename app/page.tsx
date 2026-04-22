// app/page.tsx (Landing)
"use client";

import { useState } from "react";
import { AuthPanel } from "@/components/AuthPanel";

export default function LandingPage() {
  const [selectedPath, setSelectedPath] = useState<"upload" | "product" | "sample" | null>(null);

  const scrollToAuth = (path?: "upload" | "product" | "sample") => {
    if (path) setSelectedPath(path);
    const el = document.getElementById("auth-panel");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const pathPrompt =
    selectedPath === "upload"
      ? "You picked Upload room. After sign-in, upload a photo of your room to get started."
      : selectedPath === "product"
        ? "You picked Paste product. After sign-in, paste a product link to see it in your room."
        : selectedPath === "sample"
          ? "You picked Try sample room. After sign-in, try a sample room first, then use your own."
          : null;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 flex flex-col">
      <div className="flex-1">
        <div className="max-w-5xl mx-auto px-4 py-10 md:py-14 space-y-8">
          <section className="space-y-4">
            <div className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/5 px-3 py-1 text-[11px] text-emerald-200 font-medium">
              Vibode • Closed Beta
            </div>
            <h1 className="text-3xl md:text-5xl font-semibold tracking-tight max-w-3xl">
              See it in your room before you buy.
            </h1>
            <p className="text-sm md:text-base text-slate-300 max-w-2xl">
              Vibode helps you visualize furniture in real rooms in under a minute. Start from your
              own room, a product link, or a sample room to test the workflow.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 pt-1">
              <button
                type="button"
                onClick={() => scrollToAuth()}
                className="inline-flex items-center justify-center rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-medium px-4 py-2.5 transition shadow-lg shadow-emerald-500/20"
              >
                Log in / Create account
              </button>
              <p className="text-[11px] text-slate-500 max-w-xs">
                Invite-only beta. Sign in to start designing in your room.
              </p>
            </div>
          </section>

          <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <article className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
              <h2 className="text-sm font-semibold text-slate-100">1) Upload room</h2>
              <p className="text-xs text-slate-300">
                Start with a photo of your room and place products where you want them.
              </p>
              <button
                type="button"
                onClick={() => scrollToAuth("upload")}
                className="text-xs rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-medium px-3 py-1.5 transition"
              >
                Start with room photo
              </button>
            </article>

            <article className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
              <h2 className="text-sm font-semibold text-slate-100">2) Paste a product</h2>
              <p className="text-xs text-slate-300">
                Paste a product link or image to see it instantly in your room before buying.
              </p>
              <button
                type="button"
                onClick={() => scrollToAuth("product")}
                className="text-xs rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-medium px-3 py-1.5 transition"
              >
                Start with a product link
              </button>
            </article>

            <article className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
              <h2 className="text-sm font-semibold text-slate-100">3) Try sample room</h2>
              <p className="text-xs text-slate-300">
                Run the full flow on a sample room first, then move to your own images.
              </p>
              <button
                type="button"
                onClick={() => scrollToAuth("sample")}
                className="text-xs rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-medium px-3 py-1.5 transition"
              >
                Start with sample room
              </button>
            </article>
          </section>
        </div>
      </div>

      <section
        id="auth-panel"
        className="border-t border-slate-900/80 bg-slate-950/95"
      >
        <div className="max-w-3xl mx-auto px-4 py-6">
          <h2 className="text-sm font-semibold tracking-tight mb-1">
            Log in or create your Vibode account
          </h2>
          <p className="text-[11px] text-slate-400 mb-3">
            Use your email and password to access Vibode. After sign-in, you&apos;ll be sent directly
            to the editor workspace.
          </p>
          {pathPrompt ? (
            <p className="text-[11px] text-emerald-200/90 mb-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2 py-1.5">
              {pathPrompt}
            </p>
          ) : null}
          <AuthPanel redirectToAppOnAuth />
        </div>
      </section>

      <footer className="border-t border-slate-900/80 py-3 text-[11px] text-slate-500 bg-slate-950">
        <div className="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>© {new Date().getFullYear()} Vibode. All rights reserved.</span>
          <span className="text-slate-600">Private beta.</span>
        </div>
      </footer>
    </main>
  );
}
