const HARMONIZE_JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isHarmonizeJobId(value: string): boolean {
  return HARMONIZE_JOB_ID.test(value);
}
