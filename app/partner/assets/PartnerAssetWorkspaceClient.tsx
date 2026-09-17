"use client";

import { useCallback, useEffect, useState } from "react";

import { formatPartnerIntakeMetresTriple, formatSha256Prefix } from "@/lib/vibode-stage/partner-asset-intake-display";

type IntakeWarning = Readonly<{
  code: string;
  message: string;
}>;

type IntakeDto = Readonly<{
  intakeId: string;
  status: "created" | "uploaded" | "validating" | "validated" | "failed";
  originalFileName: string;
  dimensionSource?: "product" | "glb";
  authoredWidthM: number | null;
  authoredHeightM: number | null;
  authoredDepthM: number | null;
  measuredWidthM: number | null;
  measuredHeightM: number | null;
  measuredDepthM: number | null;
  sha256: string | null;
  warnings: readonly IntakeWarning[];
  errorCode: string | null;
  error: string | null;
  assetId: string | null;
  createdAt: string;
  updatedAt: string;
}>;

type CreateResponse = Readonly<{
  ok?: boolean;
  error?: string;
  intakeId?: string;
  objectPath?: string;
  signedUrl?: string;
  token?: string;
  intake?: IntakeDto;
}>;

type FinalizeResponse = Readonly<{
  ok?: boolean;
  error?: string;
  intake?: IntakeDto;
}>;

type ListResponse = Readonly<{
  ok?: boolean;
  error?: string;
  intakes?: IntakeDto[];
}>;

type RegisteredAssetDto = Readonly<{
  assetId: string;
  status: "ready" | "unavailable";
  originalFileName: string | null;
  measuredWidthM: number;
  measuredHeightM: number;
  measuredDepthM: number;
  sha256: string | null;
  registeredAt: string;
  origin: "partner_intake" | "catalog_linked";
}>;

type RegisteredListResponse = Readonly<{
  ok?: boolean;
  error?: string;
  assets?: RegisteredAssetDto[];
}>;

type RegisterResponse = Readonly<{
  ok?: boolean;
  error?: string;
  asset?: RegisteredAssetDto & { originalFileName: string; sha256: string };
}>;

type Phase = "idle" | "uploading" | "validating";

function metresField(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function uploadToSignedUrl(
  signedUrl: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl);
    xhr.setRequestHeader("Content-Type", "model/gltf-binary");
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      onProgress(Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100))));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
        return;
      }
      reject(new Error("Upload failed."));
    };
    xhr.onerror = () => reject(new Error("Upload failed."));
    xhr.send(file);
  });
}

function statusLabel(intake: IntakeDto): string {
  if (intake.assetId) return "Registered";
  if (intake.status === "validated") return "Validated";
  if (intake.status === "failed") return "Failed";
  if (intake.status === "validating") return "Validating";
  if (intake.status === "uploaded") return "Uploaded";
  return "Created";
}

function productDimensionsLabel(intake: IntakeDto): string | null {
  if (intake.authoredWidthM == null || intake.authoredHeightM == null || intake.authoredDepthM == null) {
    return null;
  }
  return formatPartnerIntakeMetresTriple(
    intake.authoredWidthM,
    intake.authoredHeightM,
    intake.authoredDepthM,
  );
}

function intakeUsesGlbDimensions(intake: IntakeDto): boolean {
  return intake.dimensionSource === "glb";
}

function glbMeasuredLabel(intake: IntakeDto): string | null {
  if (intake.measuredWidthM == null || intake.measuredHeightM == null || intake.measuredDepthM == null) {
    return null;
  }
  return formatPartnerIntakeMetresTriple(
    intake.measuredWidthM,
    intake.measuredHeightM,
    intake.measuredDepthM,
  );
}

export function PartnerAssetWorkspaceClient() {
  const [intakes, setIntakes] = useState<IntakeDto[]>([]);
  const [registeredAssets, setRegisteredAssets] = useState<RegisteredAssetDto[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [widthM, setWidthM] = useState("");
  const [heightM, setHeightM] = useState("");
  const [depthM, setDepthM] = useState("");
  const [useGlbDimensions, setUseGlbDimensions] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastIntake, setLastIntake] = useState<IntakeDto | null>(null);
  const [registeringId, setRegisteringId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [intakeResponse, assetResponse] = await Promise.all([
      fetch("/api/vibode/partner/assets/intakes", { cache: "no-store" }),
      fetch("/api/vibode/partner/assets", { cache: "no-store" }),
    ]);
    const intakeBody = await intakeResponse.json() as ListResponse;
    if (!intakeResponse.ok || !intakeBody.ok || !Array.isArray(intakeBody.intakes)) {
      setLoadError(intakeBody.error ?? "Asset intakes could not be loaded.");
      return;
    }
    const assetBody = await assetResponse.json() as RegisteredListResponse;
    setLoadError(null);
    setIntakes(intakeBody.intakes);
    if (assetResponse.ok && assetBody.ok && Array.isArray(assetBody.assets)) {
      setRegisteredAssets(assetBody.assets);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onUpload() {
    setActionError(null);
    setLastIntake(null);
    if (!file) {
      setActionError("Choose a .glb file.");
      return;
    }
    const authoredWidthM = metresField(widthM);
    const authoredHeightM = metresField(heightM);
    const authoredDepthM = metresField(depthM);
    if (
      !useGlbDimensions &&
      (authoredWidthM == null || authoredHeightM == null || authoredDepthM == null)
    ) {
      setActionError("Width, height, and depth must be entered in metres as positive numbers.");
      return;
    }
    setPhase("uploading");
    setProgress(0);
    try {
      const created = await fetch("/api/vibode/partner/assets/intakes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          useGlbDimensions
            ? {
                originalFileName: file.name,
                byteSize: file.size,
                dimensionSource: "glb",
              }
            : {
                originalFileName: file.name,
                byteSize: file.size,
                dimensionSource: "product",
                authoredWidthM,
                authoredHeightM,
                authoredDepthM,
              },
        ),
      });
      const createdBody = await created.json() as CreateResponse;
      if (!created.ok || !createdBody.ok || !createdBody.intakeId || !createdBody.signedUrl) {
        setActionError(createdBody.error ?? "Intake could not be created.");
        setPhase("idle");
        setProgress(null);
        return;
      }
      await uploadToSignedUrl(createdBody.signedUrl, file, setProgress);
      setPhase("validating");
      const finalized = await fetch(
        `/api/vibode/partner/assets/intakes/${createdBody.intakeId}/finalize`,
        { method: "POST" },
      );
      const finalizedBody = await finalized.json() as FinalizeResponse;
      if (finalizedBody.intake) setLastIntake(finalizedBody.intake);
      if (!finalized.ok || !finalizedBody.ok) {
        setActionError(finalizedBody.error ?? "The GLB could not be validated.");
      }
      await refresh();
    } catch {
      setActionError("Upload failed.");
    } finally {
      setPhase("idle");
      setProgress(null);
    }
  }

  async function onRegister(intakeId: string) {
    setActionError(null);
    setRegisteringId(intakeId);
    try {
      const response = await fetch(`/api/vibode/partner/assets/intakes/${intakeId}/register`, {
        method: "POST",
      });
      const body = await response.json() as RegisterResponse;
      if (!response.ok || !body.ok) {
        setActionError(body.error ?? "The Asset could not be registered.");
      }
      await refresh();
    } catch {
      setActionError("The Asset could not be registered.");
    } finally {
      setRegisteringId(null);
    }
  }

  const busy = phase !== "idle" || registeringId != null;
  const phaseCopy = phase === "uploading"
    ? `Uploading${progress == null ? "…" : `… ${progress}%`}`
    : phase === "validating"
      ? "Validating…"
      : lastIntake?.status === "validated"
        ? "Validated"
        : lastIntake?.status === "failed"
          ? "Failed"
          : null;

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-slate-800 p-4 space-y-4">
        <h3 className="font-medium">Upload GLB</h3>
        <label className="block space-y-1 text-sm">
          <span className="text-slate-300">GLB file</span>
          <input
            type="file"
            accept=".glb,model/gltf-binary"
            disabled={busy}
            className="block w-full text-xs text-slate-300 file:mr-3 file:rounded-md file:border file:border-slate-700 file:bg-slate-900 file:px-3 file:py-1 file:text-xs"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setActionError(null);
            }}
          />
        </label>
        {file ? (
          <p className="text-xs text-slate-500">Original filename: {file.name}</p>
        ) : null}
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Actual product dimensions</h4>
          <p className="text-xs text-slate-400">
            Enter the real-world dimensions of the furniture product, in metres. Vibode will
            measure the uploaded GLB automatically and check that the model reasonably matches
            those product dimensions.
          </p>
          <p className="text-xs text-slate-500">
            The GLB should already be modeled at real-world scale. Vibode does not automatically
            resize uploaded furniture.
          </p>
          <label className="flex items-start gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={useGlbDimensions}
              disabled={busy}
              onChange={(event) => setUseGlbDimensions(event.target.checked)}
            />
            <span>Use GLB dimensions</span>
          </label>
          <p className="text-xs text-slate-500">
            For testing, use the dimensions measured directly from the uploaded GLB. This skips the independent product-dimension scale check.
          </p>
          {useGlbDimensions ? (
            <p className="text-xs text-slate-400">
              Vibode will derive Width, Height, and Depth from the uploaded GLB.
            </p>
          ) : null}
        </div>
        <div className={`grid gap-3 sm:grid-cols-3${useGlbDimensions ? " opacity-50" : ""}`}>
          <label className="block space-y-1 text-sm">
            <span className="text-slate-300">Width (m)</span>
            <input
              type="number"
              min="0"
              step="0.001"
              inputMode="decimal"
              disabled={busy || useGlbDimensions}
              value={widthM}
              onChange={(event) => setWidthM(event.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-slate-300">Height (m)</span>
            <input
              type="number"
              min="0"
              step="0.001"
              inputMode="decimal"
              disabled={busy || useGlbDimensions}
              value={heightM}
              onChange={(event) => setHeightM(event.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-slate-300">Depth (m)</span>
            <input
              type="number"
              min="0"
              step="0.001"
              inputMode="decimal"
              disabled={busy || useGlbDimensions}
              value={depthM}
              onChange={(event) => setDepthM(event.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm"
            />
          </label>
        </div>
        <button
          type="button"
          disabled={busy}
          className="rounded-md border border-slate-700 px-3 py-1.5 text-sm"
          onClick={() => void onUpload()}
        >
          {busy ? (phase === "uploading" ? "Uploading…" : "Validating…") : "Upload"}
        </button>
        {phaseCopy ? <p className="text-xs text-slate-400">{phaseCopy}</p> : null}
        {actionError ? <p className="text-xs text-rose-300">{actionError}</p> : null}
        {lastIntake?.status === "failed" && lastIntake.errorCode ? (
          <p className="font-mono text-[11px] text-rose-400">{lastIntake.errorCode}</p>
        ) : null}
        {lastIntake?.status === "failed" && lastIntake.errorCode === "DIMENSION_MISMATCH" ? (
          <div className="space-y-1 text-xs text-slate-400">
            {productDimensionsLabel(lastIntake) ? (
              <p>Actual product dimensions {productDimensionsLabel(lastIntake)}</p>
            ) : null}
            {glbMeasuredLabel(lastIntake) ? (
              <p>GLB measured dimensions {glbMeasuredLabel(lastIntake)}</p>
            ) : null}
          </div>
        ) : null}
        {lastIntake?.status === "validated" ? (
          intakeUsesGlbDimensions(lastIntake) ? (
            <div className="space-y-1 text-xs text-emerald-300">
              <p className="font-medium">Using GLB dimensions</p>
              {glbMeasuredLabel(lastIntake) ? (
                <p className="text-slate-300">GLB measured: {glbMeasuredLabel(lastIntake)}</p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-1 text-xs text-emerald-300">
              <p className="font-medium">Scale verified</p>
              {productDimensionsLabel(lastIntake) ? (
                <p className="text-slate-300">Product dimensions: {productDimensionsLabel(lastIntake)}</p>
              ) : null}
              {glbMeasuredLabel(lastIntake) ? (
                <p className="text-slate-300">GLB measured: {glbMeasuredLabel(lastIntake)}</p>
              ) : null}
            </div>
          )
        ) : null}
      </section>

      <section className="space-y-3">
        <h3 className="font-medium">Intake history</h3>
        {loadError ? <p className="text-xs text-rose-300">{loadError}</p> : null}
        {intakes.length === 0 && !loadError ? (
          <p className="text-sm text-slate-500">No GLB intakes yet.</p>
        ) : (
          <ul className="space-y-3">
            {intakes.map((intake) => (
              <li key={intake.intakeId} className="rounded-xl border border-slate-800 p-4 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">{intake.originalFileName}</p>
                  <p className={
                    intake.status === "failed"
                      ? "text-rose-300"
                      : intake.assetId || intake.status === "validated"
                        ? "text-emerald-300"
                        : "text-slate-400"
                  }>
                    {statusLabel(intake)}
                  </p>
                </div>
                {intake.status === "validated" && !intake.assetId ? (
                  <p className="mt-1 text-xs text-slate-400">GLB intake passed validation.</p>
                ) : null}
                {intake.assetId ? (
                  <div className="mt-2 space-y-1 text-xs text-slate-400">
                    <p>Immutable Vibode Asset created. Runtime activation is still pending.</p>
                    <p className="break-all font-mono text-[11px] text-slate-500">Asset ID {intake.assetId}</p>
                    <p>status = unavailable / not runtime-ready yet</p>
                  </div>
                ) : null}
                <p className="mt-1 text-xs text-slate-400">
                  {intakeUsesGlbDimensions(intake)
                    ? `GLB dimensions used${glbMeasuredLabel(intake) ? `: ${glbMeasuredLabel(intake)}` : ""}`
                    : `Product: ${productDimensionsLabel(intake) ?? "—"}${
                        glbMeasuredLabel(intake)
                          ? ` · GLB measured: ${glbMeasuredLabel(intake)}`
                          : ""
                      }`}
                </p>
                {intake.sha256 ? (
                  <p className="mt-1 break-all font-mono text-[11px] text-slate-500">
                    SHA {formatSha256Prefix(intake.sha256)}
                  </p>
                ) : null}
                {intake.status === "validated" && !intake.assetId ? (
                  <button
                    type="button"
                    disabled={busy}
                    className="mt-3 rounded-md border border-slate-700 px-3 py-1.5 text-sm"
                    onClick={() => void onRegister(intake.intakeId)}
                  >
                    {registeringId === intake.intakeId ? "Registering…" : "Register Asset"}
                  </button>
                ) : null}
                {intake.warnings.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-xs text-amber-200">
                    {intake.warnings.map((warning) => (
                      <li key={`${warning.code}:${warning.message}`}>{warning.message}</li>
                    ))}
                  </ul>
                ) : null}
                {intake.error ? <p className="mt-2 text-xs text-rose-300">{intake.error}</p> : null}
                {intake.errorCode ? (
                  <p className="mt-1 font-mono text-[11px] text-rose-400">{intake.errorCode}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {registeredAssets.some((asset) => asset.origin === "catalog_linked") ? (
        <section className="space-y-3">
          <h3 className="font-medium">Catalog-linked Assets</h3>
          <p className="text-xs text-slate-500">
            Existing Partner catalog Assets. These are not Portal GLB intakes.
          </p>
          <ul className="space-y-3">
            {registeredAssets.filter((asset) => asset.origin === "catalog_linked").map((asset) => (
              <li key={asset.assetId} className="rounded-xl border border-slate-800 p-4 text-sm">
                <p className="break-all font-mono text-xs text-slate-300">{asset.assetId}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {formatPartnerIntakeMetresTriple(
                    asset.measuredWidthM,
                    asset.measuredHeightM,
                    asset.measuredDepthM,
                  )}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
