"use client";

type MyRoomsContextBarProps = {
  label: string;
  count: number;
};

export function MyRoomsContextBar({ label, count }: MyRoomsContextBarProps) {
  return (
    <div className="mt-3 flex items-center justify-between rounded-xl border border-line bg-canvas-warm px-3 py-2">
      <div className="truncate text-xs text-ink">{label}</div>
      <div className="shrink-0 text-[11px] text-ink-secondary">
        {count} {count === 1 ? "room" : "rooms"}
      </div>
    </div>
  );
}
