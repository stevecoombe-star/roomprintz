import { readFile } from "node:fs/promises";
import path from "node:path";
import { canonicalStringify, sha256Hex, type Json } from "@/lib/sceneHash";
import {
  G0_PAYLOAD_FIXTURE_BASE_DIR,
  G0_PAYLOAD_FIXTURES,
  type G0PayloadFixtureId,
} from "./assets-and-lineage";

function canonicalizeUnknown(value: unknown): Json {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeUnknown(entry));
  }
  if (typeof value === "object") {
    const output: { [k: string]: Json } = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (typeof item === "undefined") continue;
      output[key] = canonicalizeUnknown(item);
    }
    return output;
  }
  return String(value);
}

export async function loadPayloadFixture(
  fixtureId: G0PayloadFixtureId
): Promise<{ payload: unknown; payloadDigest: string; payloadIdentity: string }> {
  const fixture = G0_PAYLOAD_FIXTURES[fixtureId];
  const absolutePath = path.join(G0_PAYLOAD_FIXTURE_BASE_DIR, fixture.payloadPath);
  const raw = await readFile(absolutePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const canonicalPayload = canonicalStringify(canonicalizeUnknown(parsed));
  const payloadDigest = await sha256Hex(canonicalPayload);
  return {
    payload: parsed,
    payloadDigest,
    payloadIdentity: fixture.payloadIdentity,
  };
}
