export const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-300";

export const FIELD =
  `mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 ${FOCUS}`;

export const PRIMARY =
  `inline-flex items-center justify-center rounded-md bg-white px-3.5 py-2 text-sm font-medium text-slate-950 hover:bg-slate-200 ${FOCUS} disabled:cursor-not-allowed disabled:opacity-60`;

export const SECONDARY =
  `inline-flex items-center justify-center rounded-md border border-slate-600 px-3.5 py-2 text-sm text-slate-100 hover:border-slate-400 ${FOCUS} disabled:cursor-not-allowed disabled:opacity-60`;

export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
  } catch {
    return null;
  }
  return null;
}
