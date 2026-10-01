"use client";

import { useCallback, useEffect, useState } from "react";

import {
  AFC_IMAGE_MODEL_DEFAULT,
  AFC_IMAGE_MODEL_OPTION_LIST,
  isAfcImageModelChoice,
  type AfcImageModelChoice,
} from "@/lib/afc-image-models";

export default function AfcImageModelSettings() {
  const [emptyImageModel, setEmptyImageModel] = useState<AfcImageModelChoice>(
    AFC_IMAGE_MODEL_DEFAULT,
  );
  const [tiledImageModel, setTiledImageModel] = useState<AfcImageModelChoice>(
    AFC_IMAGE_MODEL_DEFAULT,
  );
  const [afcImageModelsError, setAfcImageModelsError] = useState<string | null>(null);
  const [afcImageModelsStatus, setAfcImageModelsStatus] = useState<
    "loading" | "ready" | "saving"
  >("loading");

  const loadAfcImageModels = useCallback(async () => {
    setAfcImageModelsStatus("loading");
    setAfcImageModelsError(null);
    try {
      const response = await fetch("/api/admin/afc-image-models", {
        method: "GET",
        credentials: "same-origin",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        settings?: { empty?: unknown; tiled?: unknown };
        error?: unknown;
      };
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "Failed to load AFC image models.",
        );
      }
      if (
        !isAfcImageModelChoice(payload.settings?.empty) ||
        !isAfcImageModelChoice(payload.settings?.tiled)
      ) {
        throw new Error("AFC image model settings were unreadable.");
      }
      setEmptyImageModel(payload.settings.empty);
      setTiledImageModel(payload.settings.tiled);
    } catch (err: unknown) {
      setAfcImageModelsError(
        err instanceof Error ? err.message : "Failed to load AFC image models.",
      );
    } finally {
      setAfcImageModelsStatus("ready");
    }
  }, []);

  useEffect(() => {
    void loadAfcImageModels();
  }, [loadAfcImageModels]);

  const persistAfcImageModels = useCallback(
    async (next: { empty: AfcImageModelChoice; tiled: AfcImageModelChoice }) => {
      const previous = { empty: emptyImageModel, tiled: tiledImageModel };
      setEmptyImageModel(next.empty);
      setTiledImageModel(next.tiled);
      setAfcImageModelsStatus("saving");
      setAfcImageModelsError(null);
      try {
        const response = await fetch("/api/admin/afc-image-models", {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          settings?: { empty?: unknown; tiled?: unknown };
          error?: unknown;
        };
        if (
          !response.ok ||
          !isAfcImageModelChoice(payload.settings?.empty) ||
          !isAfcImageModelChoice(payload.settings?.tiled)
        ) {
          throw new Error(
            typeof payload.error === "string"
              ? payload.error
              : "Failed to save AFC image models.",
          );
        }
        setEmptyImageModel(payload.settings.empty);
        setTiledImageModel(payload.settings.tiled);
      } catch (err: unknown) {
        setEmptyImageModel(previous.empty);
        setTiledImageModel(previous.tiled);
        setAfcImageModelsError(
          err instanceof Error ? err.message : "Failed to save AFC image models.",
        );
      } finally {
        setAfcImageModelsStatus("ready");
      }
    },
    [emptyImageModel, tiledImageModel],
  );

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <h2 className="text-base font-medium text-slate-100">AFC Image Models</h2>
      <p className="mt-1 text-xs text-slate-400">
        Choose the image model for AFC EMPTY and AFC TILED independently.
        Existing rooms stay on Nano Banana Pro until a selection is saved.
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-400">AFC EMPTY</span>
          <select
            aria-label="AFC EMPTY image model"
            value={emptyImageModel}
            disabled={afcImageModelsStatus !== "ready"}
            onChange={(event) => {
              if (!isAfcImageModelChoice(event.target.value)) return;
              void persistAfcImageModels({
                empty: event.target.value,
                tiled: tiledImageModel,
              });
            }}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400 disabled:opacity-60"
          >
            {AFC_IMAGE_MODEL_OPTION_LIST.map((option) => (
              <option key={option.choice} value={option.choice}>
                {option.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-400">AFC TILED</span>
          <select
            aria-label="AFC TILED image model"
            value={tiledImageModel}
            disabled={afcImageModelsStatus !== "ready"}
            onChange={(event) => {
              if (!isAfcImageModelChoice(event.target.value)) return;
              void persistAfcImageModels({
                empty: emptyImageModel,
                tiled: event.target.value,
              });
            }}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400 disabled:opacity-60"
          >
            {AFC_IMAGE_MODEL_OPTION_LIST.map((option) => (
              <option key={option.choice} value={option.choice}>
                {option.displayName}
              </option>
            ))}
          </select>
        </label>
      </div>
      {afcImageModelsError ? (
        <p className="mt-3 text-xs text-rose-300" role="alert">
          {afcImageModelsError}
        </p>
      ) : (
        <p className="mt-3 text-xs text-slate-500">
          {afcImageModelsStatus === "saving"
            ? "Saving AFC image models..."
            : afcImageModelsStatus === "loading"
              ? "Loading AFC image models..."
              : "Selections save immediately."}
        </p>
      )}
    </section>
  );
}
