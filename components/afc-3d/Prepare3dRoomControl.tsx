"use client";

import {
  PREPARE_3D_ROOM_FAILURE_MESSAGE,
  canRequestPrepare,
  prepareButtonLabel,
  type Prepare3dRoomState,
} from "@/lib/afc-v2-runtime/prepare-3d-room-client";

type Props = Readonly<{
  state: Prepare3dRoomState;
  onPrepare: () => void;
}>;

export function Prepare3dRoomControl({ state, onPrepare }: Props) {
  if (state.phase === "ready" || state.phase === "checking") return null;

  const prepareDisabled = state.phase === "running" || !canRequestPrepare(state);

  return (
    <div
      className="flex flex-col items-center gap-2"
      data-prepare-3d-room="true"
      data-prepare-3d-phase={state.phase}
    >
      {state.phase === "error" && (
        <span
          className="max-w-[16rem] text-center text-xs text-red-300"
          role="alert"
        >
          {PREPARE_3D_ROOM_FAILURE_MESSAGE}
        </span>
      )}
      <button
        type="button"
        disabled={prepareDisabled}
        onClick={onPrepare}
        className={`rounded-md border px-2.5 py-1 text-xs transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400 ${
          prepareDisabled
            ? "cursor-not-allowed border-neutral-800 bg-neutral-950 text-neutral-500"
            : "border-emerald-500/70 bg-emerald-950/40 text-emerald-100 hover:bg-emerald-900/50"
        }`}
      >
        {prepareButtonLabel(state)}
      </button>
    </div>
  );
}
