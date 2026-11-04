/**
 * Durable Bring Forward snapshots and selections.
 *
 * A snapshot is the packed-mask scan that already passed normalization.
 * A selection stores object ids for that snapshot and a revision. Cancel does
 * not write. An older revision cannot replace a newer one. This module does
 * not call a segmentation provider and does not reserve a Roboflow quota.
 */

import { encodeRemoveMaskTransport } from "@/lib/vibode-stage/remove-mask-transport";
import {
  readRemoveObjectUiPayload,
  type RemoveObjectUiIdentity,
} from "@/lib/vibode-stage/remove-object-ui";
import type { RemoveObjectRecord } from "@/lib/vibode-stage/remove-objects";

export const BRING_FORWARD_STATE_PATH = "/api/vibode/bring-forward";
export const BRING_FORWARD_SNAPSHOT_FORMAT = "vibode-bring-forward-scan/v1";
export const BRING_FORWARD_SNAPSHOT_MAX_BYTES = 8_000_000;
export const BRING_FORWARD_SELECTION_MAX_IDS = 48;

const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[a-z0-9._/-]+$/i;

export type BringForwardVocabularyProfile = "default" | "bedroom";

export type BringForwardStoredIdentity = Readonly<{
  roomId: string;
  generationId: string;
  originalSha256: string;
  originalWidth: number;
  originalHeight: number;
  vocabularyProfile: BringForwardVocabularyProfile;
}>;

export type BringForwardSnapshotWrite = Readonly<{
  userId: string;
  identity: BringForwardStoredIdentity;
  conceptSet: string;
  payload: string;
  payloadSha256: string;
}>;

export type BringForwardSelectionWrite = Readonly<{
  userId: string;
  identity: BringForwardStoredIdentity;
  snapshotId: string;
  selectedIds: readonly string[];
  expectedRevision: number;
}>;

export type BringForwardSelectionResult =
  | Readonly<{ ok: true; revision: number; snapshotId: string }>
  | Readonly<{
    ok: false;
    code: "conflict" | "snapshot" | "identity" | "mask" | "unavailable";
    revision: number | null;
  }>;

export type BringForwardReadResult =
  | Readonly<{ ok: true; recovery: "empty" }>
  | Readonly<{ ok: true; recovery: "unreadable" }>
  | Readonly<{
    ok: true;
    recovery: "ready";
    revision: number;
    selectedIds: readonly string[];
    snapshotId: string;
    payload: string;
    payloadSha256: string;
  }>
  | Readonly<{ ok: false; code: "unavailable" }>;

export type BringForwardRepository = Readonly<{
  putSnapshot: (
    input: BringForwardSnapshotWrite,
  ) => Promise<Readonly<{ ok: true; id: string }> | Readonly<{ ok: false; code: "unavailable" }>>;
  writeSelection: (input: BringForwardSelectionWrite) => Promise<BringForwardSelectionResult>;
  read: (input: Readonly<{
    userId: string;
    identity: BringForwardStoredIdentity;
  }>) => Promise<BringForwardReadResult>;
}>;

export type BringForwardAuthority = (input: Readonly<{
  userId: string;
  roomId: string;
  generationId: string;
}>) => Promise<
  | Readonly<{ ok: true; identity: BringForwardStoredIdentity }>
  | Readonly<{ ok: false; status: number; reason: string }>
>;

type AcceptedSnapshot = Readonly<{
  ok: true;
  canonical: string;
  conceptSet: string;
  provider: string;
  modelId: string;
  objects: readonly RemoveObjectRecord[];
}>;

type RejectedSnapshot = Readonly<{ ok: false; reason: "identity" | "mask" }>;

export function bringForwardPayloadBytes(payload: string): number {
  return new TextEncoder().encode(payload).byteLength;
}

export function planBringForwardSelectionWrite(input: Readonly<{
  currentRevision: number | null;
  expectedRevision: number;
}>): Readonly<{ action: "insert"; revision: 1 } | { action: "update"; revision: number } | { action: "conflict"; revision: number }> {
  const current = input.currentRevision;
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
    return { action: "conflict", revision: current ?? 0 };
  }
  if (current === null) {
    if (input.expectedRevision !== 0) return { action: "conflict", revision: 0 };
    return { action: "insert", revision: 1 };
  }
  if (current !== input.expectedRevision) return { action: "conflict", revision: current };
  return { action: "update", revision: current + 1 };
}

export function bringForwardSelectionBinds(
  objects: readonly RemoveObjectRecord[],
  ids: readonly string[],
): boolean {
  if (ids.length > BRING_FORWARD_SELECTION_MAX_IDS) return false;
  const eligible = new Set(objects.filter((object) => object.eligibility.eligible).map((object) => object.id));
  const unique = new Set<string>();
  for (const id of ids) {
    if (typeof id !== "string" || !TOKEN.test(id) || id.length > 80 || !eligible.has(id)) return false;
    unique.add(id);
  }
  return unique.size === ids.length;
}

export function acceptBringForwardSnapshot(
  value: unknown,
  identity: Omit<BringForwardStoredIdentity, "vocabularyProfile">,
): AcceptedSnapshot | RejectedSnapshot {
  const record = jsonRecord(value);
  if (!record || record.format !== BRING_FORWARD_SNAPSHOT_FORMAT) return { ok: false, reason: "mask" };
  if (record.roomId !== identity.roomId || record.generationId !== identity.generationId) {
    return { ok: false, reason: "identity" };
  }
  const original = jsonRecord(record.original);
  const sha256 = typeof original?.sha256 === "string" ? original.sha256.toLowerCase() : "";
  if (
    !original
    || sha256 !== identity.originalSha256
    || original.decodedWidth !== identity.originalWidth
    || original.decodedHeight !== identity.originalHeight
  ) {
    return { ok: false, reason: "identity" };
  }
  const conceptSet = conceptToken(record.conceptSet);
  const provider = token(record.provider, 40);
  const modelId = token(record.modelId, 80);
  if (!conceptSet || !provider || !modelId) return { ok: false, reason: "mask" };
  const read = readRemoveObjectUiPayload({ ...record, usable: true }, readerIdentity(identity));
  if (!read.ok) return { ok: false, reason: "mask" };
  const objects = read.objects.slice().sort((left, right) => left.id.localeCompare(right.id));
  const transported = [];
  for (const object of objects) {
    const mask = encodeRemoveMaskTransport(object.mask);
    if (!mask) return { ok: false, reason: "mask" };
    transported.push({
      id: object.id,
      concept: object.concept,
      confidence: object.confidence,
      mask,
    });
  }
  const canonical = JSON.stringify({
    format: BRING_FORWARD_SNAPSHOT_FORMAT,
    usable: true,
    provider,
    modelId,
    conceptSet,
    roomId: identity.roomId,
    generationId: identity.generationId,
    original: {
      sha256: identity.originalSha256,
      decodedWidth: identity.originalWidth,
      decodedHeight: identity.originalHeight,
    },
    providerTimeSec: null,
    objects: transported,
    rejected: [],
    suppressed: [],
  });
  if (bringForwardPayloadBytes(canonical) > BRING_FORWARD_SNAPSHOT_MAX_BYTES) {
    return { ok: false, reason: "mask" };
  }
  const confirmed = readRemoveObjectUiPayload(JSON.parse(canonical), readerIdentity(identity));
  if (!confirmed.ok || confirmed.objects.length !== objects.length) return { ok: false, reason: "mask" };
  return { ok: true, canonical, conceptSet, provider, modelId, objects };
}

export function canonicalBringForwardSnapshot(input: Readonly<{
  identity: Omit<BringForwardStoredIdentity, "vocabularyProfile">;
  conceptSet: string;
  provider: string;
  modelId: string;
  objects: readonly RemoveObjectRecord[];
}>): string | null {
  const accepted = acceptBringForwardSnapshot({
    format: BRING_FORWARD_SNAPSHOT_FORMAT,
    provider: input.provider,
    modelId: input.modelId,
    conceptSet: input.conceptSet,
    roomId: input.identity.roomId,
    generationId: input.identity.generationId,
    original: {
      sha256: input.identity.originalSha256,
      decodedWidth: input.identity.originalWidth,
      decodedHeight: input.identity.originalHeight,
    },
    providerTimeSec: null,
    objects: input.objects.map((object) => {
      const mask = encodeRemoveMaskTransport(object.mask);
      return mask
        ? { id: object.id, concept: object.concept, confidence: object.confidence, mask }
        : null;
    }),
    rejected: [],
    suppressed: [],
  }, input.identity);
  return accepted.ok ? accepted.canonical : null;
}

type StoredClientScan = Readonly<{
  recovery: "ready";
  revision: number;
  selectedIds: readonly string[];
  conceptSet: string;
  provider: string;
  modelId: string;
  objects: readonly RemoveObjectRecord[];
}>;

export type BringForwardClientRead =
  | StoredClientScan
  | Readonly<{ recovery: "empty" }>
  | Readonly<{ recovery: "corrupt" }>
  | Readonly<{ recovery: "failed" }>;

export function readBringForwardStateResponse(
  payload: unknown,
  identity: Omit<BringForwardStoredIdentity, "vocabularyProfile">,
): BringForwardClientRead {
  const record = jsonRecord(payload);
  if (!record) return { recovery: "corrupt" };
  if (record.recovery === "empty") return { recovery: "empty" };
  if (record.recovery === "corrupt") return { recovery: "corrupt" };
  if (record.recovery !== "ready") return { recovery: "corrupt" };
  const revision = record.revision;
  const selectedIds = stringList(record.selectedIds);
  if (!Number.isInteger(revision) || (revision as number) < 0 || !selectedIds) return { recovery: "corrupt" };
  const accepted = acceptBringForwardSnapshot(record.scan, identity);
  if (!accepted.ok) return { recovery: "corrupt" };
  if (!bringForwardSelectionBinds(accepted.objects, selectedIds) && selectedIds.length > 0) {
    return { recovery: "corrupt" };
  }
  const bound = selectedIds.filter((id) => accepted.objects.some((object) => object.id === id));
  if (bound.length !== selectedIds.length) return { recovery: "corrupt" };
  return {
    recovery: "ready",
    revision: revision as number,
    selectedIds,
    conceptSet: accepted.conceptSet,
    provider: accepted.provider,
    modelId: accepted.modelId,
    objects: accepted.objects,
  };
}

export async function requestStoredBringForwardScan(input: Readonly<{
  roomId: string;
  generationId: string;
  originalSha256: string;
  originalWidth: number;
  originalHeight: number;
  fetchImpl?: typeof fetch;
}>): Promise<BringForwardClientRead> {
  if (!UUID.test(input.roomId) || !UUID.test(input.generationId) || !SHA256.test(input.originalSha256)) {
    return { recovery: "failed" };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(
      `${BRING_FORWARD_STATE_PATH}?roomId=${encodeURIComponent(input.roomId)}&generationId=${encodeURIComponent(input.generationId)}`,
      { method: "GET", cache: "no-store", credentials: "same-origin" },
    );
    if (!response.ok) return { recovery: "failed" };
    const payload: unknown = await response.json();
    return readBringForwardStateResponse(payload, {
      roomId: input.roomId,
      generationId: input.generationId,
      originalSha256: input.originalSha256,
      originalWidth: input.originalWidth,
      originalHeight: input.originalHeight,
    });
  } catch {
    return { recovery: "failed" };
  }
}

export async function requestBringForwardSave(input: Readonly<{
  identity: Omit<BringForwardStoredIdentity, "vocabularyProfile">;
  conceptSet: string;
  provider: string;
  modelId: string;
  objects: readonly RemoveObjectRecord[];
  selectedIds: readonly string[];
  expectedRevision: number;
  fetchImpl?: typeof fetch;
}>): Promise<Readonly<{ ok: true; revision: number }> | Readonly<{ ok: false; revision: number | null }>> {
  const scan = canonicalBringForwardSnapshot({
    identity: input.identity,
    conceptSet: input.conceptSet,
    provider: input.provider,
    modelId: input.modelId,
    objects: input.objects,
  });
  if (!scan || !bringForwardSelectionBinds(input.objects, input.selectedIds)) {
    return { ok: false, revision: null };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(BRING_FORWARD_STATE_PATH, {
      method: "PUT",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        roomId: input.identity.roomId,
        generationId: input.identity.generationId,
        expectedRevision: input.expectedRevision,
        selectedIds: input.selectedIds,
        scan: JSON.parse(scan) as unknown,
      }),
    });
    const payload: unknown = await response.json().catch(() => null);
    const record = jsonRecord(payload);
    const revision = record && Number.isInteger(record.revision) && (record.revision as number) >= 0
      ? record.revision as number
      : null;
    if (!response.ok || !record || record.ok !== true || revision === null) {
      return { ok: false, revision };
    }
    return { ok: true, revision };
  } catch {
    return { ok: false, revision: null };
  }
}

export class MemoryBringForwardStore implements BringForwardRepository {
  private readonly snapshots = new Map<string, SnapshotRow>();
  private readonly snapshotIds = new Map<string, string>();
  private readonly selections = new Map<string, SelectionRow>();
  private created = 0;

  async putSnapshot(input: BringForwardSnapshotWrite) {
    const existing = this.snapshotIds.get(snapshotKey(input.userId, input.identity, input.payloadSha256));
    if (existing) return { ok: true as const, id: existing };
    const id = crypto.randomUUID();
    this.created += 1;
    this.snapshots.set(id, {
      id,
      userId: input.userId,
      identity: input.identity,
      conceptSet: input.conceptSet,
      payload: input.payload,
      payloadSha256: input.payloadSha256,
      createdAt: this.created,
    });
    this.snapshotIds.set(snapshotKey(input.userId, input.identity, input.payloadSha256), id);
    return { ok: true as const, id };
  }

  async writeSelection(input: BringForwardSelectionWrite): Promise<BringForwardSelectionResult> {
    const snapshot = this.snapshots.get(input.snapshotId);
    if (!snapshot || snapshot.userId !== input.userId || !sameIdentity(snapshot.identity, input.identity)) {
      return { ok: false, code: "snapshot", revision: this.selections.get(selectionKey(input.userId, input.identity))?.revision ?? null };
    }
    const accepted = acceptBringForwardSnapshot(snapshot.payload, input.identity);
    if (!accepted.ok || !bringForwardSelectionBinds(accepted.objects, input.selectedIds)) {
      return { ok: false, code: "mask", revision: this.selections.get(selectionKey(input.userId, input.identity))?.revision ?? null };
    }
    const key = selectionKey(input.userId, input.identity);
    const current = this.selections.get(key) ?? null;
    const plan = planBringForwardSelectionWrite({
      currentRevision: current?.revision ?? null,
      expectedRevision: input.expectedRevision,
    });
    if (plan.action === "conflict") return { ok: false, code: "conflict", revision: plan.revision };
    this.selections.set(key, {
      snapshotId: snapshot.id,
      selectedIds: input.selectedIds.slice(),
      revision: plan.revision,
    });
    return { ok: true, revision: plan.revision, snapshotId: snapshot.id };
  }

  async read(input: Readonly<{ userId: string; identity: BringForwardStoredIdentity }>): Promise<BringForwardReadResult> {
    const selection = this.selections.get(selectionKey(input.userId, input.identity));
    if (selection) {
      const snapshot = this.snapshots.get(selection.snapshotId);
      if (!snapshot || snapshot.userId !== input.userId || !sameIdentity(snapshot.identity, input.identity)) {
        return { ok: true, recovery: "unreadable" };
      }
      return {
        ok: true,
        recovery: "ready",
        revision: selection.revision,
        selectedIds: selection.selectedIds.slice(),
        snapshotId: snapshot.id,
        payload: snapshot.payload,
        payloadSha256: snapshot.payloadSha256,
      };
    }
    const newest = [...this.snapshots.values()]
      .filter((snapshot) => snapshot.userId === input.userId && sameIdentity(snapshot.identity, input.identity))
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
      .at(-1);
    if (!newest) return { ok: true, recovery: "empty" };
    return {
      ok: true,
      recovery: "ready",
      revision: 0,
      selectedIds: [],
      snapshotId: newest.id,
      payload: newest.payload,
      payloadSha256: newest.payloadSha256,
    };
  }

  damage(snapshotId: string): void {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) return;
    snapshot.payload = "{\"format\":\"damaged\"}";
  }

  selection(input: Readonly<{ userId: string; identity: BringForwardStoredIdentity }>) {
    const row = this.selections.get(selectionKey(input.userId, input.identity));
    return row ? { ...row, selectedIds: row.selectedIds.slice() } : null;
  }
}

export async function handleBringForwardState(
  request: Request,
  deps: Readonly<{
    getActor: () => Promise<{ id: string } | null>;
    authorize: BringForwardAuthority;
    store: BringForwardRepository;
    hash: (text: string) => string;
  }>,
): Promise<Response> {
  const actor = await deps.getActor();
  if (!actor) return json({ ok: false, reason: "Sign in required." }, 403);
  const url = new URL(request.url);
  if (request.method === "GET") {
    const roomId = url.searchParams.get("roomId");
    const generationId = url.searchParams.get("generationId");
    if (!roomId || !generationId || !UUID.test(roomId) || !UUID.test(generationId)) {
      return json({ ok: false, reason: "Request is invalid." }, 400);
    }
    const authority = await deps.authorize({ userId: actor.id, roomId, generationId });
    if (!authority.ok) return json({ ok: false, reason: authority.reason }, authority.status);
    const read = await deps.store.read({ userId: actor.id, identity: authority.identity });
    if (!read.ok) return json({ ok: false, reason: "Bring Forward could not be loaded." }, 503);
    if (read.recovery === "empty") return json({ recovery: "empty" }, 200);
    if (read.recovery === "unreadable") return json({ recovery: "corrupt" }, 200);
    if (deps.hash(read.payload) !== read.payloadSha256) return json({ recovery: "corrupt" }, 200);
    const accepted = acceptBringForwardSnapshot(read.payload, authority.identity);
    if (!accepted.ok || !bringForwardSelectionBinds(accepted.objects, read.selectedIds)) {
      return json({ recovery: "corrupt" }, 200);
    }
    return json({
      recovery: "ready",
      revision: read.revision,
      selectedIds: read.selectedIds,
      snapshotId: read.snapshotId,
      scan: JSON.parse(read.payload) as unknown,
    }, 200);
  }
  if (request.method !== "PUT") return json({ ok: false, reason: "Request is invalid." }, 405);
  const body = await readBody(request);
  if (body === "too-large") return json({ ok: false, reason: "Request body is invalid." }, 413);
  if (!body) return json({ ok: false, reason: "Request body is invalid." }, 400);
  const roomId = body.roomId;
  const generationId = body.generationId;
  const expectedRevision = body.expectedRevision;
  const selectedIds = stringList(body.selectedIds);
  if (typeof roomId !== "string" || typeof generationId !== "string" || !UUID.test(roomId) || !UUID.test(generationId)) {
    return json({ ok: false, reason: "Request body is invalid." }, 400);
  }
  if (!Number.isInteger(expectedRevision) || (expectedRevision as number) < 0 || !selectedIds) {
    return json({ ok: false, reason: "Request body is invalid." }, 400);
  }
  const authority = await deps.authorize({ userId: actor.id, roomId, generationId });
  if (!authority.ok) return json({ ok: false, reason: authority.reason }, authority.status);
  const accepted = acceptBringForwardSnapshot(body.scan, authority.identity);
  if (!accepted.ok) {
    const status = accepted.reason === "identity" ? 409 : 422;
    return json({ ok: false, reason: "Bring Forward could not be saved.", code: accepted.reason }, status);
  }
  if (!bringForwardSelectionBinds(accepted.objects, selectedIds)) {
    return json({ ok: false, reason: "Bring Forward could not be saved.", code: "mask" }, 422);
  }
  const payloadSha256 = deps.hash(accepted.canonical);
  if (!SHA256.test(payloadSha256)) return json({ ok: false, reason: "Bring Forward could not be saved." }, 503);
  const snapshot = await deps.store.putSnapshot({
    userId: actor.id,
    identity: authority.identity,
    conceptSet: accepted.conceptSet,
    payload: accepted.canonical,
    payloadSha256,
  });
  if (!snapshot.ok) return json({ ok: false, reason: "Bring Forward could not be saved." }, 503);
  const written = await deps.store.writeSelection({
    userId: actor.id,
    identity: authority.identity,
    snapshotId: snapshot.id,
    selectedIds,
    expectedRevision: expectedRevision as number,
  });
  if (!written.ok) {
    const status = written.code === "conflict" ? 409 : written.code === "unavailable" ? 503 : 422;
    return json({ ok: false, reason: "Bring Forward could not be saved.", code: written.code, revision: written.revision }, status);
  }
  return json({ ok: true, revision: written.revision, snapshotId: written.snapshotId }, 200);
}

type SnapshotRow = {
  id: string;
  userId: string;
  identity: BringForwardStoredIdentity;
  conceptSet: string;
  payload: string;
  payloadSha256: string;
  createdAt: number;
};

type SelectionRow = {
  snapshotId: string;
  selectedIds: string[];
  revision: number;
};

function readerIdentity(identity: Omit<BringForwardStoredIdentity, "vocabularyProfile">): RemoveObjectUiIdentity {
  return {
    roomId: identity.roomId,
    generationId: identity.generationId,
    originalSha256: identity.originalSha256,
    originalWidth: identity.originalWidth,
    originalHeight: identity.originalHeight,
    sessionSerial: 0,
    vocabularyRevision: 0,
  };
}

function sameIdentity(left: BringForwardStoredIdentity, right: BringForwardStoredIdentity): boolean {
  return left.roomId === right.roomId
    && left.generationId === right.generationId
    && left.originalSha256 === right.originalSha256
    && left.originalWidth === right.originalWidth
    && left.originalHeight === right.originalHeight
    && left.vocabularyProfile === right.vocabularyProfile;
}

function snapshotKey(userId: string, identity: BringForwardStoredIdentity, payloadSha256: string): string {
  return [
    userId,
    identity.roomId,
    identity.generationId,
    identity.originalSha256,
    identity.originalWidth,
    identity.originalHeight,
    identity.vocabularyProfile,
    payloadSha256,
  ].join("\u001f");
}

function selectionKey(userId: string, identity: BringForwardStoredIdentity): string {
  return [
    userId,
    identity.roomId,
    identity.generationId,
    identity.originalSha256,
    identity.originalWidth,
    identity.originalHeight,
    identity.vocabularyProfile,
  ].join("\u001f");
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return jsonRecord(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function token(value: unknown, max: number): string | null {
  if (typeof value !== "string" || !TOKEN.test(value) || value.length > max) return null;
  return value;
}

function conceptToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length < 1 || text.length > 80 || text !== value) return null;
  return text;
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > BRING_FORWARD_SELECTION_MAX_IDS) return null;
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    ids.push(item);
  }
  return ids;
}

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

async function readBody(request: Request): Promise<Record<string, unknown> | null | "too-large"> {
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > BRING_FORWARD_SNAPSHOT_MAX_BYTES + 65_536) return "too-large";
  const text = await request.text();
  if (bringForwardPayloadBytes(text) > BRING_FORWARD_SNAPSHOT_MAX_BYTES + 65_536) return "too-large";
  try {
    return jsonRecord(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}
