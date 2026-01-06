// app/editor/page.tsx
"use client";

import React, { useMemo, useState } from "react";
import { EditorCanvas } from "@/components/editor/EditorCanvas";

const DND_MIME = "application/x-roomprintz-furniture";

const MOCK_FURNITURE = [
  {
    skuId: "sofa-001",
    label: "Sofa — 84in",
    defaultPxWidth: 260,
    defaultPxHeight: 120,
  },
  {
    skuId: "chair-001",
    label: "Accent Chair — 32in",
    defaultPxWidth: 120,
    defaultPxHeight: 120,
  },
  {
    skuId: "table-001",
    label: "Coffee Table — 48in",
    defaultPxWidth: 180,
    defaultPxHeight: 90,
  },
  {
    skuId: "rug-001",
    label: "Rug — 8x10",
    defaultPxWidth: 300,
    defaultPxHeight: 220,
  },
];

const SWAP_OPTIONS = MOCK_FURNITURE;

export default function EditorPage() {
  const [activeTool, setActiveTool] = useState<"select" | "furniture" | "mask">(
    "select"
  );
  const [search, setSearch] = useState("");

  const [swapOpen, setSwapOpen] = useState(false);
  const [swapTargetId, setSwapTargetId] = useState<string | null>(null);

  const filteredFurniture = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return MOCK_FURNITURE;
    return MOCK_FURNITURE.filter((it) => {
      const hay = `${it.label} ${it.skuId}`.toLowerCase();
      return hay.includes(q);
    });
  }, [search]);

  return (
    <div className="h-dvh w-full bg-neutral-950 text-neutral-100">
      {/* Top bar */}
      <header className="flex h-12 items-center justify-between border-b border-neutral-800 px-4">
        <div className="flex items-center gap-3">
          <div className="h-6 w-6 rounded bg-neutral-700" />
          <div className="text-sm font-medium tracking-wide">
            RoomPrintz Editor
          </div>
          <div className="ml-2 rounded border border-neutral-800 px-2 py-0.5 text-xs text-neutral-300">
            V0
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm hover:bg-neutral-800">
            Generate
          </button>
        </div>
      </header>

      {/* Main */}
      <div className="flex h-[calc(100dvh-3rem)] w-full">
        {/* Left tool rail */}
        <aside className="flex w-14 flex-col items-center gap-2 border-r border-neutral-800 bg-neutral-950 py-3">
          <button
            className={[
              "h-10 w-10 rounded-md border text-sm",
              activeTool === "select"
                ? "border-neutral-600 bg-neutral-800"
                : "border-neutral-800 bg-neutral-900 hover:bg-neutral-800",
            ].join(" ")}
            title="Select/Move (V)"
            onClick={() => setActiveTool("select")}
          >
            V
          </button>

          <button
            className={[
              "h-10 w-10 rounded-md border text-sm",
              activeTool === "furniture"
                ? "border-neutral-600 bg-neutral-800"
                : "border-neutral-800 bg-neutral-900 hover:bg-neutral-800",
            ].join(" ")}
            title="Furniture (F)"
            onClick={() => setActiveTool("furniture")}
          >
            F
          </button>

          <button
            className={[
              "h-10 w-10 rounded-md border text-sm",
              activeTool === "mask"
                ? "border-neutral-600 bg-neutral-800"
                : "border-neutral-800 bg-neutral-900 hover:bg-neutral-800",
            ].join(" ")}
            title="Mask (M)"
            onClick={() => setActiveTool("mask")}
          >
            M
          </button>
        </aside>

        {/* Canvas area */}
        <main className="flex flex-1 items-center justify-center bg-neutral-950">
          <div className="relative h-[70vh] w-[70vw] max-w-[1200px] overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
            <EditorCanvas
              className="absolute inset-0"
              onRequestSwap={(id: string) => {
                setSwapTargetId(id);
                setSwapOpen(true);
              }}
            />
          </div>
        </main>

        {/* Right panel */}
        <aside className="w-[340px] border-l border-neutral-800 bg-neutral-950">
          <div className="border-b border-neutral-800 px-4 py-3">
            <div className="text-sm font-medium">Panels</div>
            <div className="mt-1 text-xs text-neutral-400">
              Furniture catalog + AI Actions (coming next)
            </div>
          </div>

          <div className="p-4">
            {/* Furniture */}
            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Furniture</div>
                <div className="rounded border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-[11px] text-neutral-300">
                  Drag & Drop
                </div>
              </div>

              <div className="mt-2 text-xs text-neutral-400">
                Drag an item onto the canvas.
              </div>

              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search furniture…"
                className="mt-3 w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-700"
              />

              <div className="mt-3 flex max-h-[44vh] flex-col gap-2 overflow-auto pr-1">
                {filteredFurniture.length === 0 ? (
                  <div className="rounded-md border border-dashed border-neutral-700 bg-neutral-950 px-3 py-6 text-center text-xs text-neutral-400">
                    No matches
                  </div>
                ) : (
                  filteredFurniture.map((item) => (
                    <div
                      key={item.skuId}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DND_MIME, JSON.stringify(item));
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      className="cursor-grab rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm hover:bg-neutral-800 active:cursor-grabbing"
                      title="Drag onto canvas"
                    >
                      {item.label}
                      <div className="mt-0.5 text-xs text-neutral-400">
                        {item.skuId}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* AI Actions */}
            <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900 p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">AI Actions</div>
                <div className="rounded border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-[11px] text-neutral-400">
                  Soon
                </div>
              </div>

              <div className="mt-2 flex flex-col gap-2">
                {["Cleanup Room", "Generate"].map((txt) => (
                  <button
                    key={txt}
                    className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-left text-sm hover:bg-neutral-800"
                    onClick={() => {
                      console.log(`${txt} clicked`);
                    }}
                  >
                    {txt}
                  </button>
                ))}
              </div>

              <div className="mt-3 text-xs text-neutral-500">
                Active tool:{" "}
                <span className="text-neutral-300">{activeTool}</span>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* Swap modal */}
      {swapOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-neutral-800 bg-neutral-950 shadow-xl">
            <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
              <div>
                <div className="text-sm font-medium">Swap Furniture</div>
                <div className="text-xs text-neutral-400">
                  Choose a replacement item
                </div>
              </div>
              <button
                className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-sm hover:bg-neutral-800"
                onClick={() => setSwapOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="max-h-[60vh] overflow-auto p-4">
              <div className="grid grid-cols-1 gap-2">
                {SWAP_OPTIONS.map((opt) => (
                  <button
                    key={opt.skuId}
                    className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-3 text-left hover:bg-neutral-800"
                    onClick={() => {
                      alert(
                        `Swap target: ${swapTargetId}\nSelected: ${opt.label} (${opt.skuId})\n\nNext step: wire swap into canvas state.`
                      );
                      setSwapOpen(false);
                    }}
                  >
                    <div className="text-sm font-medium">{opt.label}</div>
                    <div className="mt-0.5 text-xs text-neutral-400">
                      {opt.skuId}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
