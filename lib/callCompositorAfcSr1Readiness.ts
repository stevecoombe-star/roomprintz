import "server-only";

import {
  callCompositorJson,
  CompositorTransportError,
  resolveCompositorEndpoint,
} from "./compositorTransportError";

export const AFC_SR1_READINESS_PATH =
  "/api/research/afc-sr1/readiness" as const;
export const AFC_SR1_READINESS_SCHEMA_VERSION =
  "afc-sr1-readiness/v2" as const;

export type AfcSr1ReadinessV2 = Readonly<{
  schemaVersion: typeof AFC_SR1_READINESS_SCHEMA_VERSION;
  readerEnabled: boolean;
  placementEnabled: boolean;
  ts0GeneratorReady: boolean;
  ts0GeneratorProfile: "afc-sr1-tile-grid-scaffold/v1";
  ts0RequestedModelId: "NBP";
}>;

function isExactReadiness(value: unknown): value is AfcSr1ReadinessV2 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).sort().join(",") ===
      "placementEnabled,readerEnabled,schemaVersion,ts0GeneratorProfile,ts0GeneratorReady,ts0RequestedModelId" &&
    record.schemaVersion === AFC_SR1_READINESS_SCHEMA_VERSION &&
    typeof record.readerEnabled === "boolean" &&
    typeof record.placementEnabled === "boolean" &&
    typeof record.ts0GeneratorReady === "boolean" &&
    record.ts0GeneratorProfile === "afc-sr1-tile-grid-scaffold/v1" &&
    record.ts0RequestedModelId === "NBP"
  );
}

export async function callCompositorAfcSr1Readiness(
  signal?: AbortSignal
): Promise<AfcSr1ReadinessV2> {
  const response = await callCompositorJson({
    seam: "readiness",
    path: AFC_SR1_READINESS_PATH,
    method: "GET",
    signal,
  });
  if (!isExactReadiness(response)) {
    throw new CompositorTransportError({
      seam: "readiness",
      classification: "malformed_response",
      httpStatus: 200,
      endpoint: resolveCompositorEndpoint(AFC_SR1_READINESS_PATH).endpoint,
    });
  }
  return Object.freeze({ ...response });
}
