"use client";

import Image from "next/image";
import {
  type ChangeEvent,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";

import {
  AFC_STATUS_LABELS,
  INITIAL_AFC_ORCHESTRATION_STATE,
  reduceAfcOrchestrationState,
} from "./orchestration-state";
import {
  REPRESENTATION_DESCRIPTIONS,
  REPRESENTATION_KINDS,
  REPRESENTATION_LABELS,
  createInitialRepresentationState,
  setOriginalRepresentation,
} from "./representation-state";

const ARCHITECTURE_PANELS = [
  {
    title: "Floor",
    message: "Floor calibration will be introduced in V2-S2.",
  },
  {
    title: "Camera",
    message: "No calibrated camera.",
  },
  {
    title: "Room Boundaries",
    message: "Room-envelope analysis will be introduced after floor parity.",
  },
  {
    title: "Supports",
    message: "No calibrated support surfaces.",
  },
] as const;

export default function RoomLabV2() {
  const [representations, setRepresentations] = useState(
    createInitialRepresentationState,
  );
  const [orchestration, dispatch] = useReducer(
    reduceAfcOrchestrationState,
    INITIAL_AFC_ORCHESTRATION_STATE,
  );
  const objectUrlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    [],
  );

  const selectedRepresentation =
    representations[orchestration.selectedRepresentation];
  const originalAvailable =
    representations.ORIGINAL.availability === "available";

  function handleOriginalSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;

    const imageUrl = URL.createObjectURL(file);
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = imageUrl;

    setRepresentations((current) =>
      setOriginalRepresentation(current, {
        imageUrl,
        source: {
          type: "local-file",
          fileName: file.name,
          mimeType: file.type,
        },
      }),
    );
    dispatch({ type: "original_loaded" });
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-6 px-5 py-6 sm:px-8 lg:px-10">
        <header className="flex flex-col gap-5 border-b border-slate-800 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-3">
              <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs font-semibold tracking-[0.16em] text-cyan-200">
                AFC V2 · S1
              </span>
              <span className="text-xs text-slate-500">
                Clean architecture shell
              </span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              3D Room Lab v2
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              Load an Original room and inspect explicit representation state.
              AFC geometry is not implemented in V2-S1.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="cursor-pointer rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-medium text-slate-100 transition hover:border-slate-500 hover:bg-slate-800 focus-within:ring-2 focus-within:ring-cyan-400">
              Load Original
              <input
                className="sr-only"
                type="file"
                accept="image/*"
                onChange={handleOriginalSelection}
                aria-label="Load Original room image"
              />
            </label>
            <button
              type="button"
              disabled={!originalAvailable}
              onClick={() => dispatch({ type: "analysis_requested" })}
              className="rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
              title={
                originalAvailable
                  ? "AFC analysis is not implemented in V2-S1"
                  : "Load an Original room image first"
              }
            >
              Analyze &amp; Apply AFC
            </button>
          </div>
        </header>

        <section
          className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]"
          aria-label="AFC v2 workspace"
        >
          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 shadow-2xl shadow-black/20">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
              <div
                className="flex flex-wrap gap-1"
                role="tablist"
                aria-label="Room representations"
              >
                {REPRESENTATION_KINDS.map((kind) => {
                  const active =
                    orchestration.selectedRepresentation === kind;
                  const available =
                    representations[kind].availability === "available";
                  return (
                    <button
                      key={kind}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() =>
                        dispatch({
                          type: "representation_selected",
                          representation: kind,
                        })
                      }
                      className={`rounded-md px-3 py-2 text-xs font-semibold tracking-wide transition ${
                        active
                          ? "bg-slate-700 text-white"
                          : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                      }`}
                    >
                      {REPRESENTATION_LABELS[kind]}
                      {!available && kind !== "ORIGINAL" ? (
                        <span className="ml-2 text-slate-600">—</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <span className="text-xs text-slate-500">
                {REPRESENTATION_DESCRIPTIONS[
                  orchestration.selectedRepresentation
                ]}
              </span>
            </div>

            <div
              className="relative flex min-h-[440px] items-center justify-center bg-black/40 lg:min-h-[620px]"
              role="tabpanel"
              aria-label={`${REPRESENTATION_LABELS[orchestration.selectedRepresentation]} viewer`}
            >
              {selectedRepresentation.availability === "available" ? (
                <>
                  <Image
                    src={selectedRepresentation.imageUrl}
                    alt="Loaded Original room"
                    fill
                    unoptimized
                    className="object-contain"
                  />
                  {selectedRepresentation.source ? (
                    <div className="absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] truncate rounded-md bg-slate-950/80 px-3 py-1.5 text-xs text-slate-300 backdrop-blur">
                      Original · {selectedRepresentation.source.fileName}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="max-w-md px-8 text-center">
                  <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-lg text-slate-500">
                    —
                  </div>
                  <h2 className="text-base font-semibold text-slate-200">
                    {
                      REPRESENTATION_LABELS[
                        orchestration.selectedRepresentation
                      ]
                    }{" "}
                    is unavailable
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    {selectedRepresentation.reason}
                  </p>
                </div>
              )}
            </div>
          </div>

          <aside className="flex flex-col gap-3" aria-label="AFC architecture status">
            <section className="rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-4">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-sm font-semibold text-slate-100">
                  AFC Status
                </h2>
                <span className="size-2 rounded-full bg-cyan-300" />
              </div>
              <p
                className="mt-3 text-sm font-medium text-cyan-100"
                aria-live="polite"
              >
                {AFC_STATUS_LABELS[orchestration.status]}
              </p>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                The primary action is a non-geometric shell action in this
                stage.
              </p>
            </section>

            {ARCHITECTURE_PANELS.map((panel) => (
              <section
                key={panel.title}
                className="rounded-xl border border-slate-800 bg-slate-900/70 p-4"
              >
                <h2 className="text-sm font-semibold text-slate-200">
                  {panel.title}
                </h2>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  {panel.message}
                </p>
              </section>
            ))}
          </aside>
        </section>
      </div>
    </main>
  );
}
