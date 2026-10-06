/**
 * Per-room Catalog drawer visibility.
 *
 * A missing 3D scene row is the new-room signal (no furniture has been saved
 * for this room yet). A persisted empty scene is an existing room and must
 * not reopen the drawer. After the first entry is established, the room's
 * last expanded/collapsed choice wins, including on later visits while the
 * scene row is still missing.
 */

export const STAGE_CATALOG_DRAWER_STORAGE_KEY = "vibode:stage-catalog-drawer/v1";

export type StageCatalogDrawerPreference = "expanded" | "collapsed";

/** Authoritative furniture-scene baseline for the room currently in STAGE. */
export type StageFurnitureBaseline =
  | "unresolved"
  | "missing"
  | "persisted"
  | "incompatible"
  | "unavailable";

export type CatalogDrawerResolution = Readonly<{
  /** Drawer should render expanded. False while the visit is still unresolved. */
  open: boolean;
  /** False until a stored choice or a finished scene baseline can decide. */
  settled: boolean;
  /** Persist this choice for the room. Null when nothing new should be written. */
  establish: StageCatalogDrawerPreference | null;
}>;

const PREFERENCES = new Set<StageCatalogDrawerPreference>(["expanded", "collapsed"]);

function isPreference(value: unknown): value is StageCatalogDrawerPreference {
  return typeof value === "string" && PREFERENCES.has(value as StageCatalogDrawerPreference);
}

function emptyStore(): Record<string, StageCatalogDrawerPreference> {
  return {};
}

export function parseCatalogDrawerStore(value: unknown): Record<string, StageCatalogDrawerPreference> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyStore();
  const rooms = (value as { rooms?: unknown }).rooms;
  if (!rooms || typeof rooms !== "object" || Array.isArray(rooms)) return emptyStore();
  const parsed: Record<string, StageCatalogDrawerPreference> = {};
  for (const [roomId, preference] of Object.entries(rooms)) {
    if (!roomId.trim() || !isPreference(preference)) continue;
    parsed[roomId] = preference;
  }
  return parsed;
}

export function readCatalogDrawerPreference(
  storage: Pick<Storage, "getItem"> | null | undefined,
  roomId: string | null | undefined,
): StageCatalogDrawerPreference | null {
  if (!storage || !roomId?.trim()) return null;
  try {
    const raw = storage.getItem(STAGE_CATALOG_DRAWER_STORAGE_KEY);
    if (!raw) return null;
    const rooms = parseCatalogDrawerStore(JSON.parse(raw));
    return rooms[roomId] ?? null;
  } catch {
    return null;
  }
}

export function writeCatalogDrawerPreference(
  storage: Pick<Storage, "getItem" | "setItem"> | null | undefined,
  roomId: string | null | undefined,
  preference: StageCatalogDrawerPreference,
): void {
  if (!storage || !roomId?.trim() || !isPreference(preference)) return;
  let rooms = emptyStore();
  try {
    const raw = storage.getItem(STAGE_CATALOG_DRAWER_STORAGE_KEY);
    if (raw) rooms = parseCatalogDrawerStore(JSON.parse(raw));
  } catch {
    rooms = emptyStore();
  }
  if (rooms[roomId] === preference) return;
  rooms[roomId] = preference;
  try {
    storage.setItem(
      STAGE_CATALOG_DRAWER_STORAGE_KEY,
      JSON.stringify({ rooms }),
    );
  } catch {
    // Privacy mode or quota must not break STAGE.
  }
}

/**
 * Resolve Catalog visibility for one room visit.
 *
 * Stored choice always wins. A missing scene row with no stored choice is
 * the first STAGE entry of a new uploaded room and starts expanded. Any
 * other finished baseline (including a persisted empty scene) stays collapsed.
 */
export function resolveCatalogDrawerOpen(input: Readonly<{
  preference: StageCatalogDrawerPreference | null;
  baseline: StageFurnitureBaseline;
}>): CatalogDrawerResolution {
  if (input.preference === "expanded" || input.preference === "collapsed") {
    return {
      open: input.preference === "expanded",
      settled: true,
      establish: null,
    };
  }
  if (input.baseline === "unresolved") {
    return { open: false, settled: false, establish: null };
  }
  if (input.baseline === "missing") {
    return { open: true, settled: true, establish: "expanded" };
  }
  return { open: false, settled: true, establish: null };
}
