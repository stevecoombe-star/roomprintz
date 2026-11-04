import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { sha256Hex } from "@/lib/afc-v2-production/production-artifact-integrity";
import { createProductionAfcStoreFromEnv } from "@/lib/afc-v2-production/production-persistence.server";
import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import {
  acceptBringForwardSnapshot,
  bringForwardSelectionBinds,
  BRING_FORWARD_SNAPSHOT_FORMAT,
  planBringForwardSelectionWrite,
  type BringForwardAuthority,
  type BringForwardReadResult,
  type BringForwardRepository,
  type BringForwardSelectionResult,
  type BringForwardSelectionWrite,
  type BringForwardSnapshotWrite,
  type BringForwardStoredIdentity,
  type BringForwardVocabularyProfile,
} from "@/lib/vibode-stage/bring-forward-store";
import { REMOVE_SEGMENTATION_CONCEPTS_BEDROOM, selectRemoveScanVocabulary } from "@/lib/vibode-stage/remove-segmentation";
import { readStoredRemoveVocabularyProfile } from "@/lib/vibode-stage/remove-vocabulary-profile.server";

const SHA256 = /^[0-9a-f]{64}$/;

/**
 * Service-role persistence for a scan that this process already normalized.
 * A storage failure leaves the scan response intact. This does not reserve
 * another segmentation quota and does not write room metadata.
 */
export async function persistValidatedSegmentationSnapshot(input: Readonly<{
  userId: string;
  vocabularyProfile: BringForwardVocabularyProfile;
  payload: unknown;
}>): Promise<void> {
  const service = getServiceRoleSupabaseClient();
  if (!service || !input.payload || typeof input.payload !== "object") return;
  const record = input.payload as {
    roomId?: unknown;
    generationId?: unknown;
    original?: { sha256?: unknown; decodedWidth?: unknown; decodedHeight?: unknown };
  };
  const sha256 = typeof record.original?.sha256 === "string" ? record.original.sha256.toLowerCase() : "";
  const width = record.original?.decodedWidth;
  const height = record.original?.decodedHeight;
  if (
    typeof record.roomId !== "string"
    || typeof record.generationId !== "string"
    || !SHA256.test(sha256)
    || typeof width !== "number"
    || typeof height !== "number"
  ) {
    return;
  }
  const accepted = acceptBringForwardSnapshot({
    ...input.payload,
    format: BRING_FORWARD_SNAPSHOT_FORMAT,
  }, {
    roomId: record.roomId,
    generationId: record.generationId,
    originalSha256: sha256,
    originalWidth: width,
    originalHeight: height,
  });
  if (!accepted.ok) return;
  const payloadSha256 = sha256Hex(new TextEncoder().encode(accepted.canonical));
  const store = new SupabaseBringForwardRepository(service);
  await store.putSnapshot({
    userId: input.userId,
    identity: {
      roomId: record.roomId,
      generationId: record.generationId,
      originalSha256: sha256,
      originalWidth: width,
      originalHeight: height,
      vocabularyProfile: input.vocabularyProfile,
    },
    conceptSet: accepted.conceptSet,
    payload: accepted.canonical,
    payloadSha256,
  });
}

export async function authorizeBringForwardIdentity(input: Readonly<{
  userId: string;
  roomId: string;
  generationId: string;
}>): Promise<Awaited<ReturnType<BringForwardAuthority>>> {
  const store = createProductionAfcStoreFromEnv();
  const service = getServiceRoleSupabaseClient();
  if (!store || !service) return { ok: false, status: 500, reason: "Server misconfigured." };
  const room = await store.getRoom(input.roomId);
  if (!room || room.userId !== input.userId) return { ok: false, status: 404, reason: "Room not found." };
  const generation = await store.getGeneration(input.generationId);
  if (!generation || generation.userId !== input.userId || generation.roomId !== room.id) {
    return { ok: false, status: 404, reason: "Room not found." };
  }
  const original = generation.original;
  const sha256 = original?.sha256.toLowerCase() ?? "";
  if (!original || !SHA256.test(sha256)) {
    return { ok: false, status: 404, reason: "Authoritative ORIGINAL image is unavailable." };
  }
  const profile = await readStoredRemoveVocabularyProfile(service, {
    userId: input.userId,
    roomId: input.roomId,
  });
  if (!profile.ok) {
    if (profile.code === "not_found") return { ok: false, status: 404, reason: "Room not found." };
    return { ok: false, status: 503, reason: "Bring Forward could not be loaded." };
  }
  const concepts = selectRemoveScanVocabulary({
    profile: profile.profile,
    originalSha256: profile.originalSha256,
    verifiedOriginalSha256: sha256,
  });
  return {
    ok: true,
    identity: {
      roomId: room.id,
      generationId: generation.id,
      originalSha256: sha256,
      originalWidth: original.decodedWidth,
      originalHeight: original.decodedHeight,
      vocabularyProfile: concepts === REMOVE_SEGMENTATION_CONCEPTS_BEDROOM ? "bedroom" : "default",
    },
  };
}

export class SupabaseBringForwardRepository implements BringForwardRepository {
  constructor(private readonly client: SupabaseClient) {}

  async putSnapshot(input: BringForwardSnapshotWrite) {
    try {
      const { data, error } = await this.client
        .from("vibode_bring_forward_snapshots")
        .insert({
          user_id: input.userId,
          room_id: input.identity.roomId,
          generation_id: input.identity.generationId,
          original_sha256: input.identity.originalSha256,
          original_width: input.identity.originalWidth,
          original_height: input.identity.originalHeight,
          vocabulary_profile: input.identity.vocabularyProfile,
          concept_set: input.conceptSet,
          payload: input.payload,
          payload_sha256: input.payloadSha256,
        })
        .select("id")
        .maybeSingle();
      if (!error && data && typeof data.id === "string") return { ok: true as const, id: data.id };
      if (!isUnique(error)) return { ok: false as const, code: "unavailable" as const };
      const { data: existing, error: readError } = await this.client
        .from("vibode_bring_forward_snapshots")
        .select("id")
        .eq("user_id", input.userId)
        .eq("room_id", input.identity.roomId)
        .eq("generation_id", input.identity.generationId)
        .eq("original_sha256", input.identity.originalSha256)
        .eq("original_width", input.identity.originalWidth)
        .eq("original_height", input.identity.originalHeight)
        .eq("vocabulary_profile", input.identity.vocabularyProfile)
        .eq("payload_sha256", input.payloadSha256)
        .maybeSingle();
      if (readError || !existing || typeof existing.id !== "string") {
        return { ok: false as const, code: "unavailable" as const };
      }
      return { ok: true as const, id: existing.id };
    } catch {
      return { ok: false as const, code: "unavailable" as const };
    }
  }

  async writeSelection(input: BringForwardSelectionWrite): Promise<BringForwardSelectionResult> {
    try {
      const snapshot = await this.snapshot(input.userId, input.snapshotId);
      if (!snapshot) return { ok: false, code: "snapshot", revision: await this.revisionOf(input) };
      if (!sameIdentity(snapshot, input.identity)) {
        return { ok: false, code: "identity", revision: await this.revisionOf(input) };
      }
      const accepted = acceptBringForwardSnapshot(snapshot.payload, input.identity);
      if (!accepted.ok || !bringForwardSelectionBinds(accepted.objects, input.selectedIds)) {
        return { ok: false, code: "mask", revision: await this.revisionOf(input) };
      }
      const current = await this.revisionOf(input);
      const plan = planBringForwardSelectionWrite({
        currentRevision: current,
        expectedRevision: input.expectedRevision,
      });
      if (plan.action === "conflict") return { ok: false, code: "conflict", revision: plan.revision };
      if (plan.action === "insert") {
        const { error } = await this.client.from("vibode_bring_forward_selections").insert({
          user_id: input.userId,
          room_id: input.identity.roomId,
          generation_id: input.identity.generationId,
          original_sha256: input.identity.originalSha256,
          original_width: input.identity.originalWidth,
          original_height: input.identity.originalHeight,
          vocabulary_profile: input.identity.vocabularyProfile,
          snapshot_id: input.snapshotId,
          selected_ids: input.selectedIds,
          revision: plan.revision,
          updated_at: new Date().toISOString(),
        });
        if (!error) return { ok: true, revision: plan.revision, snapshotId: input.snapshotId };
        if (!isUnique(error)) return { ok: false, code: "unavailable", revision: null };
        return { ok: false, code: "conflict", revision: await this.revisionOf(input) };
      }
      const { data, error } = await this.client
        .from("vibode_bring_forward_selections")
        .update({
          snapshot_id: input.snapshotId,
          selected_ids: input.selectedIds,
          revision: plan.revision,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", input.userId)
        .eq("room_id", input.identity.roomId)
        .eq("generation_id", input.identity.generationId)
        .eq("original_sha256", input.identity.originalSha256)
        .eq("original_width", input.identity.originalWidth)
        .eq("original_height", input.identity.originalHeight)
        .eq("vocabulary_profile", input.identity.vocabularyProfile)
        .eq("revision", input.expectedRevision)
        .select("revision");
      if (error) return { ok: false, code: "unavailable", revision: null };
      if (!Array.isArray(data) || data.length === 0) {
        return { ok: false, code: "conflict", revision: await this.revisionOf(input) };
      }
      return { ok: true, revision: plan.revision, snapshotId: input.snapshotId };
    } catch {
      return { ok: false, code: "unavailable", revision: null };
    }
  }

  async read(input: Readonly<{ userId: string; identity: BringForwardStoredIdentity }>): Promise<BringForwardReadResult> {
    try {
      const { data: selection, error } = await this.client
        .from("vibode_bring_forward_selections")
        .select("snapshot_id, selected_ids, revision")
        .eq("user_id", input.userId)
        .eq("room_id", input.identity.roomId)
        .eq("generation_id", input.identity.generationId)
        .eq("original_sha256", input.identity.originalSha256)
        .eq("original_width", input.identity.originalWidth)
        .eq("original_height", input.identity.originalHeight)
        .eq("vocabulary_profile", input.identity.vocabularyProfile)
        .maybeSingle();
      if (error) return { ok: false, code: "unavailable" };
      if (selection) {
        const snapshot = await this.snapshot(input.userId, String(selection.snapshot_id));
        if (!snapshot || !sameIdentity(snapshot, input.identity) || !Array.isArray(selection.selected_ids)) {
          return { ok: true, recovery: "unreadable" };
        }
        return {
          ok: true,
          recovery: "ready",
          revision: Number(selection.revision),
          selectedIds: selection.selected_ids.filter((id: unknown): id is string => typeof id === "string"),
          snapshotId: snapshot.id,
          payload: snapshot.payload,
          payloadSha256: snapshot.payload_sha256,
        };
      }
      const { data: newest, error: scanError } = await this.client
        .from("vibode_bring_forward_snapshots")
        .select("id, payload, payload_sha256, room_id, generation_id, original_sha256, original_width, original_height, vocabulary_profile")
        .eq("user_id", input.userId)
        .eq("room_id", input.identity.roomId)
        .eq("generation_id", input.identity.generationId)
        .eq("original_sha256", input.identity.originalSha256)
        .eq("original_width", input.identity.originalWidth)
        .eq("original_height", input.identity.originalHeight)
        .eq("vocabulary_profile", input.identity.vocabularyProfile)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (scanError) return { ok: false, code: "unavailable" };
      if (!newest) return { ok: true, recovery: "empty" };
      return {
        ok: true,
        recovery: "ready",
        revision: 0,
        selectedIds: [],
        snapshotId: String(newest.id),
        payload: String(newest.payload),
        payloadSha256: String(newest.payload_sha256),
      };
    } catch {
      return { ok: false, code: "unavailable" };
    }
  }

  private async snapshot(userId: string, snapshotId: string): Promise<SnapshotRow | null> {
    const { data, error } = await this.client
      .from("vibode_bring_forward_snapshots")
      .select("id, payload, payload_sha256, room_id, generation_id, original_sha256, original_width, original_height, vocabulary_profile")
      .eq("user_id", userId)
      .eq("id", snapshotId)
      .maybeSingle();
    if (error || !data) return null;
    return {
      id: String(data.id),
      payload: String(data.payload),
      payload_sha256: String(data.payload_sha256),
      roomId: String(data.room_id),
      generationId: String(data.generation_id),
      originalSha256: String(data.original_sha256),
      originalWidth: Number(data.original_width),
      originalHeight: Number(data.original_height),
      vocabularyProfile: data.vocabulary_profile === "bedroom" ? "bedroom" : "default",
    };
  }

  private async revisionOf(input: BringForwardSelectionWrite): Promise<number | null> {
    const { data, error } = await this.client
      .from("vibode_bring_forward_selections")
      .select("revision")
      .eq("user_id", input.userId)
      .eq("room_id", input.identity.roomId)
      .eq("generation_id", input.identity.generationId)
      .eq("original_sha256", input.identity.originalSha256)
      .eq("original_width", input.identity.originalWidth)
      .eq("original_height", input.identity.originalHeight)
      .eq("vocabulary_profile", input.identity.vocabularyProfile)
      .maybeSingle();
    if (error || !data || !Number.isInteger(Number(data.revision))) return null;
    return Number(data.revision);
  }
}

type SnapshotRow = Readonly<{
  id: string;
  payload: string;
  payload_sha256: string;
  roomId: string;
  generationId: string;
  originalSha256: string;
  originalWidth: number;
  originalHeight: number;
  vocabularyProfile: BringForwardVocabularyProfile;
}>;

function sameIdentity(snapshot: SnapshotRow, identity: BringForwardStoredIdentity): boolean {
  return snapshot.roomId === identity.roomId
    && snapshot.generationId === identity.generationId
    && snapshot.originalSha256 === identity.originalSha256
    && snapshot.originalWidth === identity.originalWidth
    && snapshot.originalHeight === identity.originalHeight
    && snapshot.vocabularyProfile === identity.vocabularyProfile;
}

function isUnique(error: { code?: string | number } | null): boolean {
  return error?.code === "23505" || error?.code === 23505;
}
