import "server-only";

import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  open,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import {
  AFC_SR1_READINESS_PATH,
  callCompositorAfcSr1Readiness,
  type AfcSr1ReadinessV2,
} from "@/lib/callCompositorAfcSr1Readiness";
import {
  callCompositorAfcSr1TileFloorReader,
} from "@/lib/callCompositorAfcSr1TileFloorReader";
import {
  callCompositorAfcSr1Ts0ChildProjectivePlacement,
  type CallCompositorAfcSr1Ts0ChildProjectivePlacementArgs,
} from "@/lib/callCompositorAfcSr1Ts0ChildProjectivePlacement";
import {
  callCompositorJson,
  CompositorTransportError,
  resolveCompositorEndpoint,
  toCompositorTransportDiagnostic,
} from "@/lib/compositorTransportError";

import {
  canonicalizeRfc8785Jcs,
  sha256HexUtf8,
} from "../gemini-evidence-contract";
import {
  classifyAfcR3cImagePairCompatibility,
} from "./afc-r3c-image-pair-compatibility";
import {
  executeAfcSr1RawFirstPlacementAwareOrchestration,
  type AfcSr1RawFirstPlacementAwareDependenciesV1,
  type AfcSr1RawFirstPlacementAwareOrchestrationInputV1,
  type AfcSr1RawFirstPlacementAwareOrchestrationResultV1,
} from "./afc-sr1-raw-first-placement-aware-orchestration";
import {
  deriveAfcSr1FloorVanishingLineCrossRoom,
} from "./afc-sr1-floor-vanishing-line-cross-room";
import {
  AFC_SR1_TR2_V4_POLICY_VERSION,
  AFC_SR1_TR2_V4_RESEARCH_PROFILE,
  validateAfcSr1Tr2ReaderReceipt,
} from "./afc-sr1-tile-floor-reader-execution";
import {
  AFC_SR1_TS0_GENERATION_TIMEOUT_CONTRACT_VERSION,
  AFC_SR1_TS0_GENERATION_TIMEOUT_MS,
  AFC_SR1_TILE_GRID_SCAFFOLD_PROFILE,
  AFC_SR1_TILE_GRID_SCAFFOLD_REQUESTED_MODEL_ID,
  vibodeTileGridScaffoldAssist,
  type AfcSr1TileGridScaffoldArgs,
  type AfcSr1TileGridScaffoldImageIdentity,
  type AfcSr1TileGridScaffoldProvenance,
  type AfcSr1TileGridScaffoldResult,
} from "./afc-sr1-tile-grid-scaffold";
import {
  validateAfcSr1Ts0ChildProjectivePlacementReceipt,
  type AfcSr1Ts0LineageIdentityV1,
} from "./afc-sr1-ts0-child-projective-placement";
import {
  validateAfcSr1GeneratedTs0ParentChildLineage,
} from "./afc-sr1-ts0-parent-child-lineage-authority";

export const AFC_SR1_CERTIFIED_RUNNER_VERSION =
  "afc-sr1-certified-control-runner/v2" as const;
export const AFC_SR1_CERTIFIED_PERMISSION_MODE =
  "filesystem-localhost-confirmed/v1" as const;
export const AFC_SR1_READINESS_CERTIFICATION_VERSION =
  "afc-sr1-integrated-path-a-readiness-certification/v2" as const;
export const AFC_SR1_TRANSPORT_REQUEST_WIRE_VERSION =
  "afc-sr1-transport-request-wire/v1" as const;
export const AFC_SR1_TRANSPORT_RESPONSE_WIRE_VERSION =
  "afc-sr1-transport-response-wire/v1" as const;
export const AFC_SR1_TRANSPORT_ERROR_WIRE_VERSION =
  "afc-sr1-transport-error-wire/v1" as const;

const execFile = promisify(execFileCallback);
const REPORT_FILENAME =
  "afc-sr1-integrated-path-a-readiness-certification.v2.json";
const FIXTURE_DIRECTORY = new URL(
  "./fixtures/afc-sr1-room-c-strict-semantic-handoff-control.v1/",
  import.meta.url
);

export type HarnessWireSeam =
  | "raw-reader"
  | "ts0-generation"
  | "placement"
  | "child-reader";

export type WritableProbeResult = Readonly<{
  directory: string;
  status: "pass";
  fsync: true;
  atomicRename: true;
  readBack: true;
  cleanup: true;
}>;

export type RepositoryRuntimeState = Readonly<{
  path: string;
  branch: string;
  sha: string;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  statusPorcelain: string;
  trackedDiffSha256: string;
}>;

export type WireCaptureState = {
  requestPath: string | null;
  requestWireDigest: string | null;
  responsePath: string | null;
  errorPath: string | null;
};

export type CertifiedRunnerConfig = Readonly<{
  uiRepository: string;
  compositorRepository: string;
  executionDirectory: string;
  custodyDirectory: string;
  permissionMode: string;
  invocationIdentity: string;
  ts0ResultAllowedHosts: readonly string[];
  ts0AllowLocalhostHttp: boolean;
}>;

export type CertifiedRunnerDependencies = Readonly<{
  now?: () => Date;
  createId?: () => string;
  probeWritableDirectory?: typeof probeWritableDirectory;
  readRepositoryState?: typeof readRepositoryState;
  callReadiness?: typeof callCompositorAfcSr1Readiness;
  callHealth?: () => Promise<unknown>;
  executePathA?: typeof executeAfcSr1RawFirstPlacementAwareOrchestration;
  callRawReader?: typeof callCompositorAfcSr1TileFloorReader;
  executeTs0?: (
    args: AfcSr1TileGridScaffoldArgs
  ) => Promise<AfcSr1TileGridScaffoldResult>;
  callPlacement?: typeof callCompositorAfcSr1Ts0ChildProjectivePlacement;
  callChildReader?: typeof callCompositorAfcSr1TileFloorReader;
}>;

export class AfcSr1CertifiedPreflightError extends Error {
  readonly stage: 1 | 2;
  readonly code: string;

  constructor(stage: 1 | 2, code: string) {
    super(`AFC-SR1 certified preflight stage ${stage} failed: ${code}`);
    this.name = "AfcSr1CertifiedPreflightError";
    this.stage = stage;
    this.code = code;
  }
}

function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function exactRecord(value: unknown, keys: readonly string[]): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  const temporary = `${path}.tmp-${randomUUID()}`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function writeCanonicalArtifact(
  path: string,
  value: unknown
): Promise<Readonly<{ path: string; byteLength: number; sha256: string }>> {
  const canonical = canonicalizeRfc8785Jcs(value);
  await atomicWrite(path, canonical);
  return Object.freeze({
    path,
    byteLength: Buffer.byteLength(canonical, "utf8"),
    sha256: sha256HexUtf8(canonical),
  });
}

export async function probeWritableDirectory(
  directory: string,
  createId: () => string = randomUUID
): Promise<WritableProbeResult> {
  const resolved = resolve(directory);
  const metadata = await stat(resolved);
  if (!metadata.isDirectory()) {
    throw new Error("writeability probe target is not a directory");
  }
  const identity = `.afc-sr1-write-probe-${createId()}`;
  const source = join(resolved, `${identity}.tmp`);
  const destination = join(resolved, `${identity}.ready`);
  const expected = Buffer.from(`afc-sr1-write-probe/v1:${identity}`, "utf8");
  const handle = await open(source, "wx", 0o600);
  try {
    await handle.write(expected);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(source, destination);
    const observed = await readFile(destination);
    if (!observed.equals(expected)) {
      throw new Error("writeability probe read-back mismatch");
    }
  } finally {
    await Promise.all([
      rm(source, { force: true }),
      rm(destination, { force: true }),
    ]);
  }
  return Object.freeze({
    directory: resolved,
    status: "pass",
    fsync: true,
    atomicRename: true,
    readBack: true,
    cleanup: true,
  });
}

async function git(repository: string, args: readonly string[]): Promise<string> {
  const result = await execFile("git", args, {
    cwd: repository,
    maxBuffer: 16 * 1024 * 1024,
    encoding: "utf8",
  });
  return result.stdout.trim();
}

export async function readRepositoryState(
  repository: string
): Promise<RepositoryRuntimeState> {
  const path = await git(repository, ["rev-parse", "--show-toplevel"]);
  const [branch, sha, statusPorcelain, trackedDiff] = await Promise.all([
    git(repository, ["branch", "--show-current"]),
    git(repository, ["rev-parse", "HEAD"]),
    git(repository, ["status", "--porcelain=v1"]),
    git(repository, ["diff", "--binary", "--no-ext-diff", "HEAD"]),
  ]);
  let upstream: string | null = null;
  let ahead: number | null = null;
  let behind: number | null = null;
  try {
    upstream = await git(repository, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ]);
    const counts = await git(repository, [
      "rev-list",
      "--left-right",
      "--count",
      `${upstream}...HEAD`,
    ]);
    const [upstreamOnly, localOnly] = counts.split(/\s+/).map(Number);
    behind = upstreamOnly;
    ahead = localOnly;
  } catch {
    upstream = null;
  }
  return Object.freeze({
    path,
    branch,
    sha,
    upstream,
    ahead,
    behind,
    statusPorcelain,
    trackedDiffSha256: sha256HexUtf8(trackedDiff),
  });
}

function safeResponse(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeResponse);
  if (typeof value === "string") {
    return value
      .replace(/Bearer\s+[^\s"]+/gi, "Bearer [REDACTED]")
      .replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/gi, "[REDACTED_IMAGE]");
  }
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(
        ([key]) =>
          !/^(authorization|apiKey|token|imageBase64|parentImageBase64|childImageBase64)$/i.test(
            key
          )
      )
      .map(([key, item]) => [key, safeResponse(item)])
  );
}

function errorDiagnostic(error: unknown): Readonly<{
  class: string;
  httpStatus: number | null;
  osCode: string | null;
  message: string;
  endpoint: unknown;
}> {
  if (error instanceof CompositorTransportError) {
    const diagnostic = toCompositorTransportDiagnostic(error);
    return Object.freeze({
      class: diagnostic.class,
      httpStatus: diagnostic.httpStatus,
      osCode: diagnostic.osCode,
      message: diagnostic.message,
      endpoint: diagnostic.endpoint,
    });
  }
  return Object.freeze({
    class: "unknown_client_failure",
    httpStatus: null,
    osCode: null,
    message: "Unhandled compositor client failure.",
    endpoint: null,
  });
}

async function writeRequestWire(args: {
  directory: string;
  seam: HarnessWireSeam;
  artifactStem?: string;
  utc: string;
  safeRequest: unknown;
  state: WireCaptureState;
}): Promise<void> {
  const requestDigest = sha256HexUtf8(
    canonicalizeRfc8785Jcs(args.safeRequest)
  );
  const artifact = Object.freeze({
    schemaVersion: AFC_SR1_TRANSPORT_REQUEST_WIRE_VERSION,
    seam: args.seam,
    utc: args.utc,
    requestDigest,
    request: args.safeRequest,
    scientificImagePayloadStored: false,
  });
  const path = join(
    args.directory,
    `${args.artifactStem ?? args.seam}.request-wire.v1.json`
  );
  const written = await writeCanonicalArtifact(path, artifact);
  args.state.requestPath = written.path;
  args.state.requestWireDigest = written.sha256;
}

async function writeResponseWire(args: {
  directory: string;
  seam: HarnessWireSeam;
  artifactStem?: string;
  utc: string;
  response: unknown;
  state: WireCaptureState;
}): Promise<void> {
  const artifact = Object.freeze({
    schemaVersion: AFC_SR1_TRANSPORT_RESPONSE_WIRE_VERSION,
    seam: args.seam,
    utc: args.utc,
    requestWireDigest: args.state.requestWireDigest,
    response: safeResponse(args.response),
  });
  const path = join(
    args.directory,
    `${args.artifactStem ?? args.seam}.response-wire.v1.json`
  );
  await writeCanonicalArtifact(path, artifact);
  args.state.responsePath = path;
}

async function writeErrorWire(args: {
  directory: string;
  seam: HarnessWireSeam;
  artifactStem?: string;
  utc: string;
  error: unknown;
  diagnosticContext?: unknown;
  state: WireCaptureState;
}): Promise<void> {
  const diagnostic = errorDiagnostic(args.error);
  const artifact = Object.freeze({
    schemaVersion: AFC_SR1_TRANSPORT_ERROR_WIRE_VERSION,
    seam: args.seam,
    class: diagnostic.class,
    httpStatus: diagnostic.httpStatus,
    osCode: diagnostic.osCode,
    message: diagnostic.message,
    endpoint: diagnostic.endpoint,
    utc: args.utc,
    requestWireDigest: args.state.requestWireDigest,
    scientificImagePayloadStored: false,
    ...(args.diagnosticContext === undefined
      ? {}
      : { diagnosticContext: safeResponse(args.diagnosticContext) }),
  });
  const path = join(
    args.directory,
    `${args.artifactStem ?? args.seam}.error-wire.v1.json`
  );
  await writeCanonicalArtifact(path, artifact);
  args.state.errorPath = path;
}

export function createReaderWireTransport(args: {
  directory: string;
  seam: "raw-reader" | "child-reader";
  artifactStem?: string;
  call: typeof callCompositorAfcSr1TileFloorReader;
  now?: () => Date;
  state?: WireCaptureState;
}): Readonly<{
  state: WireCaptureState;
  call: NonNullable<AfcSr1RawFirstPlacementAwareDependenciesV1["callRawReader"]>;
}> {
  const state = args.state ?? {
    requestPath: null,
    requestWireDigest: null,
    responsePath: null,
    errorPath: null,
  };
  const now = args.now ?? (() => new Date());
  return Object.freeze({
    state,
    call: async (request) => {
      const payload = request.payload as Record<string, unknown>;
      const encoded =
        typeof payload?.imageBase64 === "string" ? payload.imageBase64 : "";
      const imageBytes = Buffer.from(encoded, "base64");
      await writeRequestWire({
        directory: args.directory,
        seam: args.seam,
        artifactStem: args.artifactStem,
        utc: now().toISOString(),
        safeRequest: Object.freeze({
          researchProfile: payload?.researchProfile ?? null,
          policyVersion: payload?.policyVersion ?? null,
          roi: payload?.roi ?? null,
          image: Object.freeze({
            sha256: sha256Bytes(imageBytes),
            byteCount: imageBytes.byteLength,
          }),
        }),
        state,
      });
      try {
        const response = await args.call(request);
        await writeResponseWire({
          directory: args.directory,
          seam: args.seam,
          artifactStem: args.artifactStem,
          utc: now().toISOString(),
          response,
          state,
        });
        return response;
      } catch (error) {
        await writeErrorWire({
          directory: args.directory,
          seam: args.seam,
          artifactStem: args.artifactStem,
          utc: now().toISOString(),
          error,
          state,
        });
        throw error;
      }
    },
  });
}

export function createPlacementWireTransport(args: {
  directory: string;
  artifactStem?: string;
  call: typeof callCompositorAfcSr1Ts0ChildProjectivePlacement;
  now?: () => Date;
  state?: WireCaptureState;
}): Readonly<{
  state: WireCaptureState;
  call: NonNullable<AfcSr1RawFirstPlacementAwareDependenciesV1["callPlacement"]>;
}> {
  const state = args.state ?? {
    requestPath: null,
    requestWireDigest: null,
    responsePath: null,
    errorPath: null,
  };
  const now = args.now ?? (() => new Date());
  return Object.freeze({
    state,
    call: async (request: CallCompositorAfcSr1Ts0ChildProjectivePlacementArgs) => {
      await writeRequestWire({
        directory: args.directory,
        seam: "placement",
        artifactStem: args.artifactStem,
        utc: now().toISOString(),
        safeRequest: Object.freeze({
          policyVersion: request.policyVersion,
          registrationExclusion: request.registrationExclusion,
          ts0Lineage: request.ts0Lineage,
          parentImage: Object.freeze({
            sha256: sha256Bytes(request.parentImageBytes),
            byteCount: request.parentImageBytes.byteLength,
          }),
          childImage: Object.freeze({
            sha256: sha256Bytes(request.childImageBytes),
            byteCount: request.childImageBytes.byteLength,
          }),
        }),
        state,
      });
      try {
        const response = await args.call(request);
        await writeResponseWire({
          directory: args.directory,
          seam: "placement",
          artifactStem: args.artifactStem,
          utc: now().toISOString(),
          response,
          state,
        });
        return response;
      } catch (error) {
        await writeErrorWire({
          directory: args.directory,
          seam: "placement",
          artifactStem: args.artifactStem,
          utc: now().toISOString(),
          error,
          state,
        });
        throw error;
      }
    },
  });
}

export type Ts0WireObservation = {
  dispatchCount: number;
  runtimeMs: number | null;
  resultStatus: "generated" | "failure" | null;
  failureCode: string | null;
};

function summarizeTs0Result(result: AfcSr1TileGridScaffoldResult): unknown {
  if (result.status === "failure") {
    return Object.freeze({
      status: result.status,
      code: result.code,
      runId: result.runId,
      input: result.input ?? null,
      tiled: result.tiled ?? null,
      compatibility: result.compatibility ?? null,
      diagnostic: result.diagnostic ?? null,
      scientificImagePayloadStored: false,
    });
  }
  return Object.freeze({
    status: result.status,
    input: result.input,
    tiledIdentity: result.tiled.identity,
    provenance: result.provenance,
    compatibility: result.compatibility,
    scientificImagePayloadStored: false,
  });
}

export function createTs0WireTransport(args: {
  directory: string;
  call: (
    input: AfcSr1TileGridScaffoldArgs
  ) => Promise<AfcSr1TileGridScaffoldResult>;
  now?: () => Date;
  state?: WireCaptureState;
  artifactStem?: string;
}): Readonly<{
  state: WireCaptureState;
  observation: Ts0WireObservation;
  call: (
    input: AfcSr1TileGridScaffoldArgs
  ) => Promise<AfcSr1TileGridScaffoldResult>;
}> {
  const state = args.state ?? {
    requestPath: null,
    requestWireDigest: null,
    responsePath: null,
    errorPath: null,
  };
  const observation: Ts0WireObservation = {
    dispatchCount: 0,
    runtimeMs: null,
    resultStatus: null,
    failureCode: null,
  };
  const now = args.now ?? (() => new Date());
  return Object.freeze({
    state,
    observation,
    call: async (input) => {
      if (observation.dispatchCount !== 0) {
        throw new Error("TS0 exact-once transport refused a second dispatch.");
      }
      await writeRequestWire({
        directory: args.directory,
        seam: "ts0-generation",
        artifactStem: args.artifactStem,
        utc: now().toISOString(),
        safeRequest: Object.freeze({
          profileId: AFC_SR1_TILE_GRID_SCAFFOLD_PROFILE,
          requestedModelId: AFC_SR1_TILE_GRID_SCAFFOLD_REQUESTED_MODEL_ID,
          timeoutContractVersion:
            AFC_SR1_TS0_GENERATION_TIMEOUT_CONTRACT_VERSION,
          generationTimeoutMs: AFC_SR1_TS0_GENERATION_TIMEOUT_MS,
          emptyIdentity: input.empty.identity,
          resultAllowedHosts: [...input.resultAllowedHosts],
          maxOutputBytes: input.maxOutputBytes,
          fetchTimeoutMs: input.fetchTimeoutMs,
          allowLocalhostHttp: input.allowLocalhostHttp,
        }),
        state,
      });
      observation.dispatchCount = 1;
      const started = performance.now();
      try {
        const result = await args.call(input);
        observation.runtimeMs = performance.now() - started;
        observation.resultStatus = result.status;
        observation.failureCode =
          result.status === "failure" ? result.code : null;
        await writeResponseWire({
          directory: args.directory,
          seam: "ts0-generation",
          artifactStem: args.artifactStem,
          utc: now().toISOString(),
          response: Object.freeze({
            runtimeMs: observation.runtimeMs,
            generationTimeoutMs: AFC_SR1_TS0_GENERATION_TIMEOUT_MS,
            result: summarizeTs0Result(result),
          }),
          state,
        });
        return result;
      } catch (error) {
        observation.runtimeMs = performance.now() - started;
        await writeErrorWire({
          directory: args.directory,
          seam: "ts0-generation",
          artifactStem: args.artifactStem,
          utc: now().toISOString(),
          error,
          diagnosticContext: Object.freeze({
            runtimeMs: observation.runtimeMs,
            generationTimeoutMs: AFC_SR1_TS0_GENERATION_TIMEOUT_MS,
            dispatchCount: observation.dispatchCount,
          }),
          state,
        });
        throw error;
      }
    },
  });
}

function replayValid(
  result: AfcSr1RawFirstPlacementAwareOrchestrationResultV1
): boolean {
  const preimage = {
    schemaVersion: result.schemaVersion,
    policyVersion: result.policyVersion,
    parentImageIdentity: result.parentImageIdentity,
    semanticPolygonIdentity: result.semanticPolygonIdentity,
    truncatedAnchor: result.truncatedAnchor,
    anchorAuthority: result.anchorAuthority,
    rawAttempt: result.rawAttempt,
    fallbackAttempt: result.fallbackAttempt,
    attemptCounts: result.attemptCounts,
    mode: result.mode,
    finalReason: result.finalReason,
  };
  return (
    canonicalizeRfc8785Jcs(preimage) === result.evidenceCanonicalJson &&
    sha256HexUtf8(result.evidenceCanonicalJson) ===
      result.evidenceDigest.value
  );
}

function legalAttemptCounts(
  result: AfcSr1RawFirstPlacementAwareOrchestrationResultV1
): boolean {
  const counts = Object.values(result.attemptCounts);
  if (
    result.attemptCounts.rawReader !== 1 ||
    counts.some(
      (value) => !Number.isSafeInteger(value) || value < 0 || value > 1
    )
  ) {
    return false;
  }
  if (result.mode === "raw-direct") {
    return counts.slice(1).every((value) => value === 0);
  }
  if (result.mode === "tiled-placement") {
    return counts.every((value) => value === 1);
  }
  return (
    result.attemptCounts.childReader <= result.attemptCounts.placement &&
    result.attemptCounts.placement <= result.attemptCounts.ts0 &&
    result.attemptCounts.placementBoundHandoff <=
      result.attemptCounts.childReader &&
    result.attemptCounts.tiledProjective <=
      result.attemptCounts.placementBoundHandoff
  );
}

type RoomCControl = Readonly<{
  schemaVersion: string;
  authority: Readonly<{
    rawImage: Readonly<{
      fixtureFile: string;
      sha256: string;
      byteCount: number;
      decodedWidth: number;
      decodedHeight: number;
      orientation: 1;
    }>;
    readerRoi: Readonly<{
      coordinateSpace: "source-normalized/v1";
      polygon: readonly (readonly [number, number])[];
    }>;
    basisBoundSourcePolygon:
      AfcSr1RawFirstPlacementAwareOrchestrationInputV1["basisBoundSourcePolygon"];
    truncatedAnchor: "NL" | "NR";
    anchorAuthority:
      AfcSr1RawFirstPlacementAwareOrchestrationInputV1["anchorAuthority"];
  }>;
  evaluation: Readonly<{
    gt0SeamT: number;
    absoluteTolerance: number;
  }>;
  realCompositorV3Evidence: Readonly<
    Record<"C-RAW" | "C-T1", Readonly<{ imageFixtureFile: string }>>
  >;
}>;

async function roomCInput(
  config: CertifiedRunnerConfig
): Promise<Readonly<{
  control: RoomCControl;
  input: AfcSr1RawFirstPlacementAwareOrchestrationInputV1;
}>> {
  const control = JSON.parse(
    await readFile(new URL("control.json", FIXTURE_DIRECTORY), "utf8")
  ) as RoomCControl;
  const image = control.authority.rawImage;
  const bytes = await readFile(new URL(image.fixtureFile, FIXTURE_DIRECTORY));
  if (
    sha256Bytes(bytes) !== image.sha256 ||
    bytes.byteLength !== image.byteCount
  ) {
    throw new AfcSr1CertifiedPreflightError(1, "room_c_fixture_identity");
  }
  return Object.freeze({
    control,
    input: Object.freeze({
      parentImageBytes: bytes,
      parentImageIdentity: Object.freeze({
        sha256: image.sha256,
        byteCount: image.byteCount,
        decodedWidth: image.decodedWidth,
        decodedHeight: image.decodedHeight,
        mimeType: "image/png" as const,
        orientation: image.orientation,
      }),
      basisBoundSourcePolygon: control.authority.basisBoundSourcePolygon,
      truncatedAnchor: control.authority.truncatedAnchor,
      anchorAuthority: control.authority.anchorAuthority,
      ts0ScaffoldOptions: Object.freeze({
        resultAllowedHosts: [...config.ts0ResultAllowedHosts],
        maxOutputBytes: 32 * 1024 * 1024,
        fetchTimeoutMs: 15_000,
        allowLocalhostHttp: config.ts0AllowLocalhostHttp,
      }),
    }),
  });
}

type RoomCLineageControl = Readonly<{
  parent: AfcSr1TileGridScaffoldImageIdentity;
  results: Readonly<
    Record<
      "C-T1",
      Readonly<{
        child: AfcSr1TileGridScaffoldImageIdentity &
          Readonly<{ mimeType: "image/png" }>;
        provenance: AfcSr1TileGridScaffoldProvenance;
      }>
    >
  >;
}>;

function lineageIdentity(
  parent: AfcSr1TileGridScaffoldImageIdentity,
  child: AfcSr1TileGridScaffoldImageIdentity
): AfcSr1Ts0LineageIdentityV1 {
  const project = (identity: AfcSr1TileGridScaffoldImageIdentity) =>
    Object.freeze({
      sha256: identity.sha256,
      byteCount: identity.byteCount,
      decodedWidth: identity.decodedWidth,
      decodedHeight: identity.decodedHeight,
      orientation: identity.orientation,
    });
  return Object.freeze({
    parent: project(parent),
    child: project(child),
  });
}

async function certifyExposedC1HttpSeams(args: {
  control: RoomCControl;
  parentBytes: Uint8Array;
  placementWire: ReturnType<typeof createPlacementWireTransport>;
  childWire: ReturnType<typeof createReaderWireTransport>;
}): Promise<Readonly<{
  identity: string;
  actualPath: string;
  dispatchCounts: Readonly<{
    rawReader: 0;
    ts0: 0;
    placement: 1;
    childReader: 1;
  }>;
  placementStatus: "usable" | "rejected";
  placementEvidenceDigest: string;
  childReaderStatus: "usable" | "rejected";
  childReaderEvidenceDigest: string;
  placementResponseWirePresent: boolean;
  childResponseWirePresent: boolean;
  errorWiresAbsent: boolean;
  replayValid: boolean;
  status: "PASS" | "FAIL";
}>> {
  const lineageControl = JSON.parse(
    await readFile(
      new URL(
        "./fixtures/afc-sr1-room-c-ts0-lineage-control.v1.json",
        import.meta.url
      ),
      "utf8"
    )
  ) as RoomCLineageControl;
  const childMetadata = lineageControl.results["C-T1"];
  const childBytes = await readFile(
    new URL(
      args.control.realCompositorV3Evidence["C-T1"].imageFixtureFile,
      FIXTURE_DIRECTORY
    )
  );
  const scaffoldResult: AfcSr1TileGridScaffoldResult = Object.freeze({
    status: "generated" as const,
    input: Object.freeze({ ...lineageControl.parent }),
    tiled: Object.freeze({
      base64: Buffer.from(childBytes).toString("base64"),
      identity: Object.freeze({ ...childMetadata.child }),
    }),
    provenance: Object.freeze({ ...childMetadata.provenance }),
    compatibility: classifyAfcR3cImagePairCompatibility(
      {
        fingerprint: lineageControl.parent.sha256,
        decodedWidth: lineageControl.parent.decodedWidth,
        decodedHeight: lineageControl.parent.decodedHeight,
        orientation: lineageControl.parent.orientation,
      },
      {
        fingerprint: childMetadata.child.sha256,
        decodedWidth: childMetadata.child.decodedWidth,
        decodedHeight: childMetadata.child.decodedHeight,
        orientation: childMetadata.child.orientation,
      }
    ),
  });
  const lineageAuthority =
    await validateAfcSr1GeneratedTs0ParentChildLineage(
      scaffoldResult,
      args.parentBytes,
      childBytes
    );
  const lineage = lineageIdentity(
    lineageControl.parent,
    childMetadata.child
  );
  const registrationExclusion = Object.freeze({
    coordinateSpace: "source-normalized/v1" as const,
    role:
      "registration_exclusion_support_only_not_placement_authority" as const,
    evidenceLabel:
      "STRICT_EMPTY_POLYGON_USED_AS_REGISTRATION_EXCLUSION_MASK_ONLY" as const,
    polygon: Object.freeze(
      args.control.authority.basisBoundSourcePolygon.polygon.map((point) =>
        Object.freeze([point.x, point.y] as const)
      )
    ),
  });
  const placementWireResponse = await args.placementWire.call({
    parentImageBytes: Uint8Array.from(args.parentBytes),
    childImageBytes: Uint8Array.from(childBytes),
    policyVersion:
      "afc-sr1-ts0-child-projective-placement-policy/v1",
    registrationExclusion,
    ts0Lineage: lineage,
  });
  const placementReceipt =
    validateAfcSr1Ts0ChildProjectivePlacementReceipt(
      placementWireResponse,
      {
        parentBytes: args.parentBytes,
        childBytes,
        lineageAuthority,
      }
    );
  const childWireResponse = await args.childWire.call({
    payload: Object.freeze({
      researchProfile: AFC_SR1_TR2_V4_RESEARCH_PROFILE,
      policyVersion: AFC_SR1_TR2_V4_POLICY_VERSION,
      imageBase64: Buffer.from(childBytes).toString("base64"),
      roi: args.control.authority.readerRoi,
    }),
  });
  const childReceipt = validateAfcSr1Tr2ReaderReceipt(childWireResponse, {
    readerVersion: "v4",
    tiledImageBytes: childBytes,
    roi: args.control.authority.readerRoi,
    expectedImageIdentity: {
      sha256: childMetadata.child.sha256,
      byteCount: childMetadata.child.byteCount,
      decodedWidth: childMetadata.child.decodedWidth,
      decodedHeight: childMetadata.child.decodedHeight,
    },
  });
  const replay =
    sha256HexUtf8(placementReceipt.evidenceCanonicalJson) ===
      placementReceipt.evidenceDigest.value &&
    sha256HexUtf8(childReceipt.evidenceCanonicalJson) ===
      childReceipt.evidenceDigest.value;
  const responseWires =
    args.placementWire.state.responsePath !== null &&
    args.childWire.state.responsePath !== null;
  const errorWiresAbsent =
    args.placementWire.state.errorPath === null &&
    args.childWire.state.errorPath === null;
  const pass =
    placementReceipt.status === "usable" &&
    childReceipt.status === "usable" &&
    responseWires &&
    errorWiresAbsent &&
    replay;
  return Object.freeze({
    identity: "afc-sr1-room-c-exposed-c-t1-http-seam-control/v1",
    actualPath:
      "direct_exposed_placement_and_child_reader_http_seam_certification",
    dispatchCounts: Object.freeze({
      rawReader: 0 as const,
      ts0: 0 as const,
      placement: 1 as const,
      childReader: 1 as const,
    }),
    placementStatus: placementReceipt.status,
    placementEvidenceDigest: placementReceipt.evidenceDigest.value,
    childReaderStatus: childReceipt.status,
    childReaderEvidenceDigest: childReceipt.evidenceDigest.value,
    placementResponseWirePresent:
      args.placementWire.state.responsePath !== null,
    childResponseWirePresent: args.childWire.state.responsePath !== null,
    errorWiresAbsent,
    replayValid: replay,
    status: pass ? ("PASS" as const) : ("FAIL" as const),
  });
}

function validHealth(value: unknown): boolean {
  return (
    exactRecord(value, ["status"]) &&
    (value as { status: unknown }).status === "ok"
  );
}

function assertStaticConfig(config: CertifiedRunnerConfig): void {
  if (config.permissionMode !== AFC_SR1_CERTIFIED_PERMISSION_MODE) {
    throw new AfcSr1CertifiedPreflightError(1, "permission_mode_unconfirmed");
  }
  if (config.invocationIdentity.trim() === "") {
    throw new AfcSr1CertifiedPreflightError(1, "invocation_identity_missing");
  }
  if (
    !Array.isArray(config.ts0ResultAllowedHosts) ||
    config.ts0ResultAllowedHosts.some(
      (host) =>
        host.trim() === "" ||
        host !== host.trim() ||
        host.includes("/") ||
        host.includes("@")
    )
  ) {
    throw new AfcSr1CertifiedPreflightError(1, "ts0_host_config_invalid");
  }
  try {
    resolveCompositorEndpoint(AFC_SR1_READINESS_PATH);
  } catch {
    throw new AfcSr1CertifiedPreflightError(1, "compositor_url_invalid");
  }
}

export async function runAfcSr1CertifiedControl(
  config: CertifiedRunnerConfig,
  dependencies: CertifiedRunnerDependencies = {}
): Promise<Readonly<{
  artifactPath: string;
  custodyArtifactPath: string;
  canonicalByteLength: number;
  sha256: string;
  report: unknown;
}>> {
  const now = dependencies.now ?? (() => new Date());
  const createId = dependencies.createId ?? randomUUID;
  const probe = dependencies.probeWritableDirectory ?? probeWritableDirectory;
  const repoState = dependencies.readRepositoryState ?? readRepositoryState;
  const callReadiness =
    dependencies.callReadiness ?? callCompositorAfcSr1Readiness;
  const callHealth =
    dependencies.callHealth ??
    (() =>
      callCompositorJson({
        seam: "readiness",
        path: "/health",
        method: "GET",
      }));

  assertStaticConfig(config);
  let ui: RepositoryRuntimeState;
  let compositor: RepositoryRuntimeState;
  let workspaceProbe: WritableProbeResult;
  let custodyProbe: WritableProbeResult;
  try {
    [ui, compositor, workspaceProbe, custodyProbe] = await Promise.all([
      repoState(resolve(config.uiRepository)),
      repoState(resolve(config.compositorRepository)),
      probe(resolve(config.executionDirectory), createId),
      probe(resolve(config.custodyDirectory), createId),
    ]);
  } catch {
    throw new AfcSr1CertifiedPreflightError(
      1,
      "repository_or_writeability_check_failed"
    );
  }

  let readiness: AfcSr1ReadinessV2;
  let health: unknown;
  try {
    [health, readiness] = await Promise.all([callHealth(), callReadiness()]);
  } catch {
    throw new AfcSr1CertifiedPreflightError(
      1,
      "compositor_readiness_unavailable"
    );
  }
  if (!validHealth(health)) {
    throw new AfcSr1CertifiedPreflightError(2, "health_response_invalid");
  }
  if (!readiness.readerEnabled || !readiness.placementEnabled) {
    throw new AfcSr1CertifiedPreflightError(2, "scientific_gate_disabled");
  }
  if (
    !readiness.ts0GeneratorReady ||
    readiness.ts0GeneratorProfile !== AFC_SR1_TILE_GRID_SCAFFOLD_PROFILE ||
    readiness.ts0RequestedModelId !==
      AFC_SR1_TILE_GRID_SCAFFOLD_REQUESTED_MODEL_ID
  ) {
    throw new AfcSr1CertifiedPreflightError(
      2,
      "ts0_generator_prerequisite_failed"
    );
  }

  const { control, input } = await roomCInput(config);
  const executionDirectory = resolve(config.executionDirectory);
  const rawWire = createReaderWireTransport({
    directory: executionDirectory,
    artifactStem: "principal-raw-reader",
    seam: "raw-reader",
    call:
      dependencies.callRawReader ??
      callCompositorAfcSr1TileFloorReader,
    now,
  });
  const fallbackRawWire = createReaderWireTransport({
    directory: executionDirectory,
    artifactStem: "fallback-raw-reader",
    seam: "raw-reader",
    call:
      dependencies.callRawReader ??
      callCompositorAfcSr1TileFloorReader,
    now,
  });
  const ts0Wire = createTs0WireTransport({
    directory: executionDirectory,
    artifactStem: "fallback-ts0-generation",
    call: dependencies.executeTs0 ?? vibodeTileGridScaffoldAssist,
    now,
  });
  const placementWire = createPlacementWireTransport({
    directory: executionDirectory,
    artifactStem: "fallback-placement",
    call:
      dependencies.callPlacement ??
      callCompositorAfcSr1Ts0ChildProjectivePlacement,
    now,
  });
  const childWire = createReaderWireTransport({
    directory: executionDirectory,
    artifactStem: "fallback-child-reader",
    seam: "child-reader",
    call:
      dependencies.callChildReader ??
      callCompositorAfcSr1TileFloorReader,
    now,
  });
  const executePathA =
    dependencies.executePathA ??
    executeAfcSr1RawFirstPlacementAwareOrchestration;
  const started = performance.now();
  const result = await executePathA(input, {
    callRawReader: rawWire.call,
  });
  const runtimeMs = performance.now() - started;
  const replay = replayValid(result);
  const legalCounts = legalAttemptCounts(result);
  const seamT =
    result.rawAttempt.projective?.seamT ??
    result.fallbackAttempt?.finalProjective?.seamT ??
    null;
  const seamWithinHistoricalTolerance =
    seamT === null
      ? null
      : Math.abs(seamT - control.evaluation.gt0SeamT) <=
        control.evaluation.absoluteTolerance;
  const roomCPass =
    result.mode === "raw-direct" &&
    result.finalReason === null &&
    result.rawAttempt.receipt !== null &&
    replay &&
    legalCounts &&
    rawWire.state.responsePath !== null &&
    rawWire.state.errorPath === null &&
    seamWithinHistoricalTolerance !== false;

  let fallbackResult:
    | AfcSr1RawFirstPlacementAwareOrchestrationResultV1
    | null = null;
  let injectedProjectiveCalls = 0;
  if (roomCPass) {
    fallbackResult = await executePathA(input, {
      callRawReader: fallbackRawWire.call,
      executeTs0: ts0Wire.call,
      callPlacement: placementWire.call,
      callChildReader: childWire.call,
      deriveProjective: (value) => {
        injectedProjectiveCalls += 1;
        return injectedProjectiveCalls === 1
          ? Object.freeze({
              status: "rejected" as const,
              reason: "track1a_rejected" as const,
            })
          : deriveAfcSr1FloorVanishingLineCrossRoom(value);
      },
    });
  }
  const fallbackReplay =
    fallbackResult === null ? false : replayValid(fallbackResult);
  const fallbackLegalCounts =
    fallbackResult === null ? false : legalAttemptCounts(fallbackResult);
  const ts0ReadinessPass =
    fallbackResult !== null &&
    ts0Wire.observation.dispatchCount === 1 &&
    ts0Wire.observation.resultStatus === "generated" &&
    fallbackResult.fallbackAttempt?.childImageIdentity !== null &&
    fallbackResult.fallbackAttempt?.childImageIdentity !== undefined &&
    fallbackResult.fallbackAttempt?.lineage.status === "validated" &&
    ts0Wire.state.requestPath !== null &&
    ts0Wire.state.responsePath !== null &&
    ts0Wire.state.errorPath === null;
  const placementAndChildPass =
    fallbackResult !== null &&
    fallbackResult.fallbackAttempt?.placement?.status === "usable" &&
    fallbackResult.fallbackAttempt?.childReader?.status === "usable" &&
    placementWire.state.responsePath !== null &&
    placementWire.state.errorPath === null &&
    childWire.state.responsePath !== null &&
    childWire.state.errorPath === null;
  const integratedFallbackPass =
    fallbackResult !== null &&
    fallbackResult.mode === "tiled-placement" &&
    fallbackResult.finalReason === null &&
    fallbackResult.rawAttempt.receipt?.status === "usable" &&
    fallbackResult.rawAttempt.projective?.reason === "track1a_rejected" &&
    fallbackResult.fallbackAttempt?.placementBoundHandoff?.status ===
      "validated" &&
    fallbackResult.fallbackAttempt?.finalProjective?.status === "usable" &&
    injectedProjectiveCalls === 2 &&
    fallbackReplay &&
    fallbackLegalCounts &&
    fallbackRawWire.state.responsePath !== null &&
    fallbackRawWire.state.errorPath === null &&
    ts0ReadinessPass &&
    placementAndChildPass;
  const fallbackControl = fallbackResult === null
    ? Object.freeze({
        identity: "not_run_principal_control_failed",
        certificationClaim: null,
        rejectionMechanism: null,
        status: "FAIL" as const,
      })
    : Object.freeze({
        identity:
          "afc-sr1-room-c-injected-fallback-live-ts0-placement-child-control/v1",
        certificationClaim: integratedFallbackPass
          ? ("injected_fallback_live_ts0_placement_child_path_certified" as const)
          : null,
        attemptedCertification:
          "injected_fallback_live_ts0_placement_child_path_certified" as const,
        rejectionMechanism:
          "development_only_first_track1a_projective_rejection_injection" as const,
        resultMode: fallbackResult.mode,
        finalReason: fallbackResult.finalReason,
        rawReceiptStatus: fallbackResult.rawAttempt.receipt?.status ?? null,
        rawProjectiveReason:
          fallbackResult.rawAttempt.projective?.reason ?? null,
        attemptCounts: fallbackResult.attemptCounts,
        ts0: Object.freeze({
          timeoutContractVersion:
            AFC_SR1_TS0_GENERATION_TIMEOUT_CONTRACT_VERSION,
          generationTimeoutMs: AFC_SR1_TS0_GENERATION_TIMEOUT_MS,
          dispatchCount: ts0Wire.observation.dispatchCount,
          runtimeMs: ts0Wire.observation.runtimeMs,
          resultStatus: ts0Wire.observation.resultStatus,
          failureCode: ts0Wire.observation.failureCode,
          childImageIdentity:
            fallbackResult.fallbackAttempt?.childImageIdentity ?? null,
          lineageStatus:
            fallbackResult.fallbackAttempt?.lineage.status ?? "rejected",
        }),
        placementStatus:
          fallbackResult.fallbackAttempt?.placement?.status ?? null,
        placementReason:
          fallbackResult.fallbackAttempt?.placement?.reason ?? null,
        childReaderStatus:
          fallbackResult.fallbackAttempt?.childReader?.status ?? null,
        childReaderReason:
          fallbackResult.fallbackAttempt?.childReader?.reason ?? null,
        placementBoundHandoffStatus:
          fallbackResult.fallbackAttempt?.placementBoundHandoff?.status ?? null,
        finalProjectiveStatus:
          fallbackResult.fallbackAttempt?.finalProjective?.status ?? null,
        diagnostics: fallbackResult.diagnostics,
        evidenceDigest: fallbackResult.evidenceDigest.value,
        replayValid: fallbackReplay,
        wires: Object.freeze({
          raw: Object.freeze({ ...fallbackRawWire.state }),
          ts0: Object.freeze({ ...ts0Wire.state }),
          placement: Object.freeze({ ...placementWire.state }),
          childReader: Object.freeze({ ...childWire.state }),
        }),
        status: integratedFallbackPass ? ("PASS" as const) : ("FAIL" as const),
      });
  const overallPass =
    roomCPass &&
    readiness.ts0GeneratorReady &&
    ts0ReadinessPass &&
    placementAndChildPass &&
    integratedFallbackPass;
  const utc = now().toISOString();
  const preimage = Object.freeze({
    schemaVersion: AFC_SR1_READINESS_CERTIFICATION_VERSION,
    runnerVersion: AFC_SR1_CERTIFIED_RUNNER_VERSION,
    utc,
    overallStatus: overallPass ? ("PASS" as const) : ("FAIL" as const),
    runtimeIdentity: Object.freeze({
      ui,
      compositor,
      nodeVersion: process.version,
      cwd: process.cwd(),
      runnerPath:
        "app/admin/3d-room-lab/research/afc-sr1-certified-control-runner.ts",
      invocationIdentity: config.invocationIdentity,
      invocationPattern:
        "scripts/afc-sr1-certified-control.sh --execution-dir <existing-dir> --custody-dir <existing-dir> --compositor-repo <repo>",
      compositorEndpoint: resolveCompositorEndpoint(
        AFC_SR1_READINESS_PATH
      ).endpoint,
    }),
    stages: Object.freeze({
      stage1StaticRuntime: Object.freeze({
        status: "PASS" as const,
        permissionMode: config.permissionMode,
        ts0ResultAllowedHosts: [...config.ts0ResultAllowedHosts],
        ts0AllowLocalhostHttp: config.ts0AllowLocalhostHttp,
        ts0GenerationTimeoutContractVersion:
          AFC_SR1_TS0_GENERATION_TIMEOUT_CONTRACT_VERSION,
        ts0GenerationTimeoutMs: AFC_SR1_TS0_GENERATION_TIMEOUT_MS,
        workspaceProbe,
        custodyProbe,
      }),
      stage2TransportReadiness: Object.freeze({
        status: "PASS" as const,
        health,
        readiness,
        readerMethodProbeIsSufficient: false,
        emptyPost422IsSufficient: false,
        rootHealthIsSufficient: false,
      }),
      stage3RoomCPrincipalRawDirectPathA: Object.freeze({
        status: roomCPass ? ("PASS" as const) : ("FAIL" as const),
      }),
      stage4LiveDevelopmentTs0StructureLineage: Object.freeze({
        mandatoryForOverallPass: true,
        status: ts0ReadinessPass ? ("PASS" as const) : ("FAIL" as const),
      }),
      stage5PlacementAndChildReaderLiveSeams: Object.freeze({
        cannotRescueFailedStage4: true,
        status: placementAndChildPass ? ("PASS" as const) : ("FAIL" as const),
      }),
      stage6IntegratedInjectedDevelopmentFallbackPathA: Object.freeze({
        status: integratedFallbackPass ? ("PASS" as const) : ("FAIL" as const),
      }),
    }),
    controls: Object.freeze({
      principal: Object.freeze({
        identity: control.schemaVersion,
        resultMode: result.mode,
        finalReason: result.finalReason,
        receiptPresent: result.rawAttempt.receipt !== null,
        attemptCounts: result.attemptCounts,
        seamT,
        gt0SeamT: control.evaluation.gt0SeamT,
        absoluteTolerance: control.evaluation.absoluteTolerance,
        seamWithinHistoricalTolerance,
        evidenceDigest: result.evidenceDigest.value,
        replayValid: replay,
        runtimeMs,
        diagnostics: result.diagnostics,
        wires: Object.freeze({
          raw: Object.freeze({ ...rawWire.state }),
        }),
      }),
      fallback: fallbackControl,
    }),
  });
  const evidenceCanonicalJson = canonicalizeRfc8785Jcs(preimage);
  const report = Object.freeze({
    ...preimage,
    evidenceCanonicalJson,
    evidenceDigest: Object.freeze({
      algorithm: "sha256" as const,
      encoding: "hex" as const,
      value: sha256HexUtf8(evidenceCanonicalJson),
    }),
  });
  const artifactPath = join(resolve(config.executionDirectory), REPORT_FILENAME);
  const custodyArtifactPath = join(
    resolve(config.custodyDirectory),
    REPORT_FILENAME
  );
  const written = await writeCanonicalArtifact(artifactPath, report);
  await atomicWrite(
    custodyArtifactPath,
    await readFile(artifactPath, "utf8")
  );
  if (!overallPass) {
    throw new Error(
      `Integrated AFC-SR1 control certification failed; report: ${artifactPath}`
    );
  }
  return Object.freeze({
    artifactPath,
    custodyArtifactPath,
    canonicalByteLength: written.byteLength,
    sha256: written.sha256,
    report,
  });
}
