/**
 * Generation workflow. It does not read provider credentials and it does
 * not expose a route. Generate stays disconnected.
 * Image bytes are stored under the owner's prefix and sent to the adapter
 * only after a submit claim. A timed-out create is reconciled from the
 * task list before any second POST.
 */

import { createHash } from "node:crypto";

import {
  emptyFurniturePhotoSet,
  setFurniturePhoto,
  type FurniturePhotoRecord,
  type FurnitureViewSlot,
} from "@/lib/vibode-furniture/generator/images";
import { mapMeshyGenerationDraft } from "@/lib/vibode-furniture/generator/request";
import {
  generatorSettingsIssues,
  type FurnitureGeneratorSettings,
} from "@/lib/vibode-furniture/generator/settings";
import type { PersonalGlbValidator } from "@/lib/vibode-furniture/store";

import { estimateMeshy71Credits } from "./credits";
import {
  applyGenerationObservation,
  attachGenerationInput,
  bindGenerationTask,
  candidatePreviewOffer,
  claimGeneration,
  discardGenerationCandidate,
  dropGenerationClaim,
  expireGenerationCandidate,
  failGenerationBeforeProvider,
  failGenerationCreate,
  failGenerationOutput,
  generationInputsFor,
  authorizeGenerationResubmit,
  markGenerationAmbiguous,
  markGenerationNeedsReview,
  readGeneration,
  recordGenerationOutput,
  reserveGeneration,
  settleGenerationRateLimit,
  type GenerationDatabase,
  type GenerationJob,
  type MutationResult,
} from "./engine";
import { imageExtension, inspectFurnitureImage, type InspectedFurnitureImage } from "./images";
import { betaFrontPhotoBytesAllowed } from "./transport";
import type { MeshyAdapter } from "./meshy-adapter";
import { matchListedMeshyTask, normalizeMeshyTaskFailure } from "./meshy-task";
import { generationAccessDecision } from "./policy";
import { buildMeshyCreateRequest, type MeshyCreateRequest } from "./payload";
import {
  candidateBucket,
  generationCandidatePath,
  generationInputPath,
  intakeProviderGlb,
  pathOwnedBy,
  type GenerationDownloader,
} from "./output";
export type GenerationObjectStore = {
  put(path: string, bytes: Uint8Array): Promise<void>;
  get(path: string): Promise<Uint8Array | null>;
  remove(path: string): Promise<void>;
  sign(path: string, ownerUserId: string): string | null;
};

export function createMemoryObjectStore(): GenerationObjectStore {
  const objects = new Map<string, Uint8Array>();
  return {
    async put(path, bytes) {
      objects.set(path, Uint8Array.from(bytes));
    },
    async get(path) {
      const found = objects.get(path);
      return found ? Uint8Array.from(found) : null;
    },
    async remove(path) {
      objects.delete(path);
    },
    sign(path, ownerUserId) {
      if (!pathOwnedBy(path, ownerUserId) || !objects.has(path)) return null;
      return `signed://vibode-private/${path}`;
    },
  };
}

export type GenerationWorkflowFailure = {
  ok: false;
  errorClass: "unauthorized" | "disabled" | "unsupported_settings" | "invalid_input" | "quota_exhausted" | "concurrency_limited" | "idempotency_conflict" | "not_found" | "lease_held" | "not_claimable" | "needs_reconciliation" | "task_immutable" | "provider_rejected" | "provider_payment" | "provider_auth" | "provider_forbidden" | "rate_limited" | "ambiguous_timeout" | "provider_failed" | "invalid_output" | "oversized_output" | "ingest_failed" | "input_storage_failed" | "credit_unreported";
  message: string;
  retryAfterMs?: number;
};

export async function createFurnitureGeneration(input: {
  db: GenerationDatabase;
  objects: GenerationObjectStore;
  actor: { userId: string | null; email: string | null };
  generationEnabledEnv: string | undefined;
  isAdmin?: (email: string | null | undefined) => boolean;
  idempotencyKey: string;
  jobId: string;
  settings: FurnitureGeneratorSettings;
  images: readonly { slot: FurnitureViewSlot; bytes: Uint8Array }[];
  nowMs: number;
}): Promise<{ ok: true; created: boolean; job: GenerationJob } | GenerationWorkflowFailure> {
  const access = generationAccessDecision({
    userId: input.actor.userId,
    email: input.actor.email,
    generationEnabledEnv: input.generationEnabledEnv,
    liveEnabled: input.db.controls.liveEnabled,
    isAdmin: input.isAdmin,
  });
  if (access !== "ok" || !input.actor.userId) {
    return { ok: false, errorClass: access === "disabled" ? "disabled" : "unauthorized", message: "Generation is not available." };
  }
  const inspected: InspectedFurnitureImage[] = [];
  const seen = new Set<FurnitureViewSlot>();
  for (const image of input.images) {
    if (seen.has(image.slot)) {
      return { ok: false, errorClass: "invalid_input", message: "Each photo angle can be used once." };
    }
    seen.add(image.slot);
    const result = await inspectFurnitureImage(image);
    if (!result.ok) return { ok: false, errorClass: "invalid_input", message: result.message };
    inspected.push(result.image);
  }
  const photos = emptyFurniturePhotoSet();
  let photoSet = photos;
  for (const image of inspected) {
    photoSet = setFurniturePhoto(photoSet, photoRecord(image));
  }
  const settingsIssue = generatorSettingsIssues(input.settings, inspected.length > 1 ? "multi" : "single")[0];
  if (settingsIssue) {
    return { ok: false, errorClass: "unsupported_settings", message: settingsIssue.message };
  }
  const draft = mapMeshyGenerationDraft({ photos: photoSet, settings: input.settings });
  if (!draft.ok) {
    return { ok: false, errorClass: "invalid_input", message: draft.errors[0] ?? "The photos could not be used." };
  }
  const credits = estimateMeshy71Credits(input.settings, draft.draft.operation);
  if (credits == null) {
    return { ok: false, errorClass: "unsupported_settings", message: "Those settings are not available." };
  }
  if (inspected.some((image) => !betaFrontPhotoBytesAllowed(image.byteLength))) {
    return { ok: false, errorClass: "invalid_input", message: "The photo is too large to send." };
  }
  const reserved = reserveGeneration(input.db, {
    userId: input.actor.userId,
    jobId: input.jobId,
    idempotencyKey: input.idempotencyKey,
    requestSha256: generationRequestSha256({
      operation: draft.draft.operation,
      settings: input.settings,
      images: inspected.map((image) => ({ slot: image.slot, sha256: image.sha256 })),
    }),
    operation: draft.draft.operation,
    settings: input.settings,
    imageSlots: draft.draft.imageSlots,
    reservedCredits: credits,
    nowMs: input.nowMs,
  });
  if (!reserved.ok) {
    return { ok: false, errorClass: reserved.code, message: reserveMessage(reserved.code) };
  }
  if (!reserved.created) return { ok: true, created: false, job: reserved.job };
  try {
    for (const image of inspected) {
      const path = generationInputPath(input.actor.userId, reserved.job.jobId, image.slot, imageExtension(image.mimeType));
      await input.objects.put(path, image.bytes);
      const attached = attachGenerationInput(input.db, {
        userId: input.actor.userId,
        jobId: reserved.job.jobId,
        slot: image.slot,
        mimeType: image.mimeType,
        byteSize: image.byteLength,
        widthPx: image.widthPx,
        heightPx: image.heightPx,
        sha256: image.sha256,
        nowMs: input.nowMs,
      });
      if (!attached.ok) throw new Error("attach_failed");
    }
  } catch {
    for (const image of inspected) {
      const path = generationInputPath(input.actor.userId, reserved.job.jobId, image.slot, imageExtension(image.mimeType));
      await input.objects.remove(path);
    }
    failGenerationBeforeProvider(input.db, {
      userId: input.actor.userId,
      jobId: reserved.job.jobId,
      nowMs: input.nowMs,
    });
    return { ok: false, errorClass: "input_storage_failed", message: "The photos could not be stored." };
  }
  return { ok: true, created: true, job: reserved.job };
}

export async function submitFurnitureGeneration(input: {
  db: GenerationDatabase;
  objects: GenerationObjectStore;
  adapter: MeshyAdapter;
  actorUserId: string;
  jobId: string;
  nowMs: number;
}): Promise<
  | { ok: true; action: "submitted" | "poll" | "reconcile" | "rate_limited"; job: GenerationJob; retryAfterMs?: number }
  | GenerationWorkflowFailure
> {
  const job = readGeneration(input.db, input.actorUserId, input.jobId);
  if (!job) return { ok: false, errorClass: "not_found", message: "That generation could not be found." };
  if (job.status !== "reserved") {
    const claim = claimGeneration(input.db, {
      userId: input.actorUserId,
      jobId: input.jobId,
      nowMs: input.nowMs,
      intent: "submit",
    });
    if (!claim.ok) return { ok: false, errorClass: claim.code, message: "That generation cannot be submitted." };
    if (claim.purpose === "submit") {
      return { ok: false, errorClass: "not_claimable", message: "That generation cannot be submitted." };
    }
    const held = claim.job.claimNonce;
    if (held) {
      dropGenerationClaim(input.db, {
        userId: input.actorUserId,
        jobId: input.jobId,
        claimNonce: held,
        nowMs: input.nowMs,
      });
    }
    return { ok: true, action: claim.purpose, job: readGeneration(input.db, input.actorUserId, input.jobId) ?? claim.job };
  }
  const prepared = await prepareCreate(input.db, input.objects, job);
  if (!prepared.ok) return prepared;
  const claim = claimGeneration(input.db, {
    userId: input.actorUserId,
    jobId: input.jobId,
    nowMs: input.nowMs,
    intent: "submit",
  });
  if (!claim.ok) return { ok: false, errorClass: claim.code, message: "That generation cannot be submitted." };
  if (claim.purpose !== "submit") {
    return { ok: true, action: claim.purpose, job: claim.job };
  }
  const nonce = claim.job.claimNonce;
  if (!nonce) return { ok: false, errorClass: "not_claimable", message: "That generation cannot be submitted." };
  const outcome = await input.adapter.createTask(prepared.request);
  if (outcome.kind === "created") {
    const bound = bindGenerationTask(input.db, {
      userId: input.actorUserId,
      jobId: input.jobId,
      claimNonce: nonce,
      nowMs: input.nowMs,
      providerTaskId: outcome.taskId,
      providerStatus: "PENDING",
    });
    if (!bound.ok) return { ok: false, errorClass: bound.code, message: "The provider task could not be recorded." };
    return { ok: true, action: "submitted", job: bound.job };
  }
  if (outcome.kind === "ambiguous") {
    const marked = markGenerationAmbiguous(input.db, {
      userId: input.actorUserId,
      jobId: input.jobId,
      claimNonce: nonce,
      nowMs: input.nowMs,
      errorCode: outcome.errorCode,
    });
    if (!marked.ok) return { ok: false, errorClass: marked.code, message: outcome.message };
    return { ok: false, errorClass: "ambiguous_timeout", message: outcome.message };
  }
  if (outcome.errorClass === "rate_limited") {
    // HTTP 429 closes this POST. It does not return the job to reserved.
    const settled = settleGenerationRateLimit(input.db, {
      userId: input.actorUserId,
      jobId: input.jobId,
      claimNonce: nonce,
      nowMs: input.nowMs,
    });
    if (!settled.ok) return { ok: false, errorClass: settled.code, message: outcome.message };
    return { ok: true, action: "rate_limited", job: settled.job, retryAfterMs: outcome.retryAfterMs ?? undefined };
  }
  const failed = failGenerationCreate(input.db, {
    userId: input.actorUserId,
    jobId: input.jobId,
    claimNonce: nonce,
    nowMs: input.nowMs,
    errorClass: outcome.errorClass,
    errorCode: outcome.errorCode,
  });
  if (!failed.ok) return { ok: false, errorClass: failed.code, message: outcome.message };
  return { ok: false, errorClass: outcome.errorClass, message: outcome.message };
}

export async function advanceFurnitureGeneration(input: {
  db: GenerationDatabase;
  objects: GenerationObjectStore;
  adapter: MeshyAdapter;
  download: GenerationDownloader;
  validate: PersonalGlbValidator;
  actorUserId: string;
  jobId: string;
  nowMs: number;
}): Promise<{ ok: true; action: "reconciled" | "running" | "ready" | "failed" | "waiting" | "needs_review"; job: GenerationJob } | GenerationWorkflowFailure> {
  const claim = claimGeneration(input.db, {
    userId: input.actorUserId,
    jobId: input.jobId,
    nowMs: input.nowMs,
    intent: "follow",
  });
  if (!claim.ok) return { ok: false, errorClass: claim.code, message: "That generation cannot be continued." };
  const nonce = claim.job.claimNonce;
  if (!nonce) return { ok: false, errorClass: "not_claimable", message: "That generation cannot be continued." };
  if (claim.purpose === "reconcile") {
    return reconcile(input, claim.job, nonce);
  }
  const taskId = claim.job.providerTaskId;
  if (!taskId) return { ok: false, errorClass: "not_claimable", message: "That generation cannot be continued." };
  const read = await input.adapter.getTask(claim.job.operation, taskId);
  if (read.kind === "retry") {
    return { ok: true, action: "waiting", job: claim.job };
  }
  if (read.kind === "missing") {
    return { ok: true, action: "waiting", job: claim.job };
  }
  const failure = read.task.status === "FAILED" || read.task.status === "CANCELED"
    ? normalizeMeshyTaskFailure(read.task)
    : null;
  const applied = applyGenerationObservation(input.db, {
    userId: input.actorUserId,
    jobId: input.jobId,
    claimNonce: nonce,
    nowMs: input.nowMs,
    providerStatus: read.task.status,
    progress: read.task.progress,
    consumedCredits: read.task.consumedCredits,
    errorCode: failure?.errorCode ?? null,
  });
  if (!applied.ok) return { ok: false, errorClass: applied.code, message: "The provider status could not be recorded." };
  if (applied.job.status === "failed") return { ok: true, action: "failed", job: applied.job };
  if (applied.job.errorClass === "credit_unreported") {
    return { ok: false, errorClass: "credit_unreported", message: "Meshy did not report the credits used." };
  }
  if (applied.job.status !== "ingesting") return { ok: true, action: "running", job: applied.job };
  if (!read.task.glbUrl) {
    const failedOutput = failGenerationOutput(input.db, {
      userId: input.actorUserId,
      jobId: input.jobId,
      claimNonce: nonce,
      nowMs: input.nowMs,
      errorClass: "invalid_output",
    });
    if (!failedOutput.ok) return { ok: false, errorClass: failedOutput.code, message: "The generated model could not be stored." };
    return { ok: false, errorClass: "invalid_output", message: "The generated model link cannot be used." };
  }
  const intake = await intakeProviderGlb({
    url: read.task.glbUrl,
    nowMs: input.nowMs,
    expiresAtMs: read.task.expiresAtMs,
    assetId: `vibode-furniture/generation/${input.jobId}`,
    download: input.download,
    validate: input.validate,
  });
  if (!intake.ok) {
    failGenerationOutput(input.db, {
      userId: input.actorUserId,
      jobId: input.jobId,
      claimNonce: nonce,
      nowMs: input.nowMs,
      errorClass: intake.errorClass,
    });
    return intake;
  }
  const path = generationCandidatePath(input.actorUserId, input.jobId);
  await input.objects.put(path, intake.bytes);
  const recorded = recordGenerationOutput(input.db, {
    userId: input.actorUserId,
    jobId: input.jobId,
    claimNonce: nonce,
    nowMs: input.nowMs,
    byteSize: intake.bytes.byteLength,
    sha256: createHash("sha256").update(intake.bytes).digest("hex"),
  });
  if (!recorded.ok) {
    await input.objects.remove(path);
    return { ok: false, errorClass: recorded.code, message: "The generated model could not be stored." };
  }
  if (recorded.job.outputBucket !== candidateBucket() || recorded.job.savedAssetId !== null) {
    return { ok: false, errorClass: "ingest_failed", message: "The generated model could not be stored." };
  }
  return { ok: true, action: "ready", job: recorded.job };
}

export function authorizeFurnitureGenerationResubmit(input: {
  db: GenerationDatabase;
  actorUserId: string;
  jobId: string;
  nowMs: number;
  duplicateChargeRiskAccepted: boolean;
}): MutationResult {
  const authorized = authorizeGenerationResubmit(input.db, {
    userId: input.actorUserId,
    jobId: input.jobId,
    nowMs: input.nowMs,
    duplicateChargeRiskAccepted: input.duplicateChargeRiskAccepted,
  });
  return authorized;
}

export function discardFurnitureGeneration(input: {
  db: GenerationDatabase;
  actorUserId: string;
  jobId: string;
  nowMs: number;
}) {
  return discardGenerationCandidate(input.db, {
    userId: input.actorUserId,
    jobId: input.jobId,
    nowMs: input.nowMs,
  });
}

export function expireFurnitureGeneration(input: {
  db: GenerationDatabase;
  actorUserId: string;
  jobId: string;
  nowMs: number;
}) {
  return expireGenerationCandidate(input.db, {
    userId: input.actorUserId,
    jobId: input.jobId,
    nowMs: input.nowMs,
  });
}

export function offerGenerationPreview(input: {
  db: GenerationDatabase;
  objects: GenerationObjectStore;
  actorUserId: string;
  jobId: string;
}) {
  return candidatePreviewOffer(input.db, {
    actorUserId: input.actorUserId,
    jobId: input.jobId,
    sign: (path, ownerUserId) => input.objects.sign(path, ownerUserId),
  });
}

export function generationRequestSha256(input: {
  operation: string;
  settings: FurnitureGeneratorSettings;
  images: readonly { slot: string; sha256: string }[];
}): string {
  const body = JSON.stringify({
    operation: input.operation,
    settings: {
      geometryResolution: input.settings.geometryResolution,
      shouldTexture: input.settings.shouldTexture,
      textureModel: input.settings.textureModel,
      textureResolution: input.settings.textureResolution,
      enablePbr: input.settings.enablePbr,
      texturePrompt: input.settings.texturePrompt.trim(),
      imageEnhancement: input.settings.imageEnhancement,
      shouldRemesh: input.settings.shouldRemesh,
      topology: input.settings.topology,
      targetPolycount: input.settings.targetPolycount,
    },
    images: input.images.map((image) => ({ slot: image.slot, sha256: image.sha256 })),
  });
  return createHash("sha256").update(body).digest("hex");
}

async function prepareCreate(
  db: GenerationDatabase,
  objects: GenerationObjectStore,
  job: GenerationJob,
): Promise<{ ok: true; request: MeshyCreateRequest } | GenerationWorkflowFailure> {
  const inputs = generationInputsFor(db, job.userId, job.jobId);
  const images: InspectedFurnitureImage[] = [];
  for (const record of inputs) {
    if (!pathOwnedBy(record.storageObjectPath, job.userId)) {
      return { ok: false, errorClass: "invalid_input", message: "The photos could not be read." };
    }
    const bytes = await objects.get(record.storageObjectPath);
    if (!bytes) return { ok: false, errorClass: "invalid_input", message: "The photos could not be read." };
    const inspected = await inspectFurnitureImage({ slot: record.slot, bytes });
    if (!inspected.ok || inspected.image.sha256 !== record.sha256) {
      return { ok: false, errorClass: "invalid_input", message: "The photos could not be read." };
    }
    images.push(inspected.image);
  }
  let photoSet = emptyFurniturePhotoSet();
  for (const image of images) photoSet = setFurniturePhoto(photoSet, photoRecord(image));
  const draft = mapMeshyGenerationDraft({ photos: photoSet, settings: job.settings });
  if (!draft.ok) return { ok: false, errorClass: "unsupported_settings", message: draft.errors[0] ?? "Those settings are not available." };
  const request = buildMeshyCreateRequest({ draft: draft.draft, images, taskName: job.providerTaskName });
  if (!request.ok) return { ok: false, errorClass: "unsupported_settings", message: request.message };
  return { ok: true, request: request.request };
}

async function reconcile(
  input: {
    db: GenerationDatabase;
    adapter: MeshyAdapter;
    actorUserId: string;
    jobId: string;
    nowMs: number;
  },
  job: GenerationJob,
  nonce: string,
): Promise<{ ok: true; action: "reconciled" | "waiting" | "needs_review"; job: GenerationJob } | GenerationWorkflowFailure> {
  const page = await input.adapter.listRecentTasks(job.operation);
  if (page.kind !== "page") {
    dropGenerationClaim(input.db, {
      userId: input.actorUserId,
      jobId: input.jobId,
      claimNonce: nonce,
      nowMs: input.nowMs,
    });
    return { ok: true, action: "waiting", job: readGeneration(input.db, input.actorUserId, input.jobId) ?? job };
  }
  const match = matchListedMeshyTask({
    tasks: page.tasks,
    taskName: job.providerTaskName,
    contactedAtMs: job.providerContactedAtMs ?? input.nowMs,
    pageFull: page.pageFull,
  });
  if (match.kind === "unique") {
    const bound = bindGenerationTask(input.db, {
      userId: input.actorUserId,
      jobId: input.jobId,
      claimNonce: nonce,
      nowMs: input.nowMs,
      providerTaskId: match.task.id,
      providerStatus: match.task.status,
    });
    if (!bound.ok) return { ok: false, errorClass: bound.code, message: "The provider task could not be recorded." };
    return { ok: true, action: "reconciled", job: bound.job };
  }
  if (match.kind === "absent" || match.kind === "incomplete" || match.kind === "conflict") {
    const marked = markGenerationNeedsReview(input.db, {
      userId: input.actorUserId,
      jobId: input.jobId,
      claimNonce: nonce,
      nowMs: input.nowMs,
      reason: match.kind === "absent" ? "list_absent" : "list_incomplete",
    });
    if (!marked.ok) {
      return { ok: true, action: "waiting", job: readGeneration(input.db, input.actorUserId, input.jobId) ?? job };
    }
    return { ok: true, action: "needs_review", job: marked.job };
  }
  return { ok: true, action: "waiting", job };
}

function photoRecord(image: InspectedFurnitureImage): FurniturePhotoRecord {
  return {
    slot: image.slot,
    fileName: `${image.slot}.${imageExtension(image.mimeType)}`,
    mimeType: image.mimeType,
    byteLength: image.byteLength,
    widthPx: image.widthPx,
    heightPx: image.heightPx,
  };
}

function reserveMessage(code: "disabled" | "unsupported_settings" | "quota_exhausted" | "concurrency_limited" | "idempotency_conflict" | "invalid_input"): string {
  if (code === "quota_exhausted") return "The generation test budget is used up.";
  if (code === "concurrency_limited") return "A generation is already in progress.";
  if (code === "disabled") return "Generation is turned off.";
  if (code === "idempotency_conflict") return "This generation request does not match the earlier one.";
  if (code === "unsupported_settings") return "Those settings are not available.";
  return "The generation request could not be stored.";
}
