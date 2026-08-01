export type AfcProposalReceiptInventoryItem = Readonly<{
  receiptFileName: string;
  receiptSha256: string;
  createdAt: string;
  roomId: string;
  studyMode: string;
  imageRole: string;
  requestId: string;
  r3cCandidateId: string;
  candidateCount: number;
}>;

export type AfcProposalReceiptSummary = AfcProposalReceiptInventoryItem;

export type AfcProposalReceiptArmLabel = "Original" | "Empty";
export type AfcProposalReceiptArmFilter = "all" | "original" | "empty";
export type AfcProposalReceiptSortMode =
  | "newest"
  | "oldest"
  | "room-asc"
  | "room-desc"
  | "study-mode";

export type AfcProposalReceiptInventoryFilters = Readonly<{
  roomId: string;
  arm: AfcProposalReceiptArmFilter;
}>;

export type AfcProposalReceiptGroup = Readonly<{
  roomId: string;
  receipts: readonly AfcProposalReceiptSummary[];
}>;

export type AfcProposalReceiptInventoryView = Readonly<{
  receipts: readonly AfcProposalReceiptSummary[];
  groups: readonly AfcProposalReceiptGroup[];
}>;

export type AfcProposalReceiptBrowserCriteria = Readonly<{
  search: string;
  sortMode: AfcProposalReceiptSortMode;
  roomId: string;
  arm: AfcProposalReceiptArmFilter;
}>;

export const DEFAULT_AFC_PROPOSAL_RECEIPT_FILTERS: AfcProposalReceiptInventoryFilters =
  Object.freeze({ roomId: "", arm: "all" });

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareCreatedAtAscending(
  left: AfcProposalReceiptSummary,
  right: AfcProposalReceiptSummary
): number {
  return Date.parse(left.createdAt) - Date.parse(right.createdAt);
}

function compareCreatedAtDescending(
  left: AfcProposalReceiptSummary,
  right: AfcProposalReceiptSummary
): number {
  return Date.parse(right.createdAt) - Date.parse(left.createdAt);
}

export function normalizeAfcProposalReceiptSearch(value: string): string {
  return value.toLowerCase().replace(/[-_\s]+/g, " ").trim();
}

export function deriveAfcProposalReceiptShortCandidateId(candidateId: string): string {
  const separator = candidateId.lastIndexOf(":");
  return separator >= 0 && separator < candidateId.length - 1
    ? candidateId.slice(separator + 1)
    : candidateId;
}

export function mapAfcProposalReceiptArmLabel(
  imageRole: string
): AfcProposalReceiptArmLabel | null {
  if (imageRole === "original_contextual") return "Original";
  if (imageRole === "empty_room_boundary_specialist") return "Empty";
  return null;
}

export function formatAfcProposalReceiptStableUtc(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "";
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

export function buildAfcProposalReceiptSearchHaystack(
  receipt: AfcProposalReceiptSummary
): string {
  return normalizeAfcProposalReceiptSearch([
    receipt.roomId,
    receipt.studyMode,
    receipt.imageRole,
    mapAfcProposalReceiptArmLabel(receipt.imageRole) ?? "",
    receipt.createdAt,
    formatAfcProposalReceiptStableUtc(receipt.createdAt),
    receipt.receiptFileName,
    receipt.receiptSha256,
    receipt.requestId,
    receipt.r3cCandidateId,
    deriveAfcProposalReceiptShortCandidateId(receipt.r3cCandidateId),
  ].join(" "));
}

export function deriveAfcProposalReceiptRoomOptions(
  receipts: readonly AfcProposalReceiptSummary[]
): readonly string[] {
  return [...new Set(receipts.map((receipt) => receipt.roomId))].sort(compareText);
}

export function filterAfcProposalReceipts(
  receipts: readonly AfcProposalReceiptSummary[],
  filters: AfcProposalReceiptInventoryFilters
): readonly AfcProposalReceiptSummary[] {
  return receipts.filter((receipt) => {
    if (filters.roomId && receipt.roomId !== filters.roomId) return false;
    if (filters.arm === "all") return true;
    const label = mapAfcProposalReceiptArmLabel(receipt.imageRole);
    return filters.arm === "original" ? label === "Original" : label === "Empty";
  });
}

export function searchAfcProposalReceipts(
  receipts: readonly AfcProposalReceiptSummary[],
  query: string
): readonly AfcProposalReceiptSummary[] {
  const normalized = normalizeAfcProposalReceiptSearch(query);
  if (!normalized) return [...receipts];
  const tokens = normalized.split(" ");
  return receipts.filter((receipt) => {
    const haystack = buildAfcProposalReceiptSearchHaystack(receipt);
    return tokens.every((token) => haystack.includes(token));
  });
}

export const compareAfcProposalReceiptsNewestFirst = (
  left: AfcProposalReceiptSummary,
  right: AfcProposalReceiptSummary
): number =>
  compareCreatedAtDescending(left, right) ||
  compareText(left.roomId, right.roomId) ||
  compareText(left.studyMode, right.studyMode) ||
  compareText(left.receiptSha256, right.receiptSha256);

export const compareAfcProposalReceiptsOldestFirst = (
  left: AfcProposalReceiptSummary,
  right: AfcProposalReceiptSummary
): number =>
  compareCreatedAtAscending(left, right) ||
  compareText(left.roomId, right.roomId) ||
  compareText(left.studyMode, right.studyMode) ||
  compareText(left.receiptSha256, right.receiptSha256);

export const compareAfcProposalReceiptsRoomAscending = (
  left: AfcProposalReceiptSummary,
  right: AfcProposalReceiptSummary
): number =>
  compareText(left.roomId, right.roomId) ||
  compareCreatedAtDescending(left, right) ||
  compareText(left.studyMode, right.studyMode) ||
  compareText(left.receiptSha256, right.receiptSha256);

export const compareAfcProposalReceiptsRoomDescending = (
  left: AfcProposalReceiptSummary,
  right: AfcProposalReceiptSummary
): number =>
  compareText(right.roomId, left.roomId) ||
  compareCreatedAtDescending(left, right) ||
  compareText(left.studyMode, right.studyMode) ||
  compareText(left.receiptSha256, right.receiptSha256);

export const compareAfcProposalReceiptsStudyMode = (
  left: AfcProposalReceiptSummary,
  right: AfcProposalReceiptSummary
): number =>
  compareText(left.studyMode, right.studyMode) ||
  compareText(left.roomId, right.roomId) ||
  compareCreatedAtDescending(left, right) ||
  compareText(left.receiptSha256, right.receiptSha256);

export function sortAfcProposalReceipts(
  receipts: readonly AfcProposalReceiptSummary[],
  mode: AfcProposalReceiptSortMode
): readonly AfcProposalReceiptSummary[] {
  const comparator = mode === "oldest"
    ? compareAfcProposalReceiptsOldestFirst
    : mode === "room-asc"
      ? compareAfcProposalReceiptsRoomAscending
      : mode === "room-desc"
        ? compareAfcProposalReceiptsRoomDescending
        : mode === "study-mode"
          ? compareAfcProposalReceiptsStudyMode
          : compareAfcProposalReceiptsNewestFirst;
  return [...receipts].sort(comparator);
}

export function groupAfcProposalReceiptsByRoom(
  sortedReceipts: readonly AfcProposalReceiptSummary[],
  mode: AfcProposalReceiptSortMode
): readonly AfcProposalReceiptGroup[] {
  const byRoom = new Map<string, AfcProposalReceiptSummary[]>();
  for (const receipt of sortedReceipts) {
    const group = byRoom.get(receipt.roomId);
    if (group) group.push(receipt);
    else byRoom.set(receipt.roomId, [receipt]);
  }
  const groups = [...byRoom].map(([roomId, receipts]) => ({ roomId, receipts }));
  groups.sort((left, right) => {
    if (mode === "room-asc") return compareText(left.roomId, right.roomId);
    if (mode === "room-desc") return compareText(right.roomId, left.roomId);
    if (mode === "study-mode") {
      return compareText(left.receipts[0].studyMode, right.receipts[0].studyMode) ||
        compareText(left.roomId, right.roomId);
    }
    const dateOrder = mode === "oldest"
      ? compareCreatedAtAscending(left.receipts[0], right.receipts[0])
      : compareCreatedAtDescending(left.receipts[0], right.receipts[0]);
    return dateOrder || compareText(left.roomId, right.roomId);
  });
  return groups;
}

export function buildAfcProposalReceiptInventoryView(
  receipts: readonly AfcProposalReceiptSummary[],
  filters: AfcProposalReceiptInventoryFilters,
  query: string,
  sortMode: AfcProposalReceiptSortMode
): AfcProposalReceiptInventoryView {
  const filtered = filterAfcProposalReceipts(receipts, filters);
  const searched = searchAfcProposalReceipts(filtered, query);
  const sorted = sortAfcProposalReceipts(searched, sortMode);
  return {
    receipts: sorted,
    groups: groupAfcProposalReceiptsByRoom(sorted, sortMode),
  };
}

export function isAfcProposalReceiptSelectedRowVisible(
  visibleReceipts: readonly AfcProposalReceiptSummary[],
  selectedReceiptFileName: string
): boolean {
  return selectedReceiptFileName.length > 0 &&
    visibleReceipts.some((receipt) => receipt.receiptFileName === selectedReceiptFileName);
}

export function showSelectedAfcProposalReceipt(
  criteria: AfcProposalReceiptBrowserCriteria
): AfcProposalReceiptBrowserCriteria {
  return {
    ...criteria,
    search: "",
    roomId: DEFAULT_AFC_PROPOSAL_RECEIPT_FILTERS.roomId,
    arm: DEFAULT_AFC_PROPOSAL_RECEIPT_FILTERS.arm,
  };
}
