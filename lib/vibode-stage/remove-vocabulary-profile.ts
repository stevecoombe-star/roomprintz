/**
 * Browser-safe REMOVE vocabulary choice.
 *
 * The scan request stays `{ roomId, generationId }`. This module saves an
 * explicit profile and decides when that save may start one new scan.
 */

export const REMOVE_VOCABULARY_PROFILE_PATH = "/api/vibode/admin/remove-vocabulary" as const;

export const REMOVE_VOCABULARY_SCAN_CONFIRMATION =
  "A new detection scan uses one reservation." as const;

export const REMOVE_VOCABULARY_SAVE_ERROR = "The vocabulary could not be saved." as const;

export const REMOVE_VOCABULARY_CHOICES = Object.freeze(["default", "bedroom"] as const);

export type RemoveVocabularyChoice = (typeof REMOVE_VOCABULARY_CHOICES)[number];

export type RemoveVocabularyProfileResponse = Readonly<{
  profile: RemoveVocabularyChoice | null;
  bound: boolean;
}>;

export type RemoveVocabularyConfirmState =
  | Readonly<{ phase: "idle" }>
  | Readonly<{ phase: "confirming"; requested: RemoveVocabularyChoice }>
  | Readonly<{ phase: "saving"; requested: RemoveVocabularyChoice }>
  | Readonly<{ phase: "error"; message: string }>;

export function initialRemoveVocabularyConfirmState(): RemoveVocabularyConfirmState {
  return { phase: "idle" };
}

/** Missing, unbound, and stale records display Default. */
export function displayedRemoveVocabularyChoice(
  view: RemoveVocabularyProfileResponse | null,
): RemoveVocabularyChoice {
  if (view?.bound === true && (view.profile === "default" || view.profile === "bedroom")) {
    return view.profile;
  }
  return "default";
}

export function requestRemoveVocabularyChange(
  state: RemoveVocabularyConfirmState,
  input: Readonly<{
    displayed: RemoveVocabularyChoice;
    requested: RemoveVocabularyChoice;
  }>,
): RemoveVocabularyConfirmState {
  if (state.phase === "saving") return state;
  if (input.requested === input.displayed) return { phase: "idle" };
  return { phase: "confirming", requested: input.requested };
}

export function removeVocabularyProfileRequestBody(
  roomId: string,
  profile: RemoveVocabularyChoice,
): string {
  return JSON.stringify({ roomId, profile });
}

export function readRemoveVocabularyProfileResponse(
  payload: unknown,
): RemoveVocabularyProfileResponse | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const keys = Object.keys(payload);
  if (keys.length !== 2 || !keys.includes("profile") || !keys.includes("bound")) return null;
  const record = payload as { profile?: unknown; bound?: unknown };
  if (record.bound !== true && record.bound !== false) return null;
  if (record.profile !== null && record.profile !== "default" && record.profile !== "bedroom") {
    return null;
  }
  return { profile: record.profile, bound: record.bound };
}

export function applyRemoveVocabularySave(input: Readonly<{
  requested: RemoveVocabularyChoice;
  result: Readonly<{ ok: true; profile: RemoveVocabularyChoice; bound: true } | { ok: false; reason: string }>;
}>): Readonly<{ scan: boolean; view: RemoveVocabularyProfileResponse | null }> {
  if (!input.result.ok || input.result.profile !== input.requested || input.result.bound !== true) {
    return { scan: false, view: null };
  }
  return {
    scan: true,
    view: { profile: input.result.profile, bound: true },
  };
}

export async function requestRemoveVocabularyProfile(input: Readonly<{
  roomId: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}>): Promise<RemoveVocabularyProfileResponse | null> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(
    `${REMOVE_VOCABULARY_PROFILE_PATH}?roomId=${encodeURIComponent(input.roomId)}`,
    { method: "GET", credentials: "same-origin", cache: "no-store", signal: input.signal },
  );
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  return readRemoveVocabularyProfileResponse(payload);
}

export async function saveRemoveVocabularyProfile(input: Readonly<{
  roomId: string;
  profile: RemoveVocabularyChoice;
  fetchImpl?: typeof fetch;
}>): Promise<
  | Readonly<{ ok: true; profile: RemoveVocabularyChoice; bound: true }>
  | Readonly<{ ok: false; reason: string }>
> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(REMOVE_VOCABULARY_PROFILE_PATH, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: removeVocabularyProfileRequestBody(input.roomId, input.profile),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const reason = payload && typeof payload === "object" && !Array.isArray(payload)
      && typeof (payload as { reason?: unknown }).reason === "string"
      ? (payload as { reason: string }).reason
      : REMOVE_VOCABULARY_SAVE_ERROR;
    return { ok: false, reason };
  }
  const view = readRemoveVocabularyProfileResponse(payload);
  if (!view || view.profile !== input.profile || view.bound !== true) {
    return { ok: false, reason: REMOVE_VOCABULARY_SAVE_ERROR };
  }
  return { ok: true, profile: input.profile, bound: true };
}
