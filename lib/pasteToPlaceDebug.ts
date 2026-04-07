function hashString(input: string): string {
  let hash = 2166136261;
  for (let idx = 0; idx < input.length; idx += 1) {
    hash ^= input.charCodeAt(idx);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function hashDataUrlForLogs(dataUrl: string | null | undefined): string | null {
  if (typeof dataUrl !== "string" || dataUrl.trim().length === 0) return null;
  return hashString(dataUrl);
}
