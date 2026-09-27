const COPY = {
  unsaved: "Unsaved",
  saving: "Saving…",
  saved: "Saved",
  failed: "Save failed",
} as const;

export type PartnerSaveStateValue = keyof typeof COPY;

export function PartnerSaveState(props: Readonly<{ state: PartnerSaveStateValue | null }>) {
  if (!props.state) return null;
  const tone = props.state === "failed"
    ? "text-rose-200"
    : props.state === "saved"
      ? "text-emerald-200"
      : props.state === "unsaved"
        ? "text-amber-100"
        : "text-slate-300";
  return (
    <p role="status" aria-live="polite" className={`text-sm ${tone}`}>
      {COPY[props.state]}
    </p>
  );
}
