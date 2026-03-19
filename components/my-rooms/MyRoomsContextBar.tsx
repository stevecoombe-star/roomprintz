"use client";

type MyRoomsContextBarProps = {
  label: string;
  count: number;
};

export function MyRoomsContextBar({ label, count }: MyRoomsContextBarProps) {
  return (
    <div className="mt-3 flex items-center justify-between rounded-xl border border-slate-800/80 bg-slate-900/35 px-3 py-2">
      <div className="truncate text-xs text-slate-300">{label}</div>
      <div className="shrink-0 text-[11px] text-slate-500">
        {count} {count === 1 ? "room" : "rooms"}
      </div>
    </div>
  );
}
