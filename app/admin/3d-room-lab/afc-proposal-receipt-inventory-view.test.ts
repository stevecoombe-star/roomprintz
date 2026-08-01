import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildAfcProposalReceiptInventoryView,
  buildAfcProposalReceiptSearchHaystack,
  deriveAfcProposalReceiptRoomOptions,
  deriveAfcProposalReceiptShortCandidateId,
  filterAfcProposalReceipts,
  formatAfcProposalReceiptStableUtc,
  groupAfcProposalReceiptsByRoom,
  isAfcProposalReceiptSelectedRowVisible,
  mapAfcProposalReceiptArmLabel,
  normalizeAfcProposalReceiptSearch,
  searchAfcProposalReceipts,
  showSelectedAfcProposalReceipt,
  sortAfcProposalReceipts,
  type AfcProposalReceiptInventoryItem,
  type AfcProposalReceiptSortMode,
} from "./afc-proposal-receipt-inventory-view";

function receipt(
  receiptFileName: string,
  overrides: Partial<AfcProposalReceiptInventoryItem> = {}
): AfcProposalReceiptInventoryItem {
  return {
    receiptFileName,
    receiptSha256: "a".repeat(64),
    createdAt: "2026-07-31T20:15:00.000Z",
    roomId: "room-a",
    studyMode: "empty_only",
    imageRole: "empty_room_boundary_specialist",
    requestId: "request-a",
    r3cCandidateId: "afc-r3c:empty:afc-r3:fnv1a32:0b43131e#01",
    candidateCount: 1,
    ...overrides,
  };
}

const fixtures: readonly AfcProposalReceiptInventoryItem[] = [
  receipt("afc-r3c-run.room-b-original.receipt.json", {
    receiptSha256: "b".repeat(64),
    createdAt: "2026-07-30T12:00:00.000Z",
    roomId: "room-b",
    studyMode: "original_only",
    imageRole: "original_contextual",
    requestId: "request-b-original",
    r3cCandidateId: "afc-r3c:original:afc-r3:fnv1a32:1234abcd#01",
  }),
  receipt("afc-r3c-run.room-a-orchid47.receipt.json", {
    receiptSha256: `12${"c".repeat(30)}feed${"d".repeat(28)}`,
    createdAt: "2026-07-29T08:05:00.000Z",
  }),
  receipt("afc-r3c-run.room-c-parallel.receipt.json", {
    receiptSha256: "d".repeat(64),
    createdAt: "2026-07-28T01:02:00.000Z",
    roomId: "room-c",
    studyMode: "parallel_union",
    imageRole: "original_contextual",
    requestId: "request-c-parallel",
    // Deliberately non-authoritative namespace: imageRole remains arm authority.
    r3cCandidateId: "afc-r3c:alternate:afc-r3:fnv1a32:faceb00c#01",
  }),
  receipt("afc-r3c-run.room-a-newest.receipt.json", {
    receiptSha256: "e".repeat(64),
    createdAt: "2026-08-01T00:00:00.000Z",
    studyMode: "parallel_union",
    requestId: "request-a-newest",
  }),
  receipt("afc-r3c-run.room-b-empty.receipt.json", {
    receiptSha256: "f".repeat(64),
    createdAt: "2026-07-30T12:00:00.000Z",
    roomId: "room-b",
    requestId: "request-b-empty",
  }),
];

const names = (values: readonly AfcProposalReceiptInventoryItem[]) =>
  values.map((value) => value.receiptFileName);

test("AFC-UI1C normalizes search and builds the complete claim haystack", () => {
  assert.equal(normalizeAfcProposalReceiptSearch("  Parallel_UNION-room A  "), "parallel union room a");
  assert.equal(
    deriveAfcProposalReceiptShortCandidateId(fixtures[0].r3cCandidateId),
    "1234abcd#01"
  );
  assert.equal(mapAfcProposalReceiptArmLabel("original_contextual"), "Original");
  assert.equal(mapAfcProposalReceiptArmLabel("empty_room_boundary_specialist"), "Empty");
  assert.equal(mapAfcProposalReceiptArmLabel("unknown"), null);
  const haystack = buildAfcProposalReceiptSearchHaystack(fixtures[0]);
  for (const value of [
    "room b",
    "original only",
    "original",
    "2026 07 30t12:00:00.000z",
    "2026 07 30 12:00",
    "afc r3c run.room b original.receipt.json",
    fixtures[0].receiptSha256,
    "request b original",
    "1234abcd#01",
  ]) {
    assert.ok(haystack.includes(value), value);
  }
});

test("AFC-UI1C search supports all fields, substrings, separator equivalence, and AND tokens", () => {
  assert.deepEqual(
    names(searchAfcProposalReceipts([
      receipt("case-match", { roomId: "GalleryWest" }),
      receipt("case-miss", { roomId: "StudioEast" }),
    ], "gAlLeRyWeSt")),
    ["case-match"]
  );
  assert.deepEqual(names(searchAfcProposalReceipts(fixtures, "Original")), [fixtures[0].receiptFileName, fixtures[2].receiptFileName]);
  assert.deepEqual(names(searchAfcProposalReceipts(fixtures, "Empty")), [fixtures[1].receiptFileName, fixtures[3].receiptFileName, fixtures[4].receiptFileName]);
  assert.deepEqual(names(searchAfcProposalReceipts(fixtures, "parallel-union")), [fixtures[2].receiptFileName, fixtures[3].receiptFileName]);
  assert.deepEqual(names(searchAfcProposalReceipts(fixtures, "faceb00c#01")), [fixtures[2].receiptFileName]);
  assert.deepEqual(names(searchAfcProposalReceipts(fixtures, fixtures[2].r3cCandidateId)), [fixtures[2].receiptFileName]);
  assert.deepEqual(names(searchAfcProposalReceipts(fixtures, "orchid47.receipt")), [fixtures[1].receiptFileName]);
  assert.deepEqual(names(searchAfcProposalReceipts(fixtures, "12cc")), [fixtures[1].receiptFileName]);
  assert.deepEqual(names(searchAfcProposalReceipts(fixtures, "feed")), [fixtures[1].receiptFileName]);
  assert.deepEqual(names(searchAfcProposalReceipts(fixtures, fixtures[1].receiptSha256)), [fixtures[1].receiptFileName]);
  assert.deepEqual(names(searchAfcProposalReceipts(fixtures, "2026-07-29T08:05")), [fixtures[1].receiptFileName]);
  assert.deepEqual(names(searchAfcProposalReceipts(fixtures, "2026-07-29 08:05")), [fixtures[1].receiptFileName]);
  assert.deepEqual(names(searchAfcProposalReceipts(fixtures, "room b original 1234abcd")), [fixtures[0].receiptFileName]);
  assert.deepEqual(names(searchAfcProposalReceipts(fixtures, " \t\n ")), names(fixtures));
  assert.deepEqual(names(searchAfcProposalReceipts(fixtures, "does-not-exist")), []);
});

test("AFC-UI1C stable UTC date-time search does not depend on process timezone", () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = "Pacific/Honolulu";
    const honolulu = names(searchAfcProposalReceipts(fixtures, "2026-07-30 12:00"));
    process.env.TZ = "Asia/Tokyo";
    const tokyo = names(searchAfcProposalReceipts(fixtures, "2026-07-30 12:00"));
    assert.deepEqual(tokyo, honolulu);
    assert.equal(formatAfcProposalReceiptStableUtc(fixtures[0].createdAt), "2026-07-30 12:00");
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("AFC-UI1C sort modes are deterministic, total, and non-mutating", () => {
  const original = names(fixtures);
  assert.deepEqual(names(sortAfcProposalReceipts(fixtures, "newest")), [
    fixtures[3].receiptFileName,
    fixtures[4].receiptFileName,
    fixtures[0].receiptFileName,
    fixtures[1].receiptFileName,
    fixtures[2].receiptFileName,
  ]);
  assert.deepEqual(names(sortAfcProposalReceipts(fixtures, "oldest")), [
    fixtures[2].receiptFileName,
    fixtures[1].receiptFileName,
    fixtures[4].receiptFileName,
    fixtures[0].receiptFileName,
    fixtures[3].receiptFileName,
  ]);
  assert.deepEqual(names(sortAfcProposalReceipts(fixtures, "room-asc")), [
    fixtures[3].receiptFileName,
    fixtures[1].receiptFileName,
    fixtures[4].receiptFileName,
    fixtures[0].receiptFileName,
    fixtures[2].receiptFileName,
  ]);
  assert.deepEqual(names(sortAfcProposalReceipts(fixtures, "room-desc")), [
    fixtures[2].receiptFileName,
    fixtures[4].receiptFileName,
    fixtures[0].receiptFileName,
    fixtures[3].receiptFileName,
    fixtures[1].receiptFileName,
  ]);
  assert.deepEqual(names(sortAfcProposalReceipts(fixtures, "study-mode")), [
    fixtures[1].receiptFileName,
    fixtures[4].receiptFileName,
    fixtures[0].receiptFileName,
    fixtures[3].receiptFileName,
    fixtures[2].receiptFileName,
  ]);
  assert.deepEqual(names(fixtures), original);

  const tieHigh = receipt("high", { receiptSha256: "2".repeat(64) });
  const tieLow = receipt("low", { receiptSha256: "1".repeat(64) });
  for (const mode of ["newest", "oldest", "room-asc", "room-desc", "study-mode"] as const) {
    assert.deepEqual(names(sortAfcProposalReceipts([tieHigh, tieLow], mode)), ["low", "high"]);
  }
});

test("AFC-UI1C filters use room and imageRole authority and combine with search", () => {
  assert.deepEqual(deriveAfcProposalReceiptRoomOptions([...fixtures].reverse()), ["room-a", "room-b", "room-c"]);
  assert.deepEqual(names(filterAfcProposalReceipts(fixtures, { roomId: "", arm: "all" })), names(fixtures));
  assert.deepEqual(names(filterAfcProposalReceipts(fixtures, { roomId: "room-a", arm: "all" })), [fixtures[1].receiptFileName, fixtures[3].receiptFileName]);
  assert.deepEqual(names(filterAfcProposalReceipts(fixtures, { roomId: "", arm: "original" })), [fixtures[0].receiptFileName, fixtures[2].receiptFileName]);
  assert.deepEqual(names(filterAfcProposalReceipts(fixtures, { roomId: "", arm: "empty" })), [fixtures[1].receiptFileName, fixtures[3].receiptFileName, fixtures[4].receiptFileName]);
  assert.ok(
    names(filterAfcProposalReceipts(fixtures, { roomId: "", arm: "original" }))
      .includes(fixtures[2].receiptFileName),
    "parallel_union is Original because imageRole is authoritative"
  );
  const combined = buildAfcProposalReceiptInventoryView(
    fixtures,
    { roomId: "room-b", arm: "original" },
    "1234abcd",
    "newest"
  );
  assert.deepEqual(names(combined.receipts), [fixtures[0].receiptFileName]);
  assert.deepEqual(
    buildAfcProposalReceiptInventoryView(fixtures, { roomId: "room-c", arm: "empty" }, "", "newest").receipts,
    []
  );
});

test("AFC-UI1C grouping preserves sorted in-group rows and orders groups for every mode", () => {
  const expectedGroups: Record<AfcProposalReceiptSortMode, readonly string[]> = {
    newest: ["room-a", "room-b", "room-c"],
    oldest: ["room-c", "room-a", "room-b"],
    "room-asc": ["room-a", "room-b", "room-c"],
    "room-desc": ["room-c", "room-b", "room-a"],
    "study-mode": ["room-a", "room-b", "room-c"],
  };
  for (const mode of Object.keys(expectedGroups) as AfcProposalReceiptSortMode[]) {
    const sorted = sortAfcProposalReceipts(fixtures, mode);
    const groups = groupAfcProposalReceiptsByRoom(sorted, mode);
    assert.deepEqual(groups.map((group) => group.roomId), expectedGroups[mode], mode);
    const groupedNames = groups.flatMap((group) => names(group.receipts));
    assert.equal(new Set(groupedNames).size, fixtures.length, `${mode}: no duplicates`);
    assert.deepEqual([...groupedNames].sort(), [...names(fixtures)].sort(), `${mode}: no dropped rows`);
    for (const group of groups) {
      assert.deepEqual(
        names(group.receipts),
        names(sorted.filter((item) => item.roomId === group.roomId)),
        `${mode}: stable in-group order`
      );
    }
  }
});

test("AFC-UI1C selection remains external, hidden selection is detected, and Show selected only clears narrowing criteria", () => {
  const selected = fixtures[0].receiptFileName;
  const hiddenView = buildAfcProposalReceiptInventoryView(
    fixtures,
    { roomId: "room-a", arm: "empty" },
    "newest",
    "room-desc"
  );
  assert.equal(isAfcProposalReceiptSelectedRowVisible(hiddenView.receipts, selected), false);
  assert.equal(selected, fixtures[0].receiptFileName, "view operations do not change selection");
  const revealed = showSelectedAfcProposalReceipt({
    search: "newest",
    sortMode: "room-desc",
    roomId: "room-a",
    arm: "empty",
  });
  assert.deepEqual(revealed, { search: "", sortMode: "room-desc", roomId: "", arm: "all" });
  assert.equal(
    isAfcProposalReceiptSelectedRowVisible(
      buildAfcProposalReceiptInventoryView(fixtures, revealed, revealed.search, revealed.sortMode).receipts,
      selected
    ),
    true
  );
  assert.equal(isAfcProposalReceiptSelectedRowVisible(hiddenView.receipts, fixtures[2].receiptFileName), false, "loaded visibility uses the same non-mutating detection");
});

test("AFC-UI1C pure inventory and presentation modules preserve containment", async () => {
  const pureSource = await readFile(new URL("./afc-proposal-receipt-inventory-view.ts", import.meta.url), "utf8");
  const browserSource = await readFile(new URL("./AfcProposalReceiptBrowser.tsx", import.meta.url), "utf8");
  for (const forbidden of [
    "react",
    "node:fs",
    "server-only",
    "gemini-floor-proposal-provider",
    "gemini-floor-proposal-runner",
    "capture",
    "compositor",
  ]) {
    assert.equal(pureSource.toLowerCase().includes(forbidden), false, forbidden);
  }
  assert.equal(pureSource.includes("/Users/"), false);
  assert.doesNotMatch(browserSource, /\bfetch\s*\(|replayAfcProposalOverlay|writeFile|readFile/);
  for (const required of [
    'type="search"',
    "<fieldset",
    "<legend",
    'type="radio"',
    'aria-live="polite"',
    "not replayed — verified on Load",
    "The selected receipt is hidden by the current search or filters.",
    "The loaded receipt remains rendered below",
  ]) {
    assert.ok(browserSource.includes(required), required);
  }
});
