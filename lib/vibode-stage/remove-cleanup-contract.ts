/**
 * REMOVE-2B Clean Up input contract.
 *
 * Browser-safe. This module builds the export request, the prompt, and the
 * overlay pixels. It does not call Roboflow, an image model, or storage.
 *
 * Packed bits use the REMOVE identity-mask order: row-major pixels, the
 * least significant bit of each byte first. That is the same order as
 * `packRemoveMask`. Interactive Mask Expansion is not an input.
 *
 * Client-submitted masks are checked later for internal consistency only.
 * They are not proof that Roboflow produced them.
 */

export const REMOVE_CLEANUP_EXPORT_VERSION = "remove-cleanup-export/v1" as const;
export const REMOVE_CLEANUP_PROMPT_VERSION = "remove-cleanup-prompt/v1" as const;
export const REMOVE_CLEANUP_PROMPT_FILE = "prompt.txt" as const;
export const REMOVE_CLEANUP_MANIFEST_FILE = "manifest.json" as const;
export const REMOVE_CLEANUP_OVERLAY_FILE = "02-selected-overlay.png" as const;
export const REMOVE_CLEANUP_DIAGNOSTIC_FILE = "03-selected-mask.png" as const;
export const REMOVE_CLEANUP_EXPORT_PATH = "/api/vibode/admin/remove-cleanup-export" as const;
export const REMOVE_CLEANUP_ZIP_NAME = "vibode-cleanup-inputs.zip" as const;

export const REMOVE_CLEANUP_PROVIDER_ID = "roboflow" as const;
export const REMOVE_CLEANUP_MODEL_ID = "sam3/sam3_final" as const;
export const REMOVE_CLEANUP_CONCEPT_SET = "remove-segmentation-concepts/v1" as const;
export const REMOVE_CLEANUP_SCHEMA =
  "roboflow-serverless-concept-segment-polygon/0.64.4" as const;
export const REMOVE_CLEANUP_COORDINATE_BASIS = "original-decoded-pixels-v1" as const;

export const REMOVE_CLEANUP_FILL_OPACITY = 0.45;
export const REMOVE_CLEANUP_MAGENTA = Object.freeze({
  red: 255,
  green: 0,
  blue: 255,
  hex: "#FF00FF",
});
export const REMOVE_CLEANUP_REFERENCE_EXPANSION_PX = 0;
export const REMOVE_CLEANUP_OUTLINE = "none" as const;

export const REMOVE_CLEANUP_EXCLUSION_COPY =
  "Only objects hidden in Objects mode are included. Brush edits are not included.";

export const REMOVE_CLEANUP_MASK_PROVENANCE = "client-submitted-packed-masks" as const;
export const REMOVE_CLEANUP_MASK_PROVENANCE_LIMITATION =
  "Client-submitted masks are checked for internal consistency with their ids and digests. They are not cryptographically authenticated as Roboflow outputs.";

export type RemoveCleanupSnapshotObject = Readonly<{
  id: string;
  concept: string;
  confidence: number;
  width: number;
  height: number;
  bits: Uint8Array;
}>;

export type RemoveCleanupFlightIdentity = Readonly<{
  roomId: string;
  generationId: string;
  sessionSerial: number;
  requestSerial: number;
}>;

export type RemoveCleanupUiPhase = "idle" | "confirming" | "exporting";

export type RemoveCleanupUiState = Readonly<{
  phase: RemoveCleanupUiPhase;
  flightId: number;
  error: string | null;
}>;

const INITIAL_UI: RemoveCleanupUiState = Object.freeze({
  phase: "idle",
  flightId: 0,
  error: null,
});

export function initialRemoveCleanupUiState(): RemoveCleanupUiState {
  return INITIAL_UI;
}

export function hiddenRemoveCleanupObjects<T extends Readonly<{
  id: string;
  eligibility: Readonly<{ eligible: boolean }>;
}>>(
  objects: readonly T[],
  selectedIds: ReadonlySet<string>,
): T[] {
  return objects
    .filter((object) => object.eligibility.eligible && selectedIds.has(object.id))
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

export function snapshotRemoveCleanupObjects<T extends Readonly<{
  id: string;
  concept: string;
  confidence: number;
  mask: Readonly<{ width: number; height: number; bits: Uint8Array }>;
}>>(objects: readonly T[]): RemoveCleanupSnapshotObject[] {
  return objects.map((object) => ({
    id: object.id,
    concept: object.concept,
    confidence: object.confidence,
    width: object.mask.width,
    height: object.mask.height,
    bits: Uint8Array.from(object.mask.bits),
  }));
}

export function removeCleanupExportAvailability(input: Readonly<{
  segmentationPhase: "idle" | "loading" | "ready" | "error";
  hiddenCount: number;
  exporting: boolean;
}>): boolean {
  return input.segmentationPhase === "ready" && input.hiddenCount > 0 && input.exporting !== true;
}

export function removeCleanupExportLabel(hiddenCount: number): string {
  return hiddenCount > 0
    ? `Export Clean Up Inputs (${hiddenCount})`
    : "Export Clean Up Inputs";
}

export function removeCleanupConfirmationSummary(
  objects: readonly Readonly<{ concept: string }>[],
): string {
  const count = objects.length;
  const noun = count === 1 ? "object" : "objects";
  const concepts = objects.map((object) => object.concept).join(", ");
  return `Export ${count} hidden ${noun}: ${concepts}.`;
}

export function openRemoveCleanupConfirmation(
  state: RemoveCleanupUiState,
  available: boolean,
): RemoveCleanupUiState {
  if (!available || state.phase === "exporting") return state;
  if (state.phase === "confirming" && state.error === null) return state;
  return { phase: "confirming", flightId: state.flightId, error: null };
}

export function cancelRemoveCleanupConfirmation(
  state: RemoveCleanupUiState,
): RemoveCleanupUiState {
  if (state.phase === "exporting") return state;
  if (state.phase === "idle" && state.error === null) return state;
  return { phase: "idle", flightId: state.flightId, error: null };
}

export function beginRemoveCleanupDownload(input: Readonly<{
  state: RemoveCleanupUiState;
  claimed: boolean;
}>): Readonly<{ state: RemoveCleanupUiState; claimed: boolean; begin: boolean }> {
  if (input.claimed || input.state.phase !== "confirming") {
    return { state: input.state, claimed: input.claimed, begin: false };
  }
  const flightId = input.state.flightId + 1;
  return {
    claimed: true,
    begin: true,
    state: { phase: "exporting", flightId, error: null },
  };
}

export function finishRemoveCleanupExport(
  state: RemoveCleanupUiState,
  flightId: number,
  outcome: Readonly<{ ok: true } | { ok: false; reason: string } | { ignored: true }>,
): RemoveCleanupUiState {
  if (state.phase !== "exporting" || state.flightId !== flightId) return state;
  if ("ignored" in outcome) return { phase: "idle", flightId, error: null };
  if (outcome.ok) return { phase: "idle", flightId, error: null };
  return { phase: "idle", flightId, error: outcome.reason };
}

export function sameRemoveCleanupFlight(
  flight: RemoveCleanupFlightIdentity,
  current: RemoveCleanupFlightIdentity | null,
): boolean {
  if (!current) return false;
  return flight.roomId === current.roomId
    && flight.generationId === current.generationId
    && flight.sessionSerial === current.sessionSerial
    && flight.requestSerial === current.requestSerial;
}

export function removeCleanupObjectPhrase(input: Readonly<{
  concept: string;
  bounds: Readonly<{ x: number; y: number; width: number; height: number }>;
  width: number;
  height: number;
}>): string {
  const cx = input.bounds.x + input.bounds.width / 2;
  const cy = input.bounds.y + input.bounds.height / 2;
  const horizontal = cx < input.width / 3
    ? "left"
    : cx > (input.width * 2) / 3
      ? "right"
      : "centre";
  const vertical = cy < input.height / 3
    ? "upper"
    : cy > (input.height * 2) / 3
      ? "lower"
      : "middle";
  if (horizontal === "centre" && vertical === "middle") {
    return `${input.concept} near the centre of the photograph`;
  }
  if (vertical === "middle") {
    return `${input.concept} on the ${horizontal} side of the photograph`;
  }
  if (horizontal === "centre") {
    return `${input.concept} in the ${vertical} part of the photograph`;
  }
  return `${input.concept} in the ${vertical}-${horizontal} of the photograph`;
}

export function renderRemoveCleanupPrompt(phrases: readonly string[]): string {
  const list = phrases.join("; ");
  return [
    "Image 1 is the authoritative original room photograph. Image 2 is the same photograph with the objects to remove highlighted in bright magenta.",
    "",
    "Remove only the magenta-highlighted objects from Image 1. Naturally reconstruct the rug, flooring, walls and other background surfaces behind them so the room looks as if those objects had never been there.",
    "",
    "Preserve every unhighlighted piece of furniture and décor. Preserve the original architecture, walls, windows, doors, trim, floor, ceiling, materials, lighting, camera framing and perspective. Do not move, replace, restyle, redesign or add objects.",
    "",
    `The highlighted objects are: ${list}.`,
    "",
    "If the descriptive text and magenta highlights disagree, follow the magenta highlights.",
    "",
    "Return one realistic photograph of the same room, without magenta markings, outlines, labels or other annotations.",
    "",
  ].join("\n");
}

export function mixRemoveCleanupChannel(source: number, target: number): number {
  const keep = 1 - REMOVE_CLEANUP_FILL_OPACITY;
  return Math.round(source * keep + target * REMOVE_CLEANUP_FILL_OPACITY);
}

export function blendRemoveCleanupRgb(input: Readonly<{
  rgb: Uint8Array;
  width: number;
  height: number;
  masks: readonly Uint8Array[];
}>): Readonly<{
  overlay: Uint8Array;
  diagnostic: Uint8Array;
  unionPixels: number;
}> | null {
  const pixels = input.width * input.height;
  if (!Number.isInteger(input.width) || !Number.isInteger(input.height) || pixels < 1) return null;
  if (input.rgb.length !== pixels * 3) return null;
  const packedLength = Math.ceil(pixels / 8);
  if (input.masks.length === 0) return null;
  for (const mask of input.masks) {
    if (mask.length !== packedLength) return null;
  }
  const overlay = new Uint8Array(input.rgb.length);
  const diagnostic = new Uint8Array(input.rgb.length);
  let unionPixels = 0;
  for (let index = 0; index < pixels; index += 1) {
    let covered = false;
    for (const mask of input.masks) {
      if (packedBit(mask, index)) {
        covered = true;
        break;
      }
    }
    const offset = index * 3;
    if (!covered) {
      overlay[offset] = input.rgb[offset] ?? 0;
      overlay[offset + 1] = input.rgb[offset + 1] ?? 0;
      overlay[offset + 2] = input.rgb[offset + 2] ?? 0;
      continue;
    }
    unionPixels += 1;
    overlay[offset] = mixRemoveCleanupChannel(input.rgb[offset] ?? 0, REMOVE_CLEANUP_MAGENTA.red);
    overlay[offset + 1] = mixRemoveCleanupChannel(input.rgb[offset + 1] ?? 0, REMOVE_CLEANUP_MAGENTA.green);
    overlay[offset + 2] = mixRemoveCleanupChannel(input.rgb[offset + 2] ?? 0, REMOVE_CLEANUP_MAGENTA.blue);
    diagnostic[offset] = 255;
    diagnostic[offset + 1] = 255;
    diagnostic[offset + 2] = 255;
  }
  return { overlay, diagnostic, unionPixels };
}

export async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return hex(new Uint8Array(digest));
}

export function encodePackedBits(bits: Uint8Array): string {
  let binary = "";
  const stride = 0x8000;
  for (let offset = 0; offset < bits.length; offset += stride) {
    const chunk = bits.subarray(offset, Math.min(bits.length, offset + stride));
    let piece = "";
    for (const byte of chunk) piece += String.fromCharCode(byte);
    binary += piece;
  }
  return btoa(binary);
}

export async function buildRemoveCleanupExportBody(input: Readonly<{
  roomId: string;
  generationId: string;
  originalSha256: string;
  originalDecodedWidth: number;
  originalDecodedHeight: number;
  objects: readonly RemoveCleanupSnapshotObject[];
}>): Promise<string> {
  const selectedObjects = [];
  for (const object of input.objects) {
    selectedObjects.push({
      id: object.id,
      concept: object.concept,
      confidence: object.confidence,
      maskSha256: await sha256HexBytes(object.bits),
      bits: encodePackedBits(object.bits),
    });
  }
  return JSON.stringify({
    roomId: input.roomId,
    generationId: input.generationId,
    originalSha256: input.originalSha256,
    originalDecodedWidth: input.originalDecodedWidth,
    originalDecodedHeight: input.originalDecodedHeight,
    provider: REMOVE_CLEANUP_PROVIDER_ID,
    modelId: REMOVE_CLEANUP_MODEL_ID,
    conceptSet: REMOVE_CLEANUP_CONCEPT_SET,
    schema: REMOVE_CLEANUP_SCHEMA,
    coordinateBasis: REMOVE_CLEANUP_COORDINATE_BASIS,
    referenceExpansionPx: REMOVE_CLEANUP_REFERENCE_EXPANSION_PX,
    selectedObjects,
  });
}

export async function requestRemoveCleanupExport(input: Readonly<{
  body: string;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
}>): Promise<
  | Readonly<{ ok: true; bytes: Uint8Array; fileName: string }>
  | Readonly<{ ok: false; reason: string }>
> {
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(REMOVE_CLEANUP_EXPORT_PATH, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: input.body,
      signal: input.signal,
    });
  } catch {
    return { ok: false, reason: "Clean Up export did not respond." };
  }
  const type = response.headers.get("content-type") ?? "";
  if (response.ok && type.includes("application/zip")) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) return { ok: false, reason: "Clean Up export was empty." };
    return {
      ok: true,
      bytes,
      fileName: zipFileName(response.headers.get("content-disposition")),
    };
  }
  const payload = await response.json().catch(() => null) as { reason?: unknown } | null;
  const reason = payload && typeof payload.reason === "string" ? payload.reason.trim() : "";
  return { ok: false, reason: reason || "Clean Up export failed." };
}

export function saveRemoveCleanupZip(fileName: string, bytes: Uint8Array): void {
  if (typeof document === "undefined") return;
  const blob = new Blob(
    [bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer],
    { type: "application/zip" },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function packedBit(bits: Uint8Array, index: number): boolean {
  return ((bits[index >> 3] ?? 0) & (1 << (index & 7))) !== 0;
}

function hex(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += byte.toString(16).padStart(2, "0");
  return text;
}

function zipFileName(disposition: string | null): string {
  const match = /filename="([A-Za-z0-9._-]+)"/.exec(disposition ?? "");
  return match?.[1] ?? REMOVE_CLEANUP_ZIP_NAME;
}
