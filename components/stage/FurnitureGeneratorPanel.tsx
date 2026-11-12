"use client";

import { useEffect, useRef, useState } from "react";

import {
  FURNITURE_VIEW_LABELS,
  FURNITURE_VIEW_SLOT_ORDER,
  furnitureInputMode,
  previewUrlsToRevoke,
  validateFurniturePhotoFile,
  validateFurniturePhotoPixels,
  type FurnitureViewSlot,
} from "@/lib/vibode-furniture/generator/images";
import { CandidatePreviewEntry } from "@/components/stage/CandidatePreviewEntry";
import {
  allowanceBalanceLine,
  betaSubmissionKey,
  claimBetaSubmission,
  customerJobCopy,
  nextPollDelayMs,
  shouldRefreshAllowance,
  submissionKeyAfterOutcome,
  type CustomerEntitlement,
  type CustomerJobSnapshot,
} from "@/lib/vibode-furniture/generator/beta-generation";
import {
  readBetaEntitlement,
  readBetaGeneration,
  readGenerationAccessToken,
  submitBetaGeneration,
} from "@/lib/vibode-furniture/generator/beta-generation-client";
import { requestCandidatePreview } from "@/lib/vibode-furniture/generator/candidate-preview";
import type { GlbPreviewRequest } from "@/lib/vibode-furniture/generator/preview";
import {
  generatorCapabilities,
  MESHY_REMESH_POLYCOUNT_MAX,
  MESHY_REMESH_POLYCOUNT_MIN,
  MESHY_TEXTURE_PROMPT_MAX,
  MESHY_V1_AI_MODEL,
  type FurnitureGeneratorSettings,
  type MeshyGeometryResolution,
  type MeshyTextureModelChoice,
  type MeshyTextureResolution,
} from "@/lib/vibode-furniture/generator/settings";
import {
  capabilityMode,
  initialFurnitureGeneratorUi,
  reduceFurnitureGenerator,
  type FurnitureGeneratorAction,
  type FurnitureGeneratorUiState,
} from "@/lib/vibode-furniture/generator/ui-state";

const BETA_PRESET_LOCKED = true;

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400";

const FIELD =
  "w-full min-w-0 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100 outline-none focus:border-neutral-500 disabled:cursor-not-allowed disabled:text-neutral-600";

const PREVIEW_EDGE_PX = 160;

const GEOMETRY_OPTIONS: readonly { value: MeshyGeometryResolution; label: string }[] = [
  { value: "standard", label: "Standard" },
  { value: "2k", label: "2K Ultra" },
  { value: "4k", label: "4K Ultra" },
];

const TEXTURE_RESOLUTION_OPTIONS: readonly { value: MeshyTextureResolution; label: string }[] = [
  { value: "2k", label: "2K" },
  { value: "4k", label: "4K" },
  { value: "8k", label: "8K" },
];

const TEXTURE_MODEL_OPTIONS: readonly { value: MeshyTextureModelChoice; label: string }[] = [
  { value: "default", label: "Meshy 7 (default)" },
  { value: "meshy-7", label: "Meshy 7" },
  { value: "meshy-n1", label: "Meshy N1" },
  { value: "meshy-6-lite", label: "Meshy 6 Lite" },
];

export function FurnitureGeneratorPanel({
  onOpenPreview,
  showFixturePreview = process.env.NODE_ENV !== "production",
  initialState,
  fixture,
}: {
  onOpenPreview: (request: GlbPreviewRequest) => void;
  showFixturePreview?: boolean;
  initialState?: FurnitureGeneratorUiState;
  fixture?: {
    entitlement: CustomerEntitlement;
    job?: CustomerJobSnapshot | null;
    notice?: string | null;
  };
}) {
  const [state, setState] = useState(() => initialFurnitureGeneratorUi(initialState));
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [entitlement, setEntitlement] = useState<CustomerEntitlement | null>(fixture?.entitlement ?? null);
  const [job, setJob] = useState<CustomerJobSnapshot | null>(fixture?.job ?? null);
  const [notice, setNotice] = useState<string | null>(fixture?.notice ?? null);
  const [busy, setBusy] = useState(false);
  const stateRef = useRef(state);
  const filesRef = useRef<Partial<Record<FurnitureViewSlot, File>>>({});
  const photoTokenRef = useRef<Partial<Record<FurnitureViewSlot, number>>>({});
  const mountedRef = useRef(true);
  const submissionRef = useRef<{ busy: boolean; key: string | null }>({ busy: false, key: null });
  const jobRef = useRef<CustomerJobSnapshot | null>(fixture?.job ?? null);
  const pollFlightRef = useRef(false);
  stateRef.current = state;
  jobRef.current = job;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const url of previewUrlsToRevoke(stateRef.current.previewUrls)) {
        URL.revokeObjectURL(url);
      }
      filesRef.current = {};
    };
  }, []);

  const polling = Boolean(job && customerJobCopy(job).poll);

  useEffect(() => {
    if (fixture) return;
    let cancelled = false;
    void (async () => {
      try {
        const token = await readGenerationAccessToken();
        if (!token || cancelled) return;
        const loaded = await readBetaEntitlement({ token });
        if (cancelled || !mountedRef.current) return;
        if (!loaded.ok) {
          setNotice(loaded.message);
          return;
        }
        setEntitlement(loaded.entitlement);
      } catch {
        if (!cancelled && mountedRef.current) setNotice("AI generation could not be checked.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fixture]);

  useEffect(() => {
    if (fixture || !polling) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let delay = 2_000;
    const tick = async () => {
      const current = jobRef.current;
      if (cancelled || !current || !customerJobCopy(current).poll) return;
      if (pollFlightRef.current) {
        timer = setTimeout(() => void tick(), delay);
        return;
      }
      pollFlightRef.current = true;
      let continuePolling = false;
      try {
        const token = await readGenerationAccessToken();
        if (token && !cancelled && mountedRef.current) {
          const read = await readBetaGeneration({ token, jobId: current.jobId });
          if (!cancelled && mountedRef.current && read.ok) {
            setJob(read.job);
            jobRef.current = read.job;
            if (shouldRefreshAllowance(read.job.status)) {
              submissionRef.current = { busy: false, key: null };
              const refreshed = await readBetaEntitlement({ token });
              if (!cancelled && refreshed.ok) setEntitlement(refreshed.entitlement);
            }
            continuePolling = customerJobCopy(read.job).poll;
          } else if (!cancelled && mountedRef.current) {
            continuePolling = true;
          }
        }
      } catch {
        continuePolling = !cancelled && mountedRef.current;
      } finally {
        pollFlightRef.current = false;
      }
      if (!continuePolling || cancelled) return;
      delay = nextPollDelayMs(delay);
      timer = setTimeout(() => void tick(), delay);
    };
    timer = setTimeout(() => void tick(), delay);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [fixture, polling]);

  function apply(action: FurnitureGeneratorAction) {
    const result = reduceFurnitureGenerator(stateRef.current, action);
    for (const url of result.revokeUrls) URL.revokeObjectURL(url);
    stateRef.current = result.state;
    setState(result.state);
  }

  async function acceptFile(slot: FurnitureViewSlot, file: File) {
    const token = (photoTokenRef.current[slot] ?? 0) + 1;
    photoTokenRef.current[slot] = token;
    const fileCheck = validateFurniturePhotoFile({
      fileName: file.name,
      mimeType: file.type,
      byteLength: file.size,
    });
    if (!fileCheck.ok) {
      apply({ type: "slot-error", slot, message: fileCheck.message });
      return;
    }
    if (fileCheck.mimeType !== "image/jpeg") {
      apply({ type: "slot-error", slot, message: "Beta generation uses a JPEG photo." });
      return;
    }
    let bitmap: ImageBitmap | null = null;
    let previewUrl: string | null = null;
    try {
      bitmap = await createImageBitmap(file);
      const pixels = validateFurniturePhotoPixels({
        widthPx: bitmap.width,
        heightPx: bitmap.height,
      });
      if (!pixels.ok) {
        if (photoTokenRef.current[slot] === token && mountedRef.current) {
          apply({ type: "slot-error", slot, message: pixels.message });
        }
        return;
      }
      const blob = await thumbnailBlob(bitmap);
      previewUrl = URL.createObjectURL(blob);
      if (!mountedRef.current || photoTokenRef.current[slot] !== token) {
        URL.revokeObjectURL(previewUrl);
        return;
      }
      filesRef.current[slot] = file;
      apply({
        type: "set-photo",
        previewUrl,
        photo: {
          slot,
          fileName: file.name,
          mimeType: fileCheck.mimeType,
          byteLength: file.size,
          widthPx: bitmap.width,
          heightPx: bitmap.height,
        },
      });
      previewUrl = null;
    } catch {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      if (mountedRef.current && photoTokenRef.current[slot] === token) {
        apply({
          type: "slot-error",
          slot,
          message: "This image could not be read. Use a JPEG, PNG, or WebP photo.",
        });
      }
    } finally {
      bitmap?.close();
    }
  }

  function removePhoto(slot: FurnitureViewSlot) {
    photoTokenRef.current[slot] = (photoTokenRef.current[slot] ?? 0) + 1;
    delete filesRef.current[slot];
    apply({ type: "remove-photo", slot });
  }

  function updateSettings(patch: Partial<FurnitureGeneratorSettings>) {
    if (BETA_PRESET_LOCKED) return;
    apply({
      type: "settings",
      settings: { ...stateRef.current.settings, ...patch },
    });
  }

  async function generate() {
    const front = stateRef.current.photos.front;
    const file = filesRef.current.front;
    if (!entitlement?.canGenerate || !front || front.mimeType !== "image/jpeg" || !file) {
      setNotice("Add a front JPEG before generating.");
      return;
    }
    const claimed = claimBetaSubmission(submissionRef.current, betaSubmissionKey);
    if (!claimed) return;
    submissionRef.current = claimed;
    setBusy(true);
    setNotice(null);
    try {
      const token = await readGenerationAccessToken();
      if (!token) {
        submissionRef.current = { busy: false, key: claimed.key };
        setNotice("Sign in to generate furniture.");
        return;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const submitted = await submitBetaGeneration({
        token,
        idempotencyKey: claimed.key,
        jpegBytes: bytes,
      });
      if (!mountedRef.current) return;
      if (!submitted.ok) {
        submissionRef.current = {
          busy: false,
          key: submissionKeyAfterOutcome(claimed.key, submitted.uncertain ? "uncertain" : "refused"),
        };
        setNotice(submitted.message);
        if (!submitted.uncertain) {
          const refreshed = await readBetaEntitlement({ token });
          if (mountedRef.current && refreshed.ok) setEntitlement(refreshed.entitlement);
        }
        return;
      }
      submissionRef.current = {
        busy: false,
        key: shouldRefreshAllowance(submitted.job.status)
          ? null
          : submissionKeyAfterOutcome(claimed.key, "started"),
      };
      setJob(submitted.job);
      jobRef.current = submitted.job;
      setNotice(submitted.created
        ? "The generation was accepted."
        : "This is the generation already started for that request.");
    } catch {
      submissionRef.current = { busy: false, key: claimed.key };
      if (mountedRef.current) {
        setNotice("The request did not finish. Try again. It will not start a second generation.");
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  async function previewReadyModel() {
    const current = jobRef.current;
    if (!current || current.status !== "ready") return;
    const token = await readGenerationAccessToken();
    if (!token) {
      setNotice("Sign in again to preview this model.");
      return;
    }
    const preview = await requestCandidatePreview({ jobId: current.jobId, token });
    if (!preview.ok) {
      setNotice(preview.message);
      return;
    }
    onOpenPreview({
      kind: "candidate",
      label: "Generated model",
      url: preview.previewUrl,
      jobId: current.jobId,
    });
  }

  const mode = furnitureInputMode(state.photos);
  const frontIsJpeg = state.photos.front?.mimeType === "image/jpeg";
  const jobBlocksGenerate = job != null && !["failed", "cancelled", "discarded", "expired", "saved"].includes(job.status);
  const canGenerate = entitlement?.canGenerate === true && frontIsJpeg && !busy && !jobBlocksGenerate;
  const caps = generatorCapabilities(state.settings, capabilityMode(state.photos));
  const ultra = state.settings.geometryResolution === "standard"
    ? "Off. Standard geometry is selected above. 2K and 4K Ultra add surface detail. 4K needs one photo."
    : state.settings.geometryResolution === "2k"
      ? "On. 2K Ultra is selected above. That pass runs at 2048³."
      : "On. 4K Ultra is selected above. That pass runs at 4096³ and needs one photo.";

  return (
    <div
      className="mt-3 flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain pr-1"
      data-furniture-generator="ready"
      data-input-mode={mode}
      data-generation-available={entitlement?.canGenerate ? "true" : "false"}
    >
      <h2 className="text-sm font-medium text-neutral-100">3D Furniture Generator</h2>
      <p className="mt-1 text-[11px] leading-5 text-neutral-400">
        Beta preset: one front JPEG, standard geometry, and 2K textures. Other settings stay fixed.
      </p>
      <p className="mt-1 text-[11px] leading-5 text-neutral-500" data-eligibility={entitlement?.state ?? "unknown"}>
        {entitlement ? allowanceBalanceLine(entitlement) ?? entitlement.reason : "AI generation availability is checked when this panel opens."}
      </p>
      {entitlement?.reason && entitlement.state !== "unapproved" ? (
        <p className="mt-1 text-[11px] leading-5 text-amber-200">{entitlement.reason}</p>
      ) : null}

      <div className="mt-3 space-y-2">
        {FURNITURE_VIEW_SLOT_ORDER.map((slot) => (
          <PhotoSlot
            key={slot}
            slot={slot}
            fileName={state.photos[slot]?.fileName ?? null}
            previewUrl={state.previewUrls[slot] ?? null}
            error={state.slotErrors[slot] ?? null}
            onFile={(file) => {
              void acceptFile(slot, file);
            }}
            onRemove={() => removePhoto(slot)}
          />
        ))}
      </div>

      <p className="mt-2 text-[11px] leading-5 text-neutral-400" data-generation-mode={mode}>
        {mode === "incomplete"
          ? "Add a front photo. Left, right, and back photos are optional."
          : mode === "single"
            ? "Single-image generation. The front photo is the only view."
            : "Multi-image generation. The front photo is sent first."}
      </p>

      <section className="mt-3 space-y-2" aria-label="Core generation settings">
        <div>
          <div className="text-[11px] text-neutral-400">Model</div>
          <div className="mt-1 text-xs text-neutral-100" data-generator-model={MESHY_V1_AI_MODEL}>
            Meshy 7.1
          </div>
        </div>
        <fieldset>
          <legend className="text-[11px] text-neutral-400">Geometry</legend>
          <div className="mt-1 grid grid-cols-3 gap-1" data-ultra={state.settings.geometryResolution}>
            {GEOMETRY_OPTIONS.map((option) => {
              const availability = caps.geometry[option.value];
              const selected = state.settings.geometryResolution === option.value;
              return (
                <label
                  key={option.value}
                  title={availability.reason ?? undefined}
                  className={`rounded-md border px-1 py-1 text-center text-[10px] ${FOCUS} ${
                    selected
                      ? "border-neutral-500 bg-neutral-800 text-neutral-100"
                      : "border-neutral-800 text-neutral-400"
                  } ${availability.enabled ? "cursor-pointer" : "cursor-not-allowed opacity-40"}`}
                >
                  <input
                    type="radio"
                    name="furniture-geometry"
                    className="sr-only"
                    value={option.value}
                    checked={selected}
                    disabled={!availability.enabled || BETA_PRESET_LOCKED}
                    onChange={() => updateSettings({ geometryResolution: option.value })}
                  />
                  {option.label}
                </label>
              );
            })}
          </div>
          <p className="mt-1 text-[10px] leading-4 text-neutral-500">
            2K and 4K are Ultra passes. 4K needs a single photo.
          </p>
        </fieldset>
        <label className="flex items-center justify-between gap-2 text-xs text-neutral-200">
          <span>Generate textures</span>
          <input
            type="checkbox"
            checked={state.settings.shouldTexture}
            aria-label="Generate textures"
            disabled={BETA_PRESET_LOCKED}
            onChange={(event) => updateSettings({ shouldTexture: event.target.checked })}
          />
        </label>
        <label className="block text-[11px] text-neutral-400">
          Texture resolution
          <select
            aria-label="Texture resolution"
            className={`${FIELD} mt-1`}
            value={state.settings.textureResolution}
            disabled={!state.settings.shouldTexture || BETA_PRESET_LOCKED}
            onChange={(event) => updateSettings({
              textureResolution: event.target.value as MeshyTextureResolution,
            })}
          >
            {TEXTURE_RESOLUTION_OPTIONS.map((option) => (
              <option
                key={option.value}
                value={option.value}
                disabled={!caps.textureResolution[option.value].enabled}
                title={caps.textureResolution[option.value].reason ?? undefined}
              >
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <button
        type="button"
        aria-expanded={advancedOpen}
        aria-controls="furniture-generator-advanced"
        onClick={() => setAdvancedOpen((open) => !open)}
        className={`mt-3 rounded-md border border-neutral-800 px-2 py-1 text-left text-[11px] text-neutral-300 ${FOCUS}`}
      >
        {advancedOpen ? "Hide advanced settings" : "Advanced settings"}
      </button>
      {advancedOpen ? (
        <div id="furniture-generator-advanced" className="mt-2 space-y-2 rounded-md border border-neutral-800 p-2">
          <div>
            <div className="text-[11px] text-neutral-300">Ultra geometry</div>
            <p className="mt-1 text-[10px] leading-4 text-neutral-500">{ultra}</p>
          </div>
          <label className="block text-[11px] text-neutral-400">
            Texture model
            <select
              aria-label="Texture model"
              className={`${FIELD} mt-1`}
              value={state.settings.textureModel}
              disabled={!state.settings.shouldTexture || BETA_PRESET_LOCKED}
              onChange={(event) => updateSettings({
                textureModel: event.target.value as MeshyTextureModelChoice,
              })}
            >
              {TEXTURE_MODEL_OPTIONS.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  disabled={!caps.textureModel[option.value].enabled}
                >
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label
            className="flex items-center justify-between gap-2 text-[11px] text-neutral-300"
            title={caps.enablePbr.reason ?? undefined}
          >
            <span>PBR maps</span>
            <input
              type="checkbox"
              aria-label="PBR maps"
              checked={state.settings.enablePbr}
              disabled={!caps.enablePbr.enabled || BETA_PRESET_LOCKED}
              onChange={(event) => updateSettings({ enablePbr: event.target.checked })}
            />
          </label>
          <label className="block text-[11px] text-neutral-400" title={caps.texturePrompt.reason ?? undefined}>
            Texture guidance
            <textarea
              aria-label="Texture guidance"
              className={`${FIELD} mt-1 resize-y`}
              rows={3}
              maxLength={MESHY_TEXTURE_PROMPT_MAX}
              value={state.settings.texturePrompt}
              disabled={!caps.texturePrompt.enabled || BETA_PRESET_LOCKED}
              placeholder={caps.texturePrompt.reason ?? "Optional notes for color and material"}
              onChange={(event) => updateSettings({ texturePrompt: event.target.value })}
            />
          </label>
          <label className="flex items-start justify-between gap-2 text-[11px] text-neutral-300">
            <span>Enhance reference photos</span>
            <input
              type="checkbox"
              aria-label="Enhance reference photos"
              checked={state.settings.imageEnhancement}
              disabled={BETA_PRESET_LOCKED}
              onChange={(event) => updateSettings({ imageEnhancement: event.target.checked })}
            />
          </label>
          <p className="text-[10px] leading-4 text-neutral-500">
            Off keeps the original photo look. Meshy 7.1 supports this for furniture photos.
          </p>
          <label className="flex items-center justify-between gap-2 text-[11px] text-neutral-300">
            <span>Remesh</span>
            <input
              type="checkbox"
              aria-label="Remesh"
              checked={state.settings.shouldRemesh}
              disabled={BETA_PRESET_LOCKED}
              onChange={(event) => updateSettings({ shouldRemesh: event.target.checked })}
            />
          </label>
          <p className="text-[10px] leading-4 text-neutral-500">
            Off keeps the highest-detail mesh. On simplifies it to a target face count.
          </p>
          <label className="block text-[11px] text-neutral-400">
            Remesh topology
            <select
              aria-label="Remesh topology"
              className={`${FIELD} mt-1`}
              value={state.settings.topology}
              disabled={!state.settings.shouldRemesh || BETA_PRESET_LOCKED}
              onChange={(event) => updateSettings({
                topology: event.target.value as FurnitureGeneratorSettings["topology"],
              })}
            >
              <option value="triangle">Triangles</option>
              <option value="quad" disabled={!caps.topologyQuad.enabled}>
                Quads
              </option>
            </select>
          </label>
          <label className="block text-[11px] text-neutral-400" title={caps.targetPolycount.reason ?? undefined}>
            Remesh face target
            <input
              aria-label="Remesh face target"
              className={`${FIELD} mt-1`}
              type="number"
              inputMode="numeric"
              min={MESHY_REMESH_POLYCOUNT_MIN}
              max={MESHY_REMESH_POLYCOUNT_MAX}
              step={1}
              disabled={!caps.targetPolycount.enabled || BETA_PRESET_LOCKED}
              value={Number.isFinite(state.settings.targetPolycount) ? state.settings.targetPolycount : ""}
              onChange={(event) => updateSettings({
                targetPolycount: event.target.value === "" ? Number.NaN : Number(event.target.value),
              })}
            />
          </label>
        </div>
      ) : null}

      {state.notices.length > 0 ? (
        <ul role="status" className="mt-2 space-y-1 text-[11px] leading-4 text-amber-200">
          {state.notices.map((notice) => <li key={notice}>{notice}</li>)}
        </ul>
      ) : null}

      <CandidatePreviewEntry onOpenPreview={onOpenPreview} />

      {job ? (
        <div className="mt-3" data-generation-phase={job.status} role="status">
          <div className="text-xs text-neutral-100">{customerJobCopy(job).title}</div>
          <p className="mt-1 text-[11px] leading-5 text-neutral-400">{customerJobCopy(job).detail}</p>
        </div>
      ) : null}
      {canGenerate ? (
        <button
          type="button"
          onClick={() => void generate()}
          data-generate="ready"
          className={`mt-3 rounded-md border border-neutral-600 bg-neutral-800 px-2.5 py-1.5 text-xs text-neutral-100 ${FOCUS}`}
        >
          Generate
        </button>
      ) : (
        <button
          type="button"
          disabled
          data-generate="unavailable"
          aria-describedby="furniture-generator-unavailable"
          className={`mt-3 rounded-md border border-neutral-900 bg-neutral-950 px-2.5 py-1.5 text-xs text-neutral-600 ${FOCUS}`}
        >
          Generate
        </button>
      )}
      {job?.status === "ready" ? (
        <button
          type="button"
          onClick={() => void previewReadyModel()}
          data-preview-ready="true"
          className={`mt-2 rounded-md border border-neutral-700 px-2.5 py-1.5 text-[11px] text-neutral-200 ${FOCUS}`}
        >
          Preview model
        </button>
      ) : null}
      <p id="furniture-generator-unavailable" className="mt-1 text-[11px] leading-5 text-neutral-500">
        {notice ?? "Generate stays off until this account is approved and a front JPEG is ready."}
      </p>

      {showFixturePreview ? (
        <div className="mt-3 border-t border-neutral-900 pt-3">
          <button
            type="button"
            onClick={() => onOpenPreview({ kind: "fixture", label: "Local test fixture" })}
            className={`rounded-md border border-neutral-700 px-2.5 py-1.5 text-[11px] text-neutral-200 ${FOCUS}`}
          >
            Preview test fixture
          </button>
          <p className="mt-1 text-[10px] leading-4 text-neutral-500">
            Opens a bundled chair for viewer testing. Meshy did not generate it.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function PhotoSlot({
  slot,
  fileName,
  previewUrl,
  error,
  onFile,
  onRemove,
}: {
  slot: FurnitureViewSlot;
  fileName: string | null;
  previewUrl: string | null;
  error: string | null;
  onFile: (file: File) => void;
  onRemove: () => void;
}) {
  const label = FURNITURE_VIEW_LABELS[slot];
  const required = slot === "front";
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] text-neutral-200">
          {label}{" "}
          <span className="text-neutral-500">{required ? "Required" : "Optional"}</span>
        </div>
        {fileName ? (
          <button
            type="button"
            onClick={onRemove}
            className={`rounded-md border border-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400 ${FOCUS}`}
          >
            Remove {label.toLowerCase()} view
          </button>
        ) : null}
      </div>
      <div className="mt-2 flex min-w-0 gap-2">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded bg-neutral-900">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- local object URL thumbnail, revoked with the photo
            <img src={previewUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-[10px] text-neutral-600">None</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <input
            type="file"
            accept="image/jpeg,.jpg,.jpeg"
            aria-label={required ? `${label} view, required` : `${label} view, optional`}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) onFile(file);
            }}
            className="block w-full min-w-0 max-w-full text-[10px] text-neutral-400 file:mr-2 file:rounded-md file:border file:border-neutral-700 file:bg-neutral-900 file:px-2 file:py-1 file:text-[10px] file:text-neutral-200"
          />
          {fileName ? (
            <div className="mt-1 truncate text-[10px] text-neutral-500">{fileName}</div>
          ) : null}
          {error ? <div className="mt-1 text-[10px] leading-4 text-amber-200">{error}</div> : null}
        </div>
      </div>
    </div>
  );
}

async function thumbnailBlob(bitmap: ImageBitmap): Promise<Blob> {
  const scale = Math.min(1, PREVIEW_EDGE_PX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("preview");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((next) => resolve(next), "image/jpeg", 0.82);
  });
  if (!blob) throw new Error("preview");
  return blob;
}
