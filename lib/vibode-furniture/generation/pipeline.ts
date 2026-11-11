/**
 * Executable generation pipeline. A reserved job is prepared under a lease
 * before any paid attempt is recorded. The provider POST happens only after
 * that commit, and only with the new submit lease. An ambiguous result is
 * reconciled from the task list. This module does not read provider credentials.
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
import type {
  BucketObjectStore,
  ClaimedGeneration,
  GenerationCaller,
  GenerationCommands,
  PipelineFailure,
  PublicGenerationJob,
  TemporaryGenerationObject,
} from "./contracts";
import { imageExtension, inspectFurnitureImage, type InspectedFurnitureImage } from "./images";
import type { MeshyAdapter, MeshyCreateOutcome } from "./meshy-adapter";
import { matchListedMeshyTask, normalizeMeshyTaskFailure } from "./meshy-task";
import { generationObjectAllowed } from "./objects";
import {
  candidateBucket,
  generationCandidatePath,
  generationInputPath,
  intakeProviderGlb,
  type GenerationDownloader,
} from "./output";
import { buildMeshyCreateRequest, type MeshyCreateRequest } from "./payload";
import { GENERATION_INPUT_BUCKET, GENERATION_INPUT_UPLOAD_GRACE_MS, generationAccessDecision } from "./policy";
import { betaFrontPhotoBytesAllowed } from "./transport";
import { generationRequestSha256 } from "./workflow";

export type GenerationPass = Readonly<{
  ok: true;
  action: "idle" | "disabled" | "submitted" | "reconciled" | "running" | "ready" | "failed" | "waiting" | "needs_review" | "ambiguous" | "rate_limited" | "submission_not_authorized";
  jobId: string | null;
}>;

export async function createOwnedGeneration(input: {
  commands: GenerationCommands;
  objects: BucketObjectStore;
  actor: GenerationCaller;
  env: Readonly<Record<string, string | undefined>>;
  isAdmin: (email: string | null | undefined) => boolean;
  idempotencyKey: string;
  jobId: string;
  settings: FurnitureGeneratorSettings;
  images: readonly { slot: FurnitureViewSlot; bytes: Uint8Array }[];
  nowMs: number;
}): Promise<{ ok: true; created: boolean; job: PublicGenerationJob } | PipelineFailure> {
  const liveEnabled = await readLive(input.commands);
  const access = generationAccessDecision({
    userId: input.actor.userId,
    email: input.actor.email,
    generationEnabledEnv: input.env.VIBODE_MESHY_GENERATION_ENABLED,
    liveEnabled,
    isAdmin: input.isAdmin,
  });
  if (access !== "ok") {
    return { ok: false, errorClass: access, message: "Generation is not available." };
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
  let photoSet = emptyFurniturePhotoSet();
  for (const image of inspected) photoSet = setFurniturePhoto(photoSet, photoRecord(image));
  const mode = inspected.length > 1 ? "multi" : "single";
  const settingsIssue = generatorSettingsIssues(input.settings, mode)[0];
  if (settingsIssue) return { ok: false, errorClass: "unsupported_settings", message: settingsIssue.message };
  const draft = mapMeshyGenerationDraft({ photos: photoSet, settings: input.settings });
  if (!draft.ok) return { ok: false, errorClass: "invalid_input", message: draft.errors[0] ?? "The photos could not be used." };
  const credits = estimateMeshy71Credits(input.settings, draft.draft.operation);
  if (credits == null) return { ok: false, errorClass: "unsupported_settings", message: "Those settings are not available." };
  if (inspected.some((image) => !betaFrontPhotoBytesAllowed(image.byteLength))) {
    return { ok: false, errorClass: "invalid_input", message: "The photo is too large to send." };
  }
  const reserved = await input.commands.reserve({
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
  if (!reserved.ok) return { ok: false, errorClass: reserved.code, message: reserveMessage(reserved.code) };
  if (!reserved.created) return { ok: true, created: false, job: reserved.job };
  const stored: { bucket: string; path: string }[] = [];
  try {
    for (const image of inspected) {
      const path = generationInputPath(input.actor.userId, reserved.job.jobId, image.slot, imageExtension(image.mimeType));
      await input.objects.put({
        bucket: GENERATION_INPUT_BUCKET,
        path,
        bytes: image.bytes,
        contentType: image.mimeType,
      });
      stored.push({ bucket: GENERATION_INPUT_BUCKET, path });
      const attached = await input.commands.attachInput({
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
    for (const object of stored) await input.objects.remove(object);
    await input.commands.failBeforeProvider({
      userId: input.actor.userId,
      jobId: reserved.job.jobId,
      nowMs: input.nowMs,
    });
    return { ok: false, errorClass: "input_storage_failed", message: "The photos could not be stored." };
  }
  return { ok: true, created: true, job: reserved.job };
}

export async function readOwnedGeneration(
  commands: GenerationCommands,
  userId: string,
  jobId: string,
): Promise<{ ok: true; job: PublicGenerationJob } | PipelineFailure> {
  const read = await commands.readOwner(userId, jobId);
  if (!read.ok) return { ok: false, errorClass: "not_found", message: "That generation could not be found." };
  return { ok: true, job: read.job };
}

export async function previewOwnedGeneration(input: {
  commands: GenerationCommands;
  objects: BucketObjectStore;
  userId: string;
  jobId: string;
}): Promise<{ ok: true; previewUrl: string } | PipelineFailure> {
  const source = await input.commands.previewSource(input.userId, input.jobId);
  if (!source.ok) return { ok: false, errorClass: "not_found", message: "That preview is not available." };
  const previewUrl = await input.objects.sign({
    bucket: source.bucket,
    path: source.path,
    ownerUserId: input.userId,
  });
  if (!previewUrl) return { ok: false, errorClass: "not_found", message: "That preview is not available." };
  return { ok: true, previewUrl };
}

export async function discardOwnedGeneration(input: {
  commands: GenerationCommands;
  userId: string;
  jobId: string;
  nowMs: number;
}): Promise<{ ok: true; status: string; providerCreditsRefunded: false } | PipelineFailure> {
  const discarded = await input.commands.discard(input);
  if (!discarded.ok) {
    return {
      ok: false,
      errorClass: discarded.code,
      message: discarded.code === "not_found"
        ? "That generation could not be found."
        : "That generation cannot be discarded.",
    };
  }
  return { ok: true, status: discarded.status, providerCreditsRefunded: false };
}

export async function authorizeOperationalResubmit(input: {
  commands: GenerationCommands;
  actor: GenerationCaller;
  isAdmin: (email: string | null | undefined) => boolean;
  jobId: string;
  duplicateChargeRiskAccepted: boolean;
}): Promise<{ ok: true; status: string; duplicateChargeRisk: true } | PipelineFailure> {
  if (!input.actor.userId || !input.isAdmin(input.actor.email)) {
    return { ok: false, errorClass: "unauthorized", message: "Generation recovery is not available." };
  }
  const authorized = await input.commands.adminAuthorize(input.jobId, input.duplicateChargeRiskAccepted);
  if (!authorized.ok) {
    return {
      ok: false,
      errorClass: authorized.code,
      message: "That generation cannot be submitted again.",
    };
  }
  return authorized;
}

export async function executeFurnitureGenerationClaim(input: {
  commands: GenerationCommands;
  objects: BucketObjectStore;
  adapter: MeshyAdapter;
  download: GenerationDownloader;
  validate: PersonalGlbValidator;
  nowMs: number;
  submitAllowed: boolean;
}): Promise<GenerationPass> {
  const claimed = await input.commands.claimNext(input.submitAllowed, input.nowMs);
  if (!claimed.ok) {
    if (claimed.code === "submission_not_authorized") {
      return { ok: true, action: "submission_not_authorized", jobId: null };
    }
    return { ok: true, action: "waiting", jobId: null };
  }
  if (claimed.outcome !== "claimed") return { ok: true, action: claimed.outcome, jobId: null };
  const claim = claimed.claim;
  if (claim.purpose === "prepare") return prepareAndCommit(input, claim);
  if (claim.purpose === "submit") return submitClaim(input, claim);
  if (claim.purpose === "reconcile") return reconcileClaim(input, claim);
  return pollClaim(input, claim);
}

export async function cleanupTemporaryGenerationObjects(input: {
  commands: GenerationCommands;
  objects: BucketObjectStore;
  nowMs: number;
}): Promise<{ removed: number }> {
  await input.commands.sweep(input.nowMs);
  const listed = await input.commands.listTemporaryObjects(50);
  let removed = 0;
  for (const object of listed) {
    if (!cleanupAllowed(object)) continue;
    await input.objects.remove({ bucket: object.bucket, path: object.path });
    const marked = await input.commands.markTemporaryPurged(object);
    if (marked) removed += 1;
  }
  return { removed };
}

async function prepareAndCommit(
  input: {
    commands: GenerationCommands;
    objects: BucketObjectStore;
    adapter: MeshyAdapter;
    nowMs: number;
  },
  claim: ClaimedGeneration,
): Promise<GenerationPass> {
  const prepared = await classifyPreparation(input.commands, input.objects, claim, input.nowMs);
  if (prepared.kind === "waiting" || prepared.kind === "transient") {
    await input.commands.dropClaim({
      userId: claim.userId,
      jobId: claim.jobId,
      claimNonce: claim.claimNonce,
      nowMs: input.nowMs,
    });
    return { ok: true, action: "waiting", jobId: claim.jobId };
  }
  if (prepared.kind === "invalid") {
    const failed = await input.commands.failPreparedInput({
      userId: claim.userId,
      jobId: claim.jobId,
      claimNonce: claim.claimNonce,
      nowMs: input.nowMs,
    });
    if (!failed.ok) {
      await input.commands.dropClaim({
        userId: claim.userId,
        jobId: claim.jobId,
        claimNonce: claim.claimNonce,
        nowMs: input.nowMs,
      });
      return { ok: true, action: "waiting", jobId: claim.jobId };
    }
    return { ok: true, action: "failed", jobId: claim.jobId };
  }
  const committed = await input.commands.commitSubmission({
    userId: claim.userId,
    jobId: claim.jobId,
    claimNonce: claim.claimNonce,
    nowMs: input.nowMs,
  });
  if (!committed.ok) {
    if (committed.code === "submission_not_authorized") {
      return { ok: true, action: "submission_not_authorized", jobId: claim.jobId };
    }
    if (committed.code === "disabled") return { ok: true, action: "disabled", jobId: claim.jobId };
    if (committed.code === "unsupported_settings") {
      const failed = await input.commands.failPreparedInput({
        userId: claim.userId,
        jobId: claim.jobId,
        claimNonce: claim.claimNonce,
        nowMs: input.nowMs,
      });
      return { ok: true, action: failed.ok ? "failed" : "waiting", jobId: claim.jobId };
    }
    return { ok: true, action: "waiting", jobId: claim.jobId };
  }
  return postCreate(input, { ...claim, purpose: "submit", claimNonce: committed.claimNonce }, prepared.request);
}

async function submitClaim(
  input: {
    commands: GenerationCommands;
    objects: BucketObjectStore;
    adapter: MeshyAdapter;
    nowMs: number;
  },
  claim: ClaimedGeneration,
): Promise<GenerationPass> {
  const prepared = await prepareCreate(input.commands, input.objects, claim);
  if (!prepared) {
    await input.commands.markAmbiguous({
      userId: claim.userId,
      jobId: claim.jobId,
      claimNonce: claim.claimNonce,
      errorCode: "input_unreadable",
      nowMs: input.nowMs,
    });
    return { ok: true, action: "ambiguous", jobId: claim.jobId };
  }
  return postCreate(input, claim, prepared);
}

async function postCreate(
  input: {
    commands: GenerationCommands;
    adapter: MeshyAdapter;
    nowMs: number;
  },
  claim: ClaimedGeneration,
  request: MeshyCreateRequest,
): Promise<GenerationPass> {
  let outcome: MeshyCreateOutcome;
  try {
    outcome = await input.adapter.createTask(request);
  } catch {
    outcome = { kind: "ambiguous", errorCode: "create_network", message: "Meshy did not confirm that the task was created." };
  }
  if (outcome.kind === "created") {
    const bound = await input.commands.bindTask({
      userId: claim.userId,
      jobId: claim.jobId,
      claimNonce: claim.claimNonce,
      providerTaskId: outcome.taskId,
      providerStatus: "PENDING",
      nowMs: input.nowMs,
    });
    if (!bound.ok) return { ok: true, action: "waiting", jobId: claim.jobId };
    return { ok: true, action: "submitted", jobId: claim.jobId };
  }
  if (outcome.kind === "ambiguous") {
    await input.commands.markAmbiguous({
      userId: claim.userId,
      jobId: claim.jobId,
      claimNonce: claim.claimNonce,
      errorCode: outcome.errorCode,
      nowMs: input.nowMs,
    });
    return { ok: true, action: "ambiguous", jobId: claim.jobId };
  }
  if (outcome.errorClass === "rate_limited") {
    // The POST already consumed the one lifetime allowance. Keep it consumed.
    await input.commands.settleRateLimit({
      userId: claim.userId,
      jobId: claim.jobId,
      claimNonce: claim.claimNonce,
      nowMs: input.nowMs,
    });
    return { ok: true, action: "rate_limited", jobId: claim.jobId };
  }
  await input.commands.failCreate({
    userId: claim.userId,
    jobId: claim.jobId,
    claimNonce: claim.claimNonce,
    errorClass: outcome.errorClass,
    errorCode: outcome.errorCode,
    nowMs: input.nowMs,
  });
  return { ok: true, action: "failed", jobId: claim.jobId };
}

async function reconcileClaim(
  input: {
    commands: GenerationCommands;
    adapter: MeshyAdapter;
    nowMs: number;
  },
  claim: ClaimedGeneration,
): Promise<GenerationPass> {
  const page = await input.adapter.listRecentTasks(claim.operation);
  if (page.kind !== "page") {
    await input.commands.dropClaim({
      userId: claim.userId,
      jobId: claim.jobId,
      claimNonce: claim.claimNonce,
      nowMs: input.nowMs,
    });
    return { ok: true, action: "waiting", jobId: claim.jobId };
  }
  const match = matchListedMeshyTask({
    tasks: page.tasks,
    taskName: claim.providerTaskName,
    contactedAtMs: claim.providerContactedAtMs ?? 0,
    pageFull: page.pageFull,
  });
  if (match.kind === "unique") {
    const bound = await input.commands.bindTask({
      userId: claim.userId,
      jobId: claim.jobId,
      claimNonce: claim.claimNonce,
      providerTaskId: match.task.id,
      providerStatus: match.task.status,
      nowMs: input.nowMs,
    });
    if (!bound.ok) return { ok: true, action: "waiting", jobId: claim.jobId };
    return { ok: true, action: "reconciled", jobId: claim.jobId };
  }
  const marked = await input.commands.markNeedsReview({
    userId: claim.userId,
    jobId: claim.jobId,
    claimNonce: claim.claimNonce,
    reason: match.kind === "absent" ? "list_absent" : "list_incomplete",
    nowMs: input.nowMs,
  });
  if (!marked.ok) return { ok: true, action: "waiting", jobId: claim.jobId };
  return { ok: true, action: "needs_review", jobId: claim.jobId };
}

async function pollClaim(
  input: {
    commands: GenerationCommands;
    objects: BucketObjectStore;
    adapter: MeshyAdapter;
    download: GenerationDownloader;
    validate: PersonalGlbValidator;
    nowMs: number;
  },
  claim: ClaimedGeneration,
): Promise<GenerationPass> {
  if (!claim.providerTaskId) return { ok: true, action: "waiting", jobId: claim.jobId };
  const read = await input.adapter.getTask(claim.operation, claim.providerTaskId);
  if (read.kind !== "task") {
    await input.commands.dropClaim({
      userId: claim.userId,
      jobId: claim.jobId,
      claimNonce: claim.claimNonce,
      nowMs: input.nowMs,
    });
    return { ok: true, action: "waiting", jobId: claim.jobId };
  }
  const failure = read.task.status === "FAILED" || read.task.status === "CANCELED"
    ? normalizeMeshyTaskFailure(read.task)
    : null;
  const applied = await input.commands.applyObservation({
    userId: claim.userId,
    jobId: claim.jobId,
    claimNonce: claim.claimNonce,
    providerStatus: read.task.status,
    progress: read.task.progress,
    consumedCredits: read.task.consumedCredits,
    errorCode: failure?.errorCode ?? null,
    nowMs: input.nowMs,
  });
  if (!applied.ok) return { ok: true, action: "waiting", jobId: claim.jobId };
  if (applied.status === "failed") return { ok: true, action: "failed", jobId: claim.jobId };
  if (applied.errorClass === "credit_unreported" || applied.status !== "ingesting") {
    return { ok: true, action: "running", jobId: claim.jobId };
  }
  if (!read.task.glbUrl) {
    await input.commands.failOutput({
      userId: claim.userId,
      jobId: claim.jobId,
      claimNonce: claim.claimNonce,
      errorClass: "invalid_output",
      nowMs: input.nowMs,
    });
    return { ok: true, action: "failed", jobId: claim.jobId };
  }
  const intake = await intakeProviderGlb({
    url: read.task.glbUrl,
    nowMs: input.nowMs,
    expiresAtMs: read.task.expiresAtMs,
    assetId: `vibode-furniture/generation/${claim.jobId}`,
    download: input.download,
    validate: input.validate,
  });
  if (!intake.ok) {
    await input.commands.failOutput({
      userId: claim.userId,
      jobId: claim.jobId,
      claimNonce: claim.claimNonce,
      errorClass: intake.errorClass,
      nowMs: input.nowMs,
    });
    return { ok: true, action: "failed", jobId: claim.jobId };
  }
  const path = generationCandidatePath(claim.userId, claim.jobId);
  await input.objects.put({
    bucket: candidateBucket(),
    path,
    bytes: intake.bytes,
    contentType: "model/gltf-binary",
  });
  const recorded = await input.commands.recordOutput({
    userId: claim.userId,
    jobId: claim.jobId,
    claimNonce: claim.claimNonce,
    byteSize: intake.bytes.byteLength,
    sha256: createHash("sha256").update(intake.bytes).digest("hex"),
    nowMs: input.nowMs,
  });
  if (!recorded.ok) {
    await input.objects.remove({ bucket: candidateBucket(), path });
    return { ok: true, action: "waiting", jobId: claim.jobId };
  }
  return { ok: true, action: "ready", jobId: claim.jobId };
}

async function classifyPreparation(
  commands: GenerationCommands,
  objects: BucketObjectStore,
  claim: ClaimedGeneration,
  nowMs: number,
): Promise<
  | { kind: "ready"; request: MeshyCreateRequest }
  | { kind: "waiting" }
  | { kind: "invalid" }
  | { kind: "transient" }
> {
  const withinGrace = claim.createdAtMs == null || nowMs - claim.createdAtMs < GENERATION_INPUT_UPLOAD_GRACE_MS;
  try {
    const records = await commands.listInputs(claim.userId, claim.jobId);
    if (records.length !== claim.imageSlots.length || claim.imageSlots.some((slot) => !records.some((record) => record.slot === slot))) {
      return withinGrace ? { kind: "waiting" } : { kind: "invalid" };
    }
    const images: InspectedFurnitureImage[] = [];
    for (const record of records) {
      const bytes = await objects.get({ bucket: record.bucket, path: record.path });
      if (!bytes) return withinGrace ? { kind: "waiting" } : { kind: "invalid" };
      const inspected = await inspectFurnitureImage({ slot: record.slot, bytes });
      if (
        !inspected.ok
        || inspected.image.sha256 !== record.sha256
        || inspected.image.byteLength !== record.byteSize
        || inspected.image.widthPx !== record.widthPx
        || inspected.image.heightPx !== record.heightPx
        || inspected.image.mimeType !== record.mimeType
        || !betaFrontPhotoBytesAllowed(inspected.image.byteLength)
      ) {
        return { kind: "invalid" };
      }
      images.push(inspected.image);
    }
    let photoSet = emptyFurniturePhotoSet();
    for (const image of images) photoSet = setFurniturePhoto(photoSet, photoRecord(image));
    const draft = mapMeshyGenerationDraft({ photos: photoSet, settings: claim.settings });
    if (!draft.ok) return { kind: "invalid" };
    const request = buildMeshyCreateRequest({
      draft: draft.draft,
      images,
      taskName: claim.providerTaskName,
    });
    return request.ok ? { kind: "ready", request: request.request } : { kind: "invalid" };
  } catch {
    return { kind: "transient" };
  }
}

async function prepareCreate(
  commands: GenerationCommands,
  objects: BucketObjectStore,
  claim: ClaimedGeneration,
) {
  const records = await commands.listInputs(claim.userId, claim.jobId);
  if (records.length === 0) return null;
  const images: InspectedFurnitureImage[] = [];
  for (const record of records) {
    const bytes = await objects.get({ bucket: record.bucket, path: record.path });
    if (!bytes) return null;
    const inspected = await inspectFurnitureImage({ slot: record.slot, bytes });
    if (!inspected.ok || inspected.image.sha256 !== record.sha256) return null;
    images.push(inspected.image);
  }
  let photoSet = emptyFurniturePhotoSet();
  for (const image of images) photoSet = setFurniturePhoto(photoSet, photoRecord(image));
  const draft = mapMeshyGenerationDraft({ photos: photoSet, settings: claim.settings });
  if (!draft.ok) return null;
  const request = buildMeshyCreateRequest({
    draft: draft.draft,
    images,
    taskName: claim.providerTaskName,
  });
  return request.ok ? request.request : null;
}

async function readLive(commands: GenerationCommands): Promise<boolean> {
  try {
    return (await commands.controls()).liveEnabled === true;
  } catch {
    return false;
  }
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

function reserveMessage(code: string): string {
  if (code === "quota_exhausted") return "The generation test budget is used up.";
  if (code === "concurrency_limited") return "A generation is already in progress.";
  if (code === "disabled") return "Generation is turned off.";
  if (code === "idempotency_conflict") return "This generation request does not match the earlier one.";
  if (code === "unsupported_settings") return "Those settings are not available.";
  if (code === "allowance_required") return "A generation allowance is required.";
  if (code === "allowance_disabled") return "Generation access is turned off for this account.";
  if (code === "allowance_exhausted") return "No generations remain on this account.";
  return "The generation request could not be stored.";
}

function cleanupAllowed(object: TemporaryGenerationObject): boolean {
  return generationObjectAllowed(object.bucket, object.path, object.userId) && !object.path.includes("/assets/");
}
