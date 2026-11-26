// app/page.tsx (Landing)
"use client";

import { useState } from "react";
import { AuthPanel } from "@/components/AuthPanel";
import { LatestFurnitureCollectionImportBanner } from "@/components/LatestFurnitureCollectionImportBanner";
import { VibodeButton } from "@/components/ui/VibodeButton";

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
    <main className="scheme-light min-h-screen bg-canvas text-ink flex flex-col">
      <div className="flex-1">
        <div className="max-w-5xl mx-auto px-4 py-10 md:py-14 space-y-8">
          <section className="space-y-4">
            <div className="inline-flex items-center rounded-full border border-ink-secondary bg-canvas-warm px-3 py-1 text-[11px] text-ink-secondary font-medium">
              Vibode • Closed Beta
            </div>
            <h1 className="text-3xl md:text-5xl font-semibold tracking-tight max-w-3xl text-ink">
              See it in your room before you buy.
            </h1>
            <p className="text-sm md:text-base text-ink-secondary max-w-2xl">
              Vibode helps you visualize furniture in real rooms in under a minute. Start from your
              own room, a product link, or a sample room to test the workflow.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 pt-1">
              <VibodeButton type="button" variant="primary" size="large" onClick={() => scrollToAuth()}>
                Log in / Create account
              </VibodeButton>
              <p className="text-[11px] text-ink-secondary max-w-xs">
                Invite-only beta. Sign in to start designing your first room.
              </p>
            </div>
          </section>

          <LatestFurnitureCollectionImportBanner appearance="retail" />

          <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <article className="rounded-2xl border border-line bg-canvas-warm p-4 space-y-3">
              <h2 className="text-sm font-semibold text-ink">1) Upload room</h2>
              <p className="text-xs text-ink-secondary">
                Start with a photo of your room and place products where you want them.
              </p>
              <VibodeButton type="button" variant="primary" size="compact" onClick={() => scrollToAuth("upload")}>
                Start with room photo
              </VibodeButton>
            </article>

            <article className="rounded-2xl border border-line bg-canvas-warm p-4 space-y-3">
              <h2 className="text-sm font-semibold text-ink">2) Paste a product</h2>
              <p className="text-xs text-ink-secondary">
                Paste a product link or image to see it instantly in your room before buying.
              </p>
              <VibodeButton type="button" variant="primary" size="compact" onClick={() => scrollToAuth("product")}>
                Start with a product link
              </VibodeButton>
            </article>

            <article className="rounded-2xl border border-line bg-canvas-warm p-4 space-y-3">
              <h2 className="text-sm font-semibold text-ink">3) Try sample room</h2>
              <p className="text-xs text-ink-secondary">
                Run the full flow on a sample room first, then move to your own images.
              </p>
              <VibodeButton type="button" variant="primary" size="compact" onClick={() => scrollToAuth("sample")}>
                Start with sample room
              </VibodeButton>
            </article>
          </section>
        </div>
      </div>

      <section
        id="auth-panel"
        className="border-t border-line bg-canvas-warm"
      >
        <div className="max-w-3xl mx-auto px-4 py-6">
          <h2 className="text-sm font-semibold tracking-tight mb-1 text-ink">
            Log in or create your Vibode account
          </h2>
          <p className="text-[11px] text-ink-secondary mb-3">
            Use your email and password to access Vibode. After sign-in, you&apos;ll be sent directly
            to the editor workspace.
          </p>
          {pathPrompt ? (
            <p className="text-[11px] text-ink-secondary mb-3 rounded-md border border-line bg-canvas px-2 py-1.5">
              {pathPrompt}
            </p>
          ) : null}
          <AuthPanel redirectToAppOnAuth appearance="retail" />
        </div>
      </section>

      <footer className="border-t border-line py-3 text-[11px] text-ink-secondary bg-canvas">
        <div className="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>© {new Date().getFullYear()} Vibode. All rights reserved.</span>
          <span>Private beta.</span>
        </div>
      </footer>
    </main>
  );
}
