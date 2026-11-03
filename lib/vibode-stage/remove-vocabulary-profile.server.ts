import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { durableArtifactBytesMatch } from "@/lib/afc-v2-production/production-artifact-integrity";
import {
  parseRoomId,
  productionAfcJson,
} from "@/lib/afc-v2-production/production-http";
import { assertProductionPayloadPrivacy } from "@/lib/afc-v2-production/privacy";
import type {
  AfcGenerationRecord,
  AfcRoomPointer,
} from "@/lib/afc-v2-production/production-store";
import type { RemoveVocabularyChoice } from "@/lib/vibode-stage/remove-vocabulary-profile";

export const REMOVE_VOCABULARY_PROFILE_COLUMN = "remove_vocabulary_profile" as const;
export const REMOVE_VOCABULARY_ORIGINAL_SHA_COLUMN = "remove_vocabulary_original_sha256" as const;

const BODY_BYTES = 4096;

export type RemoveVocabularyProfileStore = Readonly<{
  getRoom: (roomId: string) => Promise<AfcRoomPointer | null>;
  getGeneration: (generationId: string) => Promise<AfcGenerationRecord | null>;
}>;

export type RemoveVocabularyOriginalLoad =
  | Readonly<{ ok: true; bytes: Uint8Array }>
  | Readonly<{ ok: false }>;

export type RemoveVocabularyStoredProfile =
  | Readonly<{ ok: true; profile: string | null; originalSha256: string | null }>
  | Readonly<{ ok: false; code: "unavailable" | "not_found" }>;

export type RemoveVocabularyProfileWrite =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; code: "conflict" | "unavailable" }>;

export type RemoveVocabularyProfileDeps = Readonly<{
  getActor: () => Promise<{ id: string } | null>;
  createStore: () => RemoveVocabularyProfileStore | null;
  loadOriginal: (
    input: Readonly<{ userId: string; room: AfcRoomPointer }>,
  ) => Promise<RemoveVocabularyOriginalLoad>;
  readProfile: (input: Readonly<{
    userId: string;
    roomId: string;
  }>) => Promise<RemoveVocabularyStoredProfile>;
  writeProfile: (input: Readonly<{
    userId: string;
    roomId: string;
    generationId: string;
    profile: RemoveVocabularyChoice;
    originalSha256: string;
  }>) => Promise<RemoveVocabularyProfileWrite>;
}>;

type VerifiedOriginal = Readonly<{
  room: AfcRoomPointer;
  generation: AfcGenerationRecord;
  sha256: string;
}>;

export async function readStoredRemoveVocabularyProfile(
  supabase: SupabaseClient,
  input: Readonly<{ userId: string; roomId: string }>,
): Promise<RemoveVocabularyStoredProfile> {
  const { data, error } = await supabase
    .from("vibode_rooms")
    .select(`user_id, ${REMOVE_VOCABULARY_PROFILE_COLUMN}, ${REMOVE_VOCABULARY_ORIGINAL_SHA_COLUMN}`)
    .eq("id", input.roomId)
    .maybeSingle();
  if (error) return { ok: false, code: "unavailable" };
  if (!data || data.user_id !== input.userId) return { ok: false, code: "not_found" };
  return {
    ok: true,
    profile: typeof data.remove_vocabulary_profile === "string" || data.remove_vocabulary_profile === null
      ? data.remove_vocabulary_profile
      : null,
    originalSha256: typeof data.remove_vocabulary_original_sha256 === "string"
      || data.remove_vocabulary_original_sha256 === null
      ? data.remove_vocabulary_original_sha256
      : null,
  };
}

export async function writeStoredRemoveVocabularyProfile(
  supabase: SupabaseClient,
  input: Readonly<{
    userId: string;
    roomId: string;
    generationId: string;
    profile: RemoveVocabularyChoice;
    originalSha256: string;
  }>,
): Promise<RemoveVocabularyProfileWrite> {
  const { data, error } = await supabase
    .from("vibode_rooms")
    .update({
      [REMOVE_VOCABULARY_PROFILE_COLUMN]: input.profile,
      [REMOVE_VOCABULARY_ORIGINAL_SHA_COLUMN]: input.originalSha256.toLowerCase(),
    })
    .eq("id", input.roomId)
    .eq("user_id", input.userId)
    .eq("current_afc_generation_id", input.generationId)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, code: "unavailable" };
  if (!data) return { ok: false, code: "conflict" };
  return { ok: true };
}

export async function handleRemoveVocabularyProfileGet(
  request: Request,
  deps: RemoveVocabularyProfileDeps,
): Promise<Response> {
  const roomId = parseRoomId(new URL(request.url).searchParams.get("roomId"));
  if (!roomId) return jsonError("Request is invalid.", 400);
  const actor = await deps.getActor();
  if (!actor) return jsonError("Sign in required.", 403);
  const store = deps.createStore();
  if (!store) return jsonError("Remove vocabulary is unavailable.", 503);
  const room = await store.getRoom(roomId);
  if (!room || room.userId !== actor.id) return jsonError("Room not found.", 404);
  const stored = await deps.readProfile({ userId: actor.id, roomId });
  if (!stored.ok) {
    if (stored.code === "not_found") return jsonError("Room not found.", 404);
    return jsonError("Remove vocabulary is unavailable.", 503);
  }
  const generation = room.currentAfcGenerationId
    ? await store.getGeneration(room.currentAfcGenerationId)
    : null;
  const currentSha = currentOriginalSha(generation, roomId, actor.id);
  return jsonOk(profileResponse(stored.profile, stored.originalSha256, currentSha));
}

export async function handleRemoveVocabularyProfilePost(
  request: Request,
  deps: RemoveVocabularyProfileDeps,
): Promise<Response> {
  const parsed = await readWrite(request);
  if (parsed === "too-large" || parsed === "invalid") return jsonError("Request body is invalid.", 400);
  const actor = await deps.getActor();
  if (!actor) return jsonError("Sign in required.", 403);
  const store = deps.createStore();
  if (!store) return jsonError("Remove vocabulary is unavailable.", 503);

  const verified = await verifyCurrentOriginal(store, deps, actor.id, parsed.roomId);
  if (!verified.ok) return jsonError(verified.reason, verified.status);
  const written = await deps.writeProfile({
    userId: actor.id,
    roomId: parsed.roomId,
    generationId: verified.generation.id,
    profile: parsed.profile,
    originalSha256: verified.sha256,
  });
  if (!written.ok) {
    if (written.code === "conflict") {
      const again = await store.getRoom(parsed.roomId);
      if (!again || again.userId !== actor.id) return jsonError("Room not found.", 404);
      if (again.currentAfcGenerationId !== verified.generation.id) {
        return jsonError("The room image changed. Choose the vocabulary again.", 409);
      }
    }
    return jsonError("Remove vocabulary is unavailable.", 503);
  }
  return jsonOk({ profile: parsed.profile, bound: true });
}

async function verifyCurrentOriginal(
  store: RemoveVocabularyProfileStore,
  deps: RemoveVocabularyProfileDeps,
  userId: string,
  roomId: string,
): Promise<
  | Readonly<{ ok: true } & VerifiedOriginal>
  | Readonly<{ ok: false; status: number; reason: string }>
> {
  const room = await store.getRoom(roomId);
  if (!room || room.userId !== userId) return { ok: false, status: 404, reason: "Room not found." };
  const generation = room.currentAfcGenerationId
    ? await store.getGeneration(room.currentAfcGenerationId)
    : null;
  if (
    !generation
    || generation.userId !== userId
    || generation.roomId !== roomId
    || generation.id !== room.currentAfcGenerationId
    || generation.status !== "ready"
  ) {
    return { ok: false, status: 404, reason: "Authoritative ORIGINAL image is unavailable." };
  }
  const identity = originalIdentity(generation);
  if (!identity) return { ok: false, status: 404, reason: "Authoritative ORIGINAL image is unavailable." };
  const loaded = await deps.loadOriginal({ userId, room });
  if (!loaded.ok || !durableArtifactBytesMatch({
    bytes: loaded.bytes,
    sha256: identity.sha256,
    byteCount: identity.byteCount,
  })) {
    return { ok: false, status: 404, reason: "Authoritative ORIGINAL image is unavailable." };
  }
  return { ok: true, room, generation, sha256: identity.sha256 };
}

function currentOriginalSha(
  generation: AfcGenerationRecord | null,
  roomId: string,
  userId: string,
): string | null {
  if (
    !generation
    || generation.userId !== userId
    || generation.roomId !== roomId
    || generation.status !== "ready"
  ) {
    return null;
  }
  return originalIdentity(generation)?.sha256 ?? null;
}

function originalIdentity(generation: AfcGenerationRecord): Readonly<{
  sha256: string;
  byteCount: number;
}> | null {
  const original = generation.original;
  if (!original || original.orientation !== 1) return null;
  if (original.mimeType !== "image/jpeg" && original.mimeType !== "image/png" && original.mimeType !== "image/webp") {
    return null;
  }
  const sha256 = original.sha256.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) return null;
  return { sha256, byteCount: original.byteCount };
}

function profileResponse(
  profile: string | null,
  originalSha256: string | null,
  currentSha: string | null,
): { profile: RemoveVocabularyChoice | null; bound: boolean } {
  const saved = profile === "default" || profile === "bedroom" ? profile : null;
  const stored = typeof originalSha256 === "string" ? originalSha256.toLowerCase() : "";
  const bound = saved !== null && currentSha !== null && stored === currentSha;
  return { profile: saved, bound };
}

async function readWrite(
  request: Request,
): Promise<{ roomId: string; profile: RemoveVocabularyChoice } | "invalid" | "too-large"> {
  const bytes = await readBoundedBody(request, BODY_BYTES);
  if (bytes === "too-large") return "too-large";
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return "invalid";
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "invalid";
  const keys = Object.keys(payload);
  if (keys.length !== 2 || !keys.includes("roomId") || !keys.includes("profile")) return "invalid";
  const record = payload as { roomId?: unknown; profile?: unknown };
  const roomId = parseRoomId(record.roomId);
  if (!roomId || (record.profile !== "default" && record.profile !== "bedroom")) return "invalid";
  return { roomId, profile: record.profile };
}

async function readBoundedBody(request: Request, maxBytes: number): Promise<Uint8Array | "too-large"> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return "too-large";
  if (!request.body) {
    const text = await request.text();
    if (text.length > maxBytes) return "too-large";
    return new TextEncoder().encode(text);
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    total += step.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return "too-large";
    }
    chunks.push(step.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function jsonError(reason: string, status: number) {
  const body = { usable: false as const, reason };
  assertProductionPayloadPrivacy(body);
  return productionAfcJson(body, status);
}

function jsonOk(body: { profile: RemoveVocabularyChoice | null; bound: boolean }) {
  assertProductionPayloadPrivacy(body);
  return productionAfcJson(body, 200);
}
