/**
 * Partner-facing inline GLB upload.
 *
 * Reuses the existing Partner asset routes in order:
 * intake → signed upload → finalize → register → activate.
 * Only a ready asset is returned for Variant association.
 * Failed or incomplete uploads are not assignable.
 * This module does not delete assets or retarget published Variants.
 */

import { modelSizeFromMeasured } from "./model-dimensions";
import { putPartnerGlbToSignedUrl } from "./partner-glb-signed-upload";

export const PARTNER_INLINE_GLB_EMPTY_TITLE = "No 3D model yet.";
export const PARTNER_INLINE_GLB_EMPTY_DETAIL =
  "Upload a GLB so customers can place this Variant in their room.";
export const PARTNER_INLINE_GLB_UPLOAD = "Upload GLB";
export const PARTNER_INLINE_GLB_REPLACE = "Replace model";
export const PARTNER_INLINE_GLB_CHOOSE = "Choose existing model";
export const PARTNER_INLINE_GLB_PROCESSING = "Preparing 3D model…";
export const PARTNER_INLINE_GLB_READY = "Ready";
export const PARTNER_INLINE_GLB_ATTENTION = "Needs attention";
export const PARTNER_INLINE_GLB_RETRY = "Try again";
export const PARTNER_INLINE_GLB_RELOAD = "Reload product";
export const PARTNER_INLINE_GLB_UNSUPPORTED = "Choose a .glb file.";
export const PARTNER_INLINE_GLB_UPLOAD_FAILED = "The file could not be uploaded.";
export const PARTNER_INLINE_GLB_VALIDATE_FAILED = "The GLB could not be validated.";
export const PARTNER_INLINE_GLB_PREPARE_FAILED = "The 3D model could not be prepared for Vibode.";
export const PARTNER_MODEL_UPLOADED_RELOAD =
  "The 3D model was uploaded, but this page needs to reload before it can be attached.";
export const PARTNER_MODEL_UPLOADED_NOT_ATTACHED =
  "The 3D model was uploaded, but it could not be attached. Reload this product and choose it from existing models.";

export const PARTNER_INLINE_GLB_INTAKE_ROUTE = "/api/vibode/partner/assets/intakes";

export function partnerInlineGlbFinalizeRoute(intakeId: string): string {
  return `/api/vibode/partner/assets/intakes/${intakeId}/finalize`;
}

export function partnerInlineGlbRegisterRoute(intakeId: string): string {
  return `/api/vibode/partner/assets/intakes/${intakeId}/register`;
}

export function partnerInlineGlbActivateRoute(assetId: string): string {
  return `/api/vibode/partner/assets/${assetId}/activate`;
}

export type PartnerInlineGlbView =
  | Readonly<{ phase: "idle" }>
  | Readonly<{ phase: "uploading"; fileName: string }>
  | Readonly<{ phase: "processing"; fileName: string }>
  | Readonly<{ phase: "ready"; fileName: string }>
  | Readonly<{
    phase: "attention";
    fileName: string | null;
    message: string;
    technical: string | null;
    reload: boolean;
  }>;

export type PartnerInlineGlbReadyAsset = Readonly<{
  assetId: string;
  originalFileName: string;
  status: "ready";
  measuredWidthM?: number;
  measuredHeightM?: number;
  measuredDepthM?: number;
}>;

export type PartnerInlineGlbFailureStage =
  | "unsupported"
  | "intake"
  | "upload"
  | "finalize"
  | "register"
  | "activate"
  | "cancelled";

export type PartnerInlineGlbResult =
  | Readonly<{ ok: true; asset: PartnerInlineGlbReadyAsset }>
  | Readonly<{
    ok: false;
    stage: PartnerInlineGlbFailureStage;
    message: string;
    technical: string | null;
  }>;

export type PartnerInlineGlbJson = Readonly<{
  ok?: boolean;
  error?: string;
  errorCode?: string;
  intakeId?: string;
  signedUrl?: string;
  intake?: Readonly<{
    status?: string;
    error?: string | null;
    errorCode?: string | null;
    originalFileName?: string;
    assetId?: string | null;
  }>;
  asset?: Readonly<{
    assetId?: string;
    status?: string;
    originalFileName?: string | null;
    measuredWidthM?: number;
    measuredHeightM?: number;
    measuredDepthM?: number;
  }>;
}>;

export type PartnerInlineGlbTransport = Readonly<{
  createIntake: (body: Readonly<{
    originalFileName: string;
    byteSize: number;
    dimensionSource: "glb";
  }>) => Promise<Readonly<{ status: number; body: PartnerInlineGlbJson }>>;
  upload: (
    signedUrl: string,
    file: Readonly<{ name: string; size: number }>,
  ) => Promise<Readonly<{ ok: boolean; error?: string }>>;
  finalize: (intakeId: string) => Promise<Readonly<{ status: number; body: PartnerInlineGlbJson }>>;
  register: (intakeId: string) => Promise<Readonly<{ status: number; body: PartnerInlineGlbJson }>>;
  activate: (assetId: string) => Promise<Readonly<{ status: number; body: PartnerInlineGlbJson }>>;
}>;

const GLB_NAME = /^[A-Za-z0-9._ -]+\.glb$/i;

export function partnerInlineGlbBaseName(fileName: string): string | null {
  const base = fileName.trim().split(/[/\\]/).pop() ?? "";
  if (!GLB_NAME.test(base) || base.toLowerCase() === ".glb") return null;
  return base;
}

export function partnerInlineGlbUploadingLabel(fileName: string): string {
  return `Uploading ${fileName}…`;
}

export function partnerInlineGlbFailureMessage(
  stage: Exclude<PartnerInlineGlbFailureStage, "cancelled">,
  errorCode: string | null,
): string {
  if (stage === "unsupported" || errorCode === "INVALID_FILENAME") return PARTNER_INLINE_GLB_UNSUPPORTED;
  if (stage === "intake" || stage === "upload") {
    if (errorCode === "FILE_TOO_LARGE") return "The GLB must be 50 MiB or smaller.";
    return PARTNER_INLINE_GLB_UPLOAD_FAILED;
  }
  if (stage === "finalize") return PARTNER_INLINE_GLB_VALIDATE_FAILED;
  return PARTNER_INLINE_GLB_PREPARE_FAILED;
}

export function partnerInlineGlbModelStatusLabel(
  savedLabel: string,
  view: PartnerInlineGlbView,
): string {
  if (view.phase === "uploading") return "Uploading";
  if (view.phase === "processing") return "Processing";
  if (view.phase === "attention") return PARTNER_INLINE_GLB_ATTENTION;
  if (view.phase === "ready") return PARTNER_INLINE_GLB_READY;
  return savedLabel;
}

export function createPartnerInlineUploadSession() {
  let token = 0;
  let busy = false;
  return {
    tryStart(): number | null {
      if (busy) return null;
      busy = true;
      token += 1;
      return token;
    },
    finish(started: number) {
      if (token === started) busy = false;
    },
    invalidate() {
      token += 1;
      busy = false;
    },
    isCurrent(started: number) {
      return token === started;
    },
  };
}

export function partnerUploadedModelAssociationFailure(input: Readonly<{
  uploadReady: boolean;
  httpStatus: number;
}>): Readonly<{
  message: string;
  reload: true;
  assetRemainsRegistered: true;
  deleteAsset: false;
}> | null {
  if (!input.uploadReady || input.httpStatus !== 409) return null;
  return {
    message: PARTNER_MODEL_UPLOADED_RELOAD,
    reload: true,
    assetRemainsRegistered: true,
    deleteAsset: false,
  };
}

function failure(
  stage: Exclude<PartnerInlineGlbFailureStage, "cancelled">,
  errorCode: string | null,
  error: string | null,
): PartnerInlineGlbResult {
  const technical = errorCode?.trim() || null;
  if (technical || error) {
    console.error("[partner-inline-glb]", stage, technical ?? error);
  }
  return {
    ok: false,
    stage,
    message: partnerInlineGlbFailureMessage(stage, technical),
    technical,
  };
}

function cancelled(): PartnerInlineGlbResult {
  return { ok: false, stage: "cancelled", message: "", technical: null };
}

function httpOk(status: number, body: PartnerInlineGlbJson): boolean {
  return status >= 200 && status < 300 && body.ok !== false;
}

export async function runPartnerInlineGlbUpload(input: Readonly<{
  file: Readonly<{ name: string; size: number }>;
  transport: PartnerInlineGlbTransport;
  onPhase?: (phase: "uploading" | "processing", fileName: string) => void;
  isCurrent?: () => boolean;
}>): Promise<PartnerInlineGlbResult> {
  const fileName = partnerInlineGlbBaseName(input.file.name);
  if (!fileName) return failure("unsupported", "INVALID_FILENAME", null);
  const current = input.isCurrent ?? (() => true);
  if (!current()) return cancelled();

  input.onPhase?.("uploading", fileName);
  let created: Readonly<{ status: number; body: PartnerInlineGlbJson }>;
  try {
    created = await input.transport.createIntake({
      originalFileName: fileName,
      byteSize: input.file.size,
      dimensionSource: "glb",
    });
  } catch (error) {
    return failure("intake", null, error instanceof Error ? error.message : null);
  }
  if (!current()) return cancelled();
  const intakeId = created.body.intakeId?.trim() || "";
  const signedUrl = created.body.signedUrl?.trim() || "";
  if (!httpOk(created.status, created.body) || !intakeId || !signedUrl) {
    return failure("intake", created.body.errorCode ?? created.body.intake?.errorCode ?? null, created.body.error ?? null);
  }

  let uploaded: Readonly<{ ok: boolean; error?: string }>;
  try {
    uploaded = await input.transport.upload(signedUrl, { name: fileName, size: input.file.size });
  } catch (error) {
    return failure("upload", null, error instanceof Error ? error.message : null);
  }
  if (!current()) return cancelled();
  if (!uploaded.ok) return failure("upload", null, uploaded.error ?? null);

  input.onPhase?.("processing", fileName);
  let finalized: Readonly<{ status: number; body: PartnerInlineGlbJson }>;
  try {
    finalized = await input.transport.finalize(intakeId);
  } catch (error) {
    return failure("finalize", null, error instanceof Error ? error.message : null);
  }
  if (!current()) return cancelled();
  const intakeStatus = finalized.body.intake?.status ?? "";
  if (!httpOk(finalized.status, finalized.body) || intakeStatus !== "validated") {
    return failure(
      "finalize",
      finalized.body.errorCode ?? finalized.body.intake?.errorCode ?? null,
      finalized.body.error ?? finalized.body.intake?.error ?? null,
    );
  }

  let registered: Readonly<{ status: number; body: PartnerInlineGlbJson }>;
  try {
    registered = await input.transport.register(intakeId);
  } catch (error) {
    return failure("register", null, error instanceof Error ? error.message : null);
  }
  if (!current()) return cancelled();
  const assetId = registered.body.asset?.assetId?.trim() || "";
  if (!httpOk(registered.status, registered.body) || !assetId) {
    return failure("register", registered.body.errorCode ?? null, registered.body.error ?? null);
  }
  const registeredName = registered.body.asset?.originalFileName?.trim() || fileName;
  const measured = modelSizeFromMeasured(registered.body.asset
    ? {
      widthM: registered.body.asset.measuredWidthM,
      heightM: registered.body.asset.measuredHeightM,
      depthM: registered.body.asset.measuredDepthM,
    }
    : null);

  let activated: Readonly<{ status: number; body: PartnerInlineGlbJson }>;
  try {
    activated = await input.transport.activate(assetId);
  } catch (error) {
    return failure("activate", null, error instanceof Error ? error.message : null);
  }
  if (!current()) return cancelled();
  const readyId = activated.body.asset?.assetId?.trim() || assetId;
  if (!httpOk(activated.status, activated.body) || activated.body.asset?.status !== "ready" || !readyId) {
    return failure("activate", activated.body.errorCode ?? null, activated.body.error ?? null);
  }
  if (!current()) return cancelled();
  return {
    ok: true,
    asset: {
      assetId: readyId,
      originalFileName: registeredName,
      status: "ready",
      ...(measured
        ? {
          measuredWidthM: measured.widthM,
          measuredHeightM: measured.heightM,
          measuredDepthM: measured.depthM,
        }
        : {}),
    },
  };
}

async function readPartnerJson(response: Response): Promise<PartnerInlineGlbJson> {
  try {
    const value: unknown = await response.json();
    if (!value || typeof value !== "object") return {};
    return value as PartnerInlineGlbJson;
  } catch {
    return {};
  }
}

export function createBrowserPartnerInlineGlbTransport(file: File): PartnerInlineGlbTransport {
  return {
    async createIntake(body) {
      const response = await fetch(PARTNER_INLINE_GLB_INTAKE_ROUTE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await readPartnerJson(response) };
    },
    async upload(signedUrl) {
      try {
        await putPartnerGlbToSignedUrl(signedUrl, file);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Upload failed." };
      }
    },
    async finalize(intakeId) {
      const response = await fetch(partnerInlineGlbFinalizeRoute(intakeId), { method: "POST" });
      return { status: response.status, body: await readPartnerJson(response) };
    },
    async register(intakeId) {
      const response = await fetch(partnerInlineGlbRegisterRoute(intakeId), { method: "POST" });
      return { status: response.status, body: await readPartnerJson(response) };
    },
    async activate(assetId) {
      const response = await fetch(partnerInlineGlbActivateRoute(assetId), { method: "POST" });
      return { status: response.status, body: await readPartnerJson(response) };
    },
  };
}
