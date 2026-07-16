export const G0_PROBE_PACKAGE_VERSION = "b3h-b2i-g0-v1" as const;

export const G0_PROBE_IDS = [
  "P-crop",
  "P-empty",
  "P-gen",
  "P-stale",
  "P-url-drift",
  "P-dimension-mismatch",
  "P-coordinate-space-drift",
  "P-legacy",
  "X4",
] as const;

export type G0ProbeId = (typeof G0_PROBE_IDS)[number];
