import "server-only";

import { NextResponse } from "next/server";

import { classifyAfcR3cImagePairCompatibility } from "@/app/admin/3d-room-lab/research/afc-r3c-image-pair-compatibility";
import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import {
  isAfcV2ProductionRoomAuthority,
  type AfcV2ProductionRoomAuthority,
} from "@/lib/afc-v2-production/production-authority-contract";
import { buildProductionPerspectiveCamera } from "@/lib/afc-v2-runtime/frozen-camera";
import { realizeProductionWorld } from "@/lib/afc-v2-runtime/production-world";
import { AFC_V2_RUNTIME_FLOOR_PLANE_Y } from "@/lib/afc-v2-runtime/types";
import {
  AFC_ADMIN_COLLISION_IMAGE_CLIP_MAX,
  AFC_ADMIN_COLLISION_IMAGE_CLIP_MIN,
  AFC_ADMIN_WORLD_TO_IMAGE_PROJECTION_VERSION,
  projectWorldSegmentToNormalizedImage,
} from "@/lib/afc-v2-runtime/world-to-image-projection";

import {
  authorizeAfcDiagnosticsAdmin,
  type AfcDiagnosticsAdminAuth,
  type AuthorizeAfcDiagnosticsAdminOptions,
} from "./admin-auth.server";
import { parseAfcDiagnosticAdminUuid } from "./admin-read-model";
import { AFC_GENERATION_TABLE } from "./admin-read-model.server";
import {
  type AfcDiagnosticFilterQuery,
  type AfcDiagnosticSelectHead,
  type AfcDiagnosticTableClient,
} from "./diagnostic-db-client";
import {
  AFC_DIAGNOSTIC_CASE_TABLE,
  AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE,
  AFC_DIAGNOSTIC_SESSION_TABLE,
} from "./contracts";
import {
  AFC_DIAGNOSTIC_VISUAL_CASE_COLUMNS,
  AFC_DIAGNOSTIC_VISUAL_MEMBERSHIP_COLUMNS,
  AFC_DIAGNOSTIC_VISUAL_SESSION_COLUMNS,
  AfcDiagnosticVisualInputError,
  AfcDiagnosticVisualNotFoundError,
  AfcDiagnosticVisualStoreError,
  parseAfcDiagnosticVisualArtifactKind,
  resolveAfcDiagnosticVisualMembershipContext,
  type AfcDiagnosticVisualArtifactKind,
  type AfcDiagnosticVisualCaseRecord,
  type AfcDiagnosticVisualMembershipRecord,
  type AfcDiagnosticVisualMembershipStore,
  type AfcDiagnosticVisualSessionRecord,
} from "./admin-visual-evidence.server";

export const AFC_ADMIN_VISUAL_OVERLAY_VERSION =
  "afc-admin-visual-overlay/v1" as const;

export const AFC_ADMIN_VISUAL_OVERLAY_PROJECTION_VERSION =
  AFC_ADMIN_WORLD_TO_IMAGE_PROJECTION_VERSION;

export const AFC_ADMIN_VISUAL_OVERLAY_FLOOR_SPACE =
  "source-normalized/v1" as const;

export {
  AFC_ADMIN_COLLISION_IMAGE_CLIP_MAX,
  AFC_ADMIN_COLLISION_IMAGE_CLIP_MIN,
};

export const AFC_DIAGNOSTIC_VISUAL_OVERLAY_GENERATION_COLUMNS = [
  "id",
  "room_id",
  "user_id",
  "status",
  "production_authority",
  "frame_width",
  "frame_height",
  "original_sha256",
  "original_decoded_width",
  "original_decoded_height",
  "original_orientation",
  "empty_sha256",
  "empty_decoded_width",
  "empty_decoded_height",
  "empty_orientation",
  "tiled_sha256",
  "tiled_decoded_width",
  "tiled_decoded_height",
  "tiled_orientation",
].join(", ");

export type AfcAdminVisualOverlayPoint = Readonly<{
  x: number;
  y: number;
}>;

export type AfcAdminVisualOverlayFloorQuad = Readonly<{
  space: typeof AFC_ADMIN_VISUAL_OVERLAY_FLOOR_SPACE;
  points: readonly AfcAdminVisualOverlayPoint[];
}>;

export type AfcAdminVisualOverlayCollisionEdge = Readonly<{
  id: string;
  points: readonly AfcAdminVisualOverlayPoint[];
}>;

export type AfcAdminVisualOverlayV1 = Readonly<{
  version: typeof AFC_ADMIN_VISUAL_OVERLAY_VERSION;
  projectionVersion: typeof AFC_ADMIN_VISUAL_OVERLAY_PROJECTION_VERSION;
  artifactBasis: AfcDiagnosticVisualArtifactKind;
  frame: Readonly<{
    width: number;
    height: number;
  }>;
  floorQuad: AfcAdminVisualOverlayFloorQuad | null;
  collisionEdges: readonly AfcAdminVisualOverlayCollisionEdge[];
}>;

export type AfcDiagnosticVisualOverlayGenerationRecord = Readonly<{
  id: string;
  roomId: string;
  userId: string;
  status: string | null;
  productionAuthority: unknown;
  frameWidth: number | null;
  frameHeight: number | null;
  originalSha256: string | null;
  originalDecodedWidth: number | null;
  originalDecodedHeight: number | null;
  originalOrientation: number | null;
  emptySha256: string | null;
  emptyDecodedWidth: number | null;
  emptyDecodedHeight: number | null;
  emptyOrientation: number | null;
  tiledSha256: string | null;
  tiledDecodedWidth: number | null;
  tiledDecodedHeight: number | null;
  tiledOrientation: number | null;
}>;

export type AfcDiagnosticVisualOverlayStore =
  AfcDiagnosticVisualMembershipStore<AfcDiagnosticVisualOverlayGenerationRecord>;

export type AfcDiagnosticVisualOverlayLog = Readonly<{
  caseId: string;
  generationId: string;
  artifact: AfcDiagnosticVisualArtifactKind | string;
  reason: string;
}>;

type OverlayFilter<S> = AfcDiagnosticFilterQuery<S, "eq" | "maybeSingle">;

type OverlayDbClient<S extends OverlayFilter<S>> = AfcDiagnosticTableClient<
  AfcDiagnosticSelectHead<S>
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function optionalFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positiveDimension(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function postgresError(error: unknown): never {
  void error;
  throw new AfcDiagnosticVisualStoreError();
}

function parseCaseRow(row: unknown): AfcDiagnosticVisualCaseRecord | null {
  if (!isRecord(row)) return null;
  const id = parseAfcDiagnosticAdminUuid(row.id);
  const sessionId = parseAfcDiagnosticAdminUuid(row.session_id);
  const roomId = parseAfcDiagnosticAdminUuid(row.room_id);
  if (!id || !sessionId || !roomId) return null;
  return Object.freeze({ id, sessionId, roomId });
}

function parseSessionRow(
  row: unknown,
): AfcDiagnosticVisualSessionRecord | null {
  if (!isRecord(row)) return null;
  const id = parseAfcDiagnosticAdminUuid(row.id);
  const roomId = parseAfcDiagnosticAdminUuid(row.room_id);
  const userId = parseAfcDiagnosticAdminUuid(row.user_id);
  if (!id || !roomId || !userId) return null;
  const baseAssetId =
    row.base_asset_id == null
      ? null
      : parseAfcDiagnosticAdminUuid(row.base_asset_id);
  if (row.base_asset_id != null && !baseAssetId) return null;
  return Object.freeze({ id, roomId, userId, baseAssetId });
}

function parseMembershipRow(
  row: unknown,
): AfcDiagnosticVisualMembershipRecord | null {
  if (!isRecord(row)) return null;
  const sessionId = parseAfcDiagnosticAdminUuid(row.session_id);
  const generationId = parseAfcDiagnosticAdminUuid(row.generation_id);
  if (!sessionId || !generationId) return null;
  return Object.freeze({ sessionId, generationId });
}

function parseGenerationRow(
  row: unknown,
): AfcDiagnosticVisualOverlayGenerationRecord | null {
  if (!isRecord(row)) return null;
  const id = parseAfcDiagnosticAdminUuid(row.id);
  const roomId = parseAfcDiagnosticAdminUuid(row.room_id);
  const userId = parseAfcDiagnosticAdminUuid(row.user_id);
  if (!id || !roomId || !userId) return null;
  return Object.freeze({
    id,
    roomId,
    userId,
    status: optionalString(row.status),
    productionAuthority: row.production_authority ?? null,
    frameWidth: optionalFiniteNumber(row.frame_width),
    frameHeight: optionalFiniteNumber(row.frame_height),
    originalSha256: optionalString(row.original_sha256),
    originalDecodedWidth: optionalFiniteNumber(row.original_decoded_width),
    originalDecodedHeight: optionalFiniteNumber(row.original_decoded_height),
    originalOrientation: optionalFiniteNumber(row.original_orientation),
    emptySha256: optionalString(row.empty_sha256),
    emptyDecodedWidth: optionalFiniteNumber(row.empty_decoded_width),
    emptyDecodedHeight: optionalFiniteNumber(row.empty_decoded_height),
    emptyOrientation: optionalFiniteNumber(row.empty_orientation),
    tiledSha256: optionalString(row.tiled_sha256),
    tiledDecodedWidth: optionalFiniteNumber(row.tiled_decoded_width),
    tiledDecodedHeight: optionalFiniteNumber(row.tiled_decoded_height),
    tiledOrientation: optionalFiniteNumber(row.tiled_orientation),
  });
}

export function createSupabaseAfcDiagnosticVisualOverlayStore<
  S extends OverlayFilter<S>,
>(
  supabase: OverlayDbClient<S>,
): AfcDiagnosticVisualOverlayStore {
  return {
    async findCaseById(caseId) {
      const { data, error } = await supabase
        .from(AFC_DIAGNOSTIC_CASE_TABLE)
        .select(AFC_DIAGNOSTIC_VISUAL_CASE_COLUMNS)
        .eq("id", caseId)
        .maybeSingle();
      if (error) postgresError(error);
      if (data == null) return null;
      const parsed = parseCaseRow(data);
      if (!parsed) throw new AfcDiagnosticVisualStoreError();
      return parsed;
    },
    async findSessionById(sessionId) {
      const { data, error } = await supabase
        .from(AFC_DIAGNOSTIC_SESSION_TABLE)
        .select(AFC_DIAGNOSTIC_VISUAL_SESSION_COLUMNS)
        .eq("id", sessionId)
        .maybeSingle();
      if (error) postgresError(error);
      if (data == null) return null;
      const parsed = parseSessionRow(data);
      if (!parsed) throw new AfcDiagnosticVisualStoreError();
      return parsed;
    },
    async findMembership(sessionId, generationId) {
      const { data, error } = await supabase
        .from(AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE)
        .select(AFC_DIAGNOSTIC_VISUAL_MEMBERSHIP_COLUMNS)
        .eq("session_id", sessionId)
        .eq("generation_id", generationId)
        .maybeSingle();
      if (error) postgresError(error);
      if (data == null) return null;
      const parsed = parseMembershipRow(data);
      if (!parsed) throw new AfcDiagnosticVisualStoreError();
      return parsed;
    },
    async findGenerationById(generationId) {
      const { data, error } = await supabase
        .from(AFC_GENERATION_TABLE)
        .select(AFC_DIAGNOSTIC_VISUAL_OVERLAY_GENERATION_COLUMNS)
        .eq("id", generationId)
        .maybeSingle();
      if (error) postgresError(error);
      if (data == null) return null;
      const parsed = parseGenerationRow(data);
      if (!parsed) throw new AfcDiagnosticVisualStoreError();
      return parsed;
    },
  };
}

function storeFromEnv(): AfcDiagnosticVisualOverlayStore {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) throw new AfcDiagnosticVisualStoreError();
  return createSupabaseAfcDiagnosticVisualOverlayStore(supabase);
}

const OVERLAY_ALLOWED_KEYS = new Set([
  "version",
  "projectionVersion",
  "artifactBasis",
  "frame",
  "width",
  "height",
  "floorQuad",
  "space",
  "points",
  "x",
  "y",
  "collisionEdges",
  "id",
]);

const OVERLAY_FORBIDDEN_KEYS = new Set([
  "production_authority",
  "productionAuthority",
  "frozenCamera",
  "frozen_camera",
  "camera",
  "world",
  "worldXz",
  "worldXZ",
  "storage",
  "bucket",
  "path",
  "signedUrl",
  "signed_url",
  "sourceNormalizedPolygon",
  "diagnosticPayload",
  "diagnostic_payload",
  "provider",
]);

const OVERLAY_FORBIDDEN_TEXT = [
  "production_authority",
  "frozenCamera",
  "sourceNormalizedPolygon",
  "worldXz",
  "signedUrl",
  "diagnosticPayload",
  "diagnostic_payload",
] as const;

function walkOverlayPrivacy(
  value: unknown,
  path: string,
  found: string[],
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      walkOverlayPrivacy(entry, `${path}[${index}]`, found);
    });
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const next = path ? `${path}.${key}` : key;
    if (!OVERLAY_ALLOWED_KEYS.has(key)) found.push(`key:${next}`);
    if (OVERLAY_FORBIDDEN_KEYS.has(key)) found.push(`forbidden:${next}`);
    walkOverlayPrivacy(child, next, found);
  }
}

export function collectAfcAdminVisualOverlayPrivacyViolations(
  payload: unknown,
): readonly string[] {
  const found: string[] = [];
  walkOverlayPrivacy(payload, "", found);
  const serialized = JSON.stringify(payload) ?? "";
  for (const needle of OVERLAY_FORBIDDEN_TEXT) {
    if (serialized.includes(needle)) found.push(`text:${needle}`);
  }
  return Object.freeze(found);
}

export function assertAfcAdminVisualOverlayPrivacy(payload: unknown): void {
  const violations = collectAfcAdminVisualOverlayPrivacyViolations(payload);
  if (violations.length > 0) {
    throw new Error(
      `AFC diagnostic overlay leaked privileged fields: ${violations.join(", ")}`,
    );
  }
}

function emptyOverlay(
  artifactBasis: AfcDiagnosticVisualArtifactKind,
  frame: Readonly<{ width: number; height: number }>,
): AfcAdminVisualOverlayV1 {
  return Object.freeze({
    version: AFC_ADMIN_VISUAL_OVERLAY_VERSION,
    projectionVersion: AFC_ADMIN_VISUAL_OVERLAY_PROJECTION_VERSION,
    artifactBasis,
    frame: Object.freeze({ width: frame.width, height: frame.height }),
    floorQuad: null,
    collisionEdges: Object.freeze([]),
  });
}

function freezeOverlay(overlay: AfcAdminVisualOverlayV1): AfcAdminVisualOverlayV1 {
  return Object.freeze({
    version: overlay.version,
    projectionVersion: overlay.projectionVersion,
    artifactBasis: overlay.artifactBasis,
    frame: Object.freeze({
      width: overlay.frame.width,
      height: overlay.frame.height,
    }),
    floorQuad: overlay.floorQuad
      ? Object.freeze({
          space: overlay.floorQuad.space,
          points: Object.freeze(
            overlay.floorQuad.points.map((point) =>
              Object.freeze({ x: point.x, y: point.y }),
            ),
          ),
        })
      : null,
    collisionEdges: Object.freeze(
      overlay.collisionEdges.map((edge) =>
        Object.freeze({
          id: edge.id,
          points: Object.freeze(
            edge.points.map((point) => Object.freeze({ x: point.x, y: point.y })),
          ),
        }),
      ),
    ),
  });
}

function parseFloorPoints(
  authority: AfcV2ProductionRoomAuthority,
): AfcAdminVisualOverlayPoint[] | null {
  const raw = authority.floor?.sourceNormalizedPolygon;
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const points: AfcAdminVisualOverlayPoint[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) return null;
    const x = entry.x;
    const y = entry.y;
    if (typeof x !== "number" || !Number.isFinite(x)) return null;
    if (typeof y !== "number" || !Number.isFinite(y)) return null;
    points.push({ x, y });
  }
  return points.length >= 3 ? points : null;
}

type OverlayLineageImage = Readonly<{
  fingerprint: string;
  decodedWidth: number;
  decodedHeight: number;
  orientation: number;
}>;

function lineageFromFields(input: {
  sha256: string | null;
  width: number | null;
  height: number | null;
  orientation: number | null;
}): OverlayLineageImage | null {
  if (
    !input.sha256 ||
    input.width == null ||
    input.height == null ||
    input.orientation == null
  ) {
    return null;
  }
  if (
    !Number.isInteger(input.width) ||
    input.width <= 0 ||
    !Number.isInteger(input.height) ||
    input.height <= 0 ||
    !Number.isFinite(input.orientation)
  ) {
    return null;
  }
  return {
    fingerprint: input.sha256,
    decodedWidth: input.width,
    decodedHeight: input.height,
    orientation: input.orientation,
  };
}

function artifactLineage(
  generation: AfcDiagnosticVisualOverlayGenerationRecord,
  kind: AfcDiagnosticVisualArtifactKind,
): OverlayLineageImage | null {
  if (kind === "original") {
    return lineageFromFields({
      sha256: generation.originalSha256,
      width: generation.originalDecodedWidth,
      height: generation.originalDecodedHeight,
      orientation: generation.originalOrientation,
    });
  }
  if (kind === "empty") {
    return lineageFromFields({
      sha256: generation.emptySha256,
      width: generation.emptyDecodedWidth,
      height: generation.emptyDecodedHeight,
      orientation: generation.emptyOrientation,
    });
  }
  return lineageFromFields({
    sha256: generation.tiledSha256,
    width: generation.tiledDecodedWidth,
    height: generation.tiledDecodedHeight,
    orientation: generation.tiledOrientation,
  });
}

export function overlayPairAllowsIdentityUv(
  original: OverlayLineageImage | null,
  input: OverlayLineageImage | null,
): boolean {
  if (!original || !input) return false;
  const compatibility = classifyAfcR3cImagePairCompatibility(original, input);
  return (
    compatibility.tier === "exact_grid_compatible" ||
    compatibility.tier === "aspect_compatible_rescaled"
  );
}

export function overlayPairIsExactGrid(
  left: OverlayLineageImage | null,
  right: OverlayLineageImage | null,
): boolean {
  if (!left || !right) return false;
  return (
    classifyAfcR3cImagePairCompatibility(left, right).tier ===
    "exact_grid_compatible"
  );
}

export function overlayGeometryTransferAllowed(input: {
  kind: AfcDiagnosticVisualArtifactKind;
  original: OverlayLineageImage | null;
  empty: OverlayLineageImage | null;
  tiled: OverlayLineageImage | null;
}): boolean {
  if (input.kind === "original") return true;
  const emptyCompatible = overlayPairAllowsIdentityUv(
    input.original,
    input.empty,
  );
  if (input.kind === "empty") return emptyCompatible;
  return (
    emptyCompatible && overlayPairIsExactGrid(input.empty, input.tiled)
  );
}

function artifactFrame(
  kind: AfcDiagnosticVisualArtifactKind,
  generation: AfcDiagnosticVisualOverlayGenerationRecord,
  authority: AfcV2ProductionRoomAuthority | null,
): { width: number; height: number } | null {
  if (kind === "original") {
    const width =
      positiveDimension(generation.originalDecodedWidth) ??
      positiveDimension(authority?.frozenCamera.frame.width) ??
      positiveDimension(authority?.frame.width) ??
      positiveDimension(generation.frameWidth);
    const height =
      positiveDimension(generation.originalDecodedHeight) ??
      positiveDimension(authority?.frozenCamera.frame.height) ??
      positiveDimension(authority?.frame.height) ??
      positiveDimension(generation.frameHeight);
    if (width && height) return { width, height };
    return null;
  }
  if (kind === "empty") {
    const width = positiveDimension(generation.emptyDecodedWidth);
    const height = positiveDimension(generation.emptyDecodedHeight);
    if (width && height) return { width, height };
    return null;
  }
  const width = positiveDimension(generation.tiledDecodedWidth);
  const height = positiveDimension(generation.tiledDecodedHeight);
  if (width && height) return { width, height };
  return null;
}

function fallbackFrame(
  generation: AfcDiagnosticVisualOverlayGenerationRecord,
  authority: AfcV2ProductionRoomAuthority | null,
): { width: number; height: number } {
  const width =
    positiveDimension(generation.originalDecodedWidth) ??
    positiveDimension(authority?.frozenCamera.frame.width) ??
    positiveDimension(authority?.frame.width) ??
    positiveDimension(generation.frameWidth) ??
    1;
  const height =
    positiveDimension(generation.originalDecodedHeight) ??
    positiveDimension(authority?.frozenCamera.frame.height) ??
    positiveDimension(authority?.frame.height) ??
    positiveDimension(generation.frameHeight) ??
    1;
  return { width, height };
}

function parseReadyAuthority(
  value: unknown,
): AfcV2ProductionRoomAuthority | null {
  return isAfcV2ProductionRoomAuthority(value) ? value : null;
}

function projectCollisionEdges(
  authority: AfcV2ProductionRoomAuthority,
  log: (reason: string) => void,
): AfcAdminVisualOverlayCollisionEdge[] {
  try {
    const world = realizeProductionWorld(authority);
    const built = buildProductionPerspectiveCamera(world.camera);
    if (!built.ok) {
      log(`camera_build:${built.reason}`);
      return [];
    }
    const edges: AfcAdminVisualOverlayCollisionEdge[] = [];
    world.collisionWalls.forEach((wall, index) => {
      const id =
        typeof wall.id === "string" && wall.id.trim().length > 0
          ? wall.id
          : `wall-${index + 1}`;
      try {
        const projected = projectWorldSegmentToNormalizedImage(
          built.camera,
          {
            x: wall.a.x,
            y: AFC_V2_RUNTIME_FLOOR_PLANE_Y,
            z: wall.a.z,
          },
          {
            x: wall.b.x,
            y: AFC_V2_RUNTIME_FLOOR_PLANE_Y,
            z: wall.b.z,
          },
        );
        if (!projected) return;
        edges.push({
          id,
          points: [projected.points[0], projected.points[1]],
        });
      } catch {
        log(`wall_omit:${id}`);
      }
    });
    return edges;
  } catch (error) {
    log(error instanceof Error ? error.name : "projection_failed");
    return [];
  }
}

export function buildAfcAdminVisualOverlayV1(input: {
  generation: AfcDiagnosticVisualOverlayGenerationRecord;
  kind: AfcDiagnosticVisualArtifactKind;
  log?: (reason: string) => void;
}): AfcAdminVisualOverlayV1 {
  const log = input.log ?? (() => undefined);
  const authority = parseReadyAuthority(input.generation.productionAuthority);
  const frame =
    artifactFrame(input.kind, input.generation, authority) ??
    fallbackFrame(input.generation, authority);
  const blank = () => freezeOverlay(emptyOverlay(input.kind, frame));

  if (input.generation.status !== "ready") {
    return blank();
  }
  if (!authority) {
    return blank();
  }
  if (
    !overlayGeometryTransferAllowed({
      kind: input.kind,
      original: artifactLineage(input.generation, "original"),
      empty: artifactLineage(input.generation, "empty"),
      tiled: artifactLineage(input.generation, "tiled"),
    })
  ) {
    return blank();
  }

  const floorPoints = parseFloorPoints(authority);
  const collisionEdges = projectCollisionEdges(authority, log);
  return freezeOverlay({
    version: AFC_ADMIN_VISUAL_OVERLAY_VERSION,
    projectionVersion: AFC_ADMIN_VISUAL_OVERLAY_PROJECTION_VERSION,
    artifactBasis: input.kind,
    frame,
    floorQuad: floorPoints
      ? {
          space: AFC_ADMIN_VISUAL_OVERLAY_FLOOR_SPACE,
          points: floorPoints,
        }
      : null,
    collisionEdges,
  });
}

export async function resolveAfcDiagnosticVisualOverlay(input: {
  store: AfcDiagnosticVisualOverlayStore;
  caseId: string;
  generationId: string;
  kind: AfcDiagnosticVisualArtifactKind;
  log?: (entry: AfcDiagnosticVisualOverlayLog) => void;
}): Promise<AfcAdminVisualOverlayV1> {
  const { generation } = await resolveAfcDiagnosticVisualMembershipContext({
    store: input.store,
    caseId: input.caseId,
    generationId: input.generationId,
  });
  const overlay = buildAfcAdminVisualOverlayV1({
    generation,
    kind: input.kind,
    log: (reason) =>
      input.log?.({
        caseId: input.caseId,
        generationId: input.generationId,
        artifact: input.kind,
        reason,
      }),
  });
  assertAfcAdminVisualOverlayPrivacy(overlay);
  return overlay;
}

function overlayErrorResponse(status: number, message: string) {
  const response = NextResponse.json({ error: message }, { status });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

function overlayJsonResponse(overlay: AfcAdminVisualOverlayV1) {
  const response = NextResponse.json(overlay, { status: 200 });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

function defaultLog(entry: AfcDiagnosticVisualOverlayLog): void {
  console.error("[afc-v2-diagnostics] visual overlay projection failed", {
    caseId: entry.caseId,
    generationId: entry.generationId,
    artifact: entry.artifact,
    reason: entry.reason,
  });
}

export type AfcDiagnosticVisualOverlayRouteDependencies = Readonly<{
  authorize?: (
    options?: AuthorizeAfcDiagnosticsAdminOptions,
  ) => Promise<AfcDiagnosticsAdminAuth>;
  store?: AfcDiagnosticVisualOverlayStore;
  getStore?: () => AfcDiagnosticVisualOverlayStore | null;
  authorizeOptions?: AuthorizeAfcDiagnosticsAdminOptions;
  log?: (entry: AfcDiagnosticVisualOverlayLog) => void;
}>;

function resolveStore(
  dependencies: AfcDiagnosticVisualOverlayRouteDependencies,
): AfcDiagnosticVisualOverlayStore {
  if (dependencies.store) return dependencies.store;
  if (dependencies.getStore) {
    const store = dependencies.getStore();
    if (!store) throw new AfcDiagnosticVisualStoreError();
    return store;
  }
  return storeFromEnv();
}

export function parseAfcDiagnosticVisualOverlayArtifactQuery(
  request: Request,
): AfcDiagnosticVisualArtifactKind | null {
  try {
    const url = new URL(request.url);
    return parseAfcDiagnosticVisualArtifactKind(url.searchParams.get("artifact"));
  } catch {
    return null;
  }
}

export async function handleAfcDiagnosticsAdminVisualOverlayGet(
  args: {
    request: Request;
    caseId: string;
    generationId: string;
  } & AfcDiagnosticVisualOverlayRouteDependencies,
) {
  const caseIdRaw = args.caseId;
  const generationIdRaw = args.generationId;
  const log = args.log ?? defaultLog;
  try {
    const authorize = args.authorize ?? authorizeAfcDiagnosticsAdmin;
    const auth = await authorize(args.authorizeOptions);
    if (!auth.ok) return auth.response;

    const caseId = parseAfcDiagnosticAdminUuid(caseIdRaw);
    const generationId = parseAfcDiagnosticAdminUuid(generationIdRaw);
    const kind = parseAfcDiagnosticVisualOverlayArtifactQuery(args.request);
    if (!caseId || !generationId || !kind) {
      throw new AfcDiagnosticVisualInputError();
    }

    const store = resolveStore(args);
    const overlay = await resolveAfcDiagnosticVisualOverlay({
      store,
      caseId,
      generationId,
      kind,
      log,
    });
    return overlayJsonResponse(overlay);
  } catch (error) {
    if (error instanceof AfcDiagnosticVisualInputError) {
      return overlayErrorResponse(400, "Invalid request.");
    }
    if (error instanceof AfcDiagnosticVisualNotFoundError) {
      return overlayErrorResponse(404, "Not found.");
    }
    const parsedCase = parseAfcDiagnosticAdminUuid(caseIdRaw) ?? "invalid";
    const parsedGeneration =
      parseAfcDiagnosticAdminUuid(generationIdRaw) ?? "invalid";
    log({
      caseId: parsedCase,
      generationId: parsedGeneration,
      artifact: parseAfcDiagnosticVisualOverlayArtifactQuery(args.request) ?? "invalid",
      reason: error instanceof Error ? error.name : "unknown",
    });
    return overlayErrorResponse(500, "Server error.");
  }
}
