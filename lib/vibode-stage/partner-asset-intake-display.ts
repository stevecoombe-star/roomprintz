/**
 * Merchant-facing display helpers for Partner GLB intake.
 * Display rounding only. Do not use before validation or persistence.
 */

export function formatPartnerIntakeMetres(value: number): string {
  return value.toFixed(3);
}

export function formatPartnerIntakeMetresTriple(
  widthM: number,
  heightM: number,
  depthM: number,
): string {
  return `${formatPartnerIntakeMetres(widthM)} × ${formatPartnerIntakeMetres(heightM)} × ${formatPartnerIntakeMetres(depthM)} m`;
}

export function formatSha256Prefix(sha256: string, length = 12): string {
  return sha256.slice(0, length);
}
