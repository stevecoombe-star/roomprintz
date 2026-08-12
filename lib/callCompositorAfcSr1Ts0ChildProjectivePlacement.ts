import "server-only";

import type {
  AfcSr1Ts0LineageIdentityV1,
} from "@/app/admin/3d-room-lab/research/afc-sr1-ts0-child-projective-placement";

export const AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_PATH =
  "/api/research/afc-sr1/ts0-child-projective-placement" as const;

export type AfcSr1Ts0ChildProjectivePlacementRegistrationExclusionV1 =
  Readonly<{
    coordinateSpace: "source-normalized/v1";
    role: "registration_exclusion_support_only_not_placement_authority";
    evidenceLabel:
      "STRICT_EMPTY_POLYGON_USED_AS_REGISTRATION_EXCLUSION_MASK_ONLY";
    polygon: readonly (readonly [number, number])[];
  }>;

export type CallCompositorAfcSr1Ts0ChildProjectivePlacementArgs = Readonly<{
  parentImageBytes: Uint8Array;
  childImageBytes: Uint8Array;
  policyVersion: "afc-sr1-ts0-child-projective-placement-policy/v1";
  registrationExclusion:
    AfcSr1Ts0ChildProjectivePlacementRegistrationExclusionV1;
  ts0Lineage: AfcSr1Ts0LineageIdentityV1;
  signal?: AbortSignal;
}>;

function compositorBaseUrl(): string {
  const endpointBase = process.env.ROOMPRINTZ_COMPOSITOR_URL?.trim();
  if (!endpointBase) {
    throw new Error(
      "ROOMPRINTZ_COMPOSITOR_URL is not set in env (RoomPrintz compositor endpoint)."
    );
  }
  return endpointBase
    .replace(/\/stage-room\/?$/, "")
    .replace(/\/api\/vibode\/stage-run\/?$/, "")
    .replace(/\/vibode\/stage-run\/?$/, "")
    .replace(/\/vibode\/compose\/?$/, "")
    .replace(/\/$/, "");
}

export async function callCompositorAfcSr1Ts0ChildProjectivePlacement(
  args: CallCompositorAfcSr1Ts0ChildProjectivePlacementArgs
): Promise<unknown> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const apiKey = process.env.ROOMPRINTZ_COMPOSITOR_API_KEY?.trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const payload = {
    parentImageBase64: Buffer.from(args.parentImageBytes).toString("base64"),
    childImageBase64: Buffer.from(args.childImageBytes).toString("base64"),
    policyVersion: args.policyVersion,
    registrationExclusion: args.registrationExclusion,
    ts0Lineage: args.ts0Lineage,
  };
  const response = await fetch(
    `${compositorBaseUrl()}${AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_PATH}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: args.signal,
    }
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Compositor backend error (AFC-SR1 TS0 child placement): ${response.status} ${text}`.trim()
    );
  }
  return response.json();
}
