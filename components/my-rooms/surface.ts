/**
 * Class strings for the My Rooms retail surface.
 * These consume semantic tokens. They do not set layout size, radius, or grid.
 * `scheme-light` keeps this surface light when the operating system is dark.
 */

export const myRoomsPageClass = "scheme-light min-h-screen bg-canvas text-ink";

export const myRoomsFieldClass =
  "w-full rounded-lg border border-ink-secondary bg-canvas px-3 py-2 text-ink outline-none transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

export const myRoomsDialogScrimClass =
  "scheme-light fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4";

export const myRoomsDialogCardClass =
  "w-full max-w-md rounded-2xl border border-line bg-canvas p-5 text-ink shadow-lg";

export const myRoomsMenuItemClass =
  "w-full rounded-md px-2 py-1 text-left text-xs text-ink-secondary transition hover:bg-quiet-hover disabled:opacity-50";

export const myRoomsMenuDangerClass =
  "mt-1 w-full rounded-md px-2 py-1 text-left text-xs text-danger transition hover:bg-danger/10 disabled:opacity-50";

export const myRoomsTokenBadgeClass = {
  shell: "border-ink-secondary bg-canvas text-ink-secondary",
  label: "text-ink-secondary",
  separator: "mx-1 text-ink-secondary/70",
  value: "font-medium text-ink",
};

export const myRoomsTokenEmptyClass =
  "rounded-lg border border-danger bg-danger/10 px-3 py-2 text-xs text-danger";

export const myRoomsTokenEmptyLinkClass =
  "rounded-md border border-danger px-2 py-1 text-[11px] text-danger transition hover:bg-danger/10";

export const myRoomsTokenEmptyDetailClass = "mt-1 text-[11px] text-danger";

export const myRoomsTokenLowClass =
  "rounded-lg border border-warning bg-warning-surface px-3 py-2 text-xs text-warning";

export const myRoomsTokenLowLinkClass =
  "rounded-md border border-warning px-2 py-1 text-[11px] text-warning transition hover:bg-warning-surface";
