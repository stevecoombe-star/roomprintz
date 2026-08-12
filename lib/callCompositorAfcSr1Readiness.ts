import "server-only";

import {
  callCompositorJson,
  CompositorTransportError,
  resolveCompositorEndpoint,
} from "./compositorTransportError";

export const AFC_SR1_READINESS_PATH =
  "/api/research/afc-sr1/readiness" as const;
export const AFC_SR1_READINESS_SCHEMA_VERSION =
  "afc-sr1-readiness/v1" as const;

export type AfcSr1ReadinessV1 = Readonly<{
  schemaVersion: typeof AFC_SR1_READINESS_SCHEMA_VERSION;
  readerEnabled: boolean;
  placementEnabled: boolean;
}>;

function isExactReadiness(value: unknown): value is AfcSr1ReadinessV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).sort().join(",") ===
      "placementEnabled,readerEnabled,schemaVersion" &&
    record.schemaVersion === AFC_SR1_READINESS_SCHEMA_VERSION &&
    typeof record.readerEnabled === "boolean" &&
    typeof record.placementEnabled === "boolean"
  );
}

export async function callCompositorAfcSr1Readiness(
  signal?: AbortSignal
): Promise<AfcSr1ReadinessV1> {
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
