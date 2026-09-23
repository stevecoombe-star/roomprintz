"use client";

import { useId, useMemo, useState } from "react";

import {
  buildAfcProposalReceiptInventoryView,
  DEFAULT_AFC_PROPOSAL_RECEIPT_FILTERS,
  deriveAfcProposalReceiptRoomOptions,
  deriveAfcProposalReceiptShortCandidateId,
  isAfcProposalReceiptSelectedRowVisible,
  mapAfcProposalReceiptArmLabel,
  showSelectedAfcProposalReceipt,
  type AfcProposalReceiptArmFilter,
  type AfcProposalReceiptInventoryItem,
  type AfcProposalReceiptSortMode,
} from "./afc-proposal-receipt-inventory-view";

export type AfcProposalReceiptInventoryStatus = "idle" | "loading" | "loaded" | "failure";

export type AfcProposalReceiptBrowserProps = Readonly<{
  receipts: readonly AfcProposalReceiptInventoryItem[];
  inventoryStatus: AfcProposalReceiptInventoryStatus;
  invalidCandidateCount: number;
  selectedReceiptFileName: string;
  loadedReceiptFileName: string | null;
  onSelectReceipt: (receiptFileName: string) => void;
}>;

const SORT_OPTIONS: ReadonlyArray<readonly [AfcProposalReceiptSortMode, string]> = [
  ["newest", "Newest first"],
  ["oldest", "Oldest first"],
  ["room-asc", "Room A–Z"],
  ["room-desc", "Room Z–A"],
  ["study-mode", "Study mode"],
];

function localTimestamp(createdAt: string): string {
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? createdAt : date.toLocaleString();
}

export default function AfcProposalReceiptBrowser({
  receipts,
  inventoryStatus,
  invalidCandidateCount,
  selectedReceiptFileName,
  loadedReceiptFileName,
  onSelectReceipt,
}: AfcProposalReceiptBrowserProps) {
  const id = useId();
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<AfcProposalReceiptSortMode>("newest");
  const [roomId, setRoomId] = useState(DEFAULT_AFC_PROPOSAL_RECEIPT_FILTERS.roomId);
  const [arm, setArm] = useState<AfcProposalReceiptArmFilter>(
    DEFAULT_AFC_PROPOSAL_RECEIPT_FILTERS.arm
  );
  const roomOptions = useMemo(() => deriveAfcProposalReceiptRoomOptions(receipts), [receipts]);
  const view = useMemo(
    () => buildAfcProposalReceiptInventoryView(receipts, { roomId, arm }, search, sortMode),
    [arm, receipts, roomId, search, sortMode]
  );
  const selectedReceipt = receipts.find(
    (receipt) => receipt.receiptFileName === selectedReceiptFileName
  );
  const selectedIsVisible = isAfcProposalReceiptSelectedRowVisible(
    view.receipts,
    selectedReceiptFileName
  );
  const loadedIsVisible = loadedReceiptFileName
    ? view.receipts.some((receipt) => receipt.receiptFileName === loadedReceiptFileName)
    : true;
  const hasInventory = receipts.length > 0;
  const resultLabel = `${view.receipts.length} ${view.receipts.length === 1 ? "receipt matches" : "receipts match"}`;

  const showSelected = () => {
    const revealed = showSelectedAfcProposalReceipt({ search, sortMode, roomId, arm });
    setSearch(revealed.search);
    setRoomId(revealed.roomId);
    setArm(revealed.arm);
  };

  return (
    <section className="min-w-0 flex-1 space-y-3 rounded-lg border border-slate-700 bg-slate-950/45 p-3">
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <label className="grid gap-1 text-slate-300 md:col-span-2 xl:col-span-1" htmlFor={`${id}-search`}>
          <span>Search receipts</span>
          <input
            id={`${id}-search`}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Room, arm, candidate, SHA…"
            className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 outline-none focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/40"
          />
        </label>
        <label className="grid gap-1 text-slate-300" htmlFor={`${id}-sort`}>
          <span>Sort</span>
          <select
            id={`${id}-sort`}
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value as AfcProposalReceiptSortMode)}
            className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
          >
            {SORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-slate-300" htmlFor={`${id}-room`}>
          <span>Room</span>
          <select
            id={`${id}-room`}
            value={roomId}
            onChange={(event) => setRoomId(event.target.value)}
            className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
          >
            <option value="">All rooms</option>
            {roomOptions.map((room) => <option key={room} value={room}>{room}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-slate-300" htmlFor={`${id}-arm`}>
          <span>Arm</span>
          <select
            id={`${id}-arm`}
            value={arm}
            onChange={(event) => setArm(event.target.value as AfcProposalReceiptArmFilter)}
            className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
          >
            <option value="all">All arms</option>
            <option value="original">Original</option>
            <option value="empty">Empty</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p aria-live="polite" className="text-slate-300">{resultLabel}</p>
        {inventoryStatus === "loading" ? <p role="status" className="text-amber-200">Receipt discovery is loading…</p> : null}
        {inventoryStatus === "failure" ? <p role="alert" className="text-rose-200">Receipt discovery failed.{hasInventory ? " The previous inventory is retained." : ""}</p> : null}
      </div>

      {invalidCandidateCount > 0 ? (
        <p className="rounded border border-amber-800/70 bg-amber-950/20 p-2 text-amber-100">
          {invalidCandidateCount} receipt {invalidCandidateCount === 1 ? "candidate was" : "candidates were"} skipped because {invalidCandidateCount === 1 ? "it does" : "they do"} not satisfy the strict receipt contract.
        </p>
      ) : null}

      {inventoryStatus === "idle" && !hasInventory ? (
        <p className="rounded border border-slate-700 p-3 text-slate-400">Receipts have not been discovered yet.</p>
      ) : inventoryStatus === "loading" && !hasInventory ? (
        <p className="rounded border border-slate-700 p-3 text-slate-400">Discovering receipt inventory…</p>
      ) : inventoryStatus === "failure" && !hasInventory ? (
        <p className="rounded border border-rose-900/70 p-3 text-rose-200">Receipt inventory could not be discovered.</p>
      ) : inventoryStatus === "loaded" && !hasInventory ? (
        <p className="rounded border border-slate-700 p-3 text-slate-400">Discovery completed with zero valid receipts.</p>
      ) : hasInventory && view.receipts.length === 0 ? (
        <p className="rounded border border-slate-700 p-3 text-slate-400">No receipts match the current search and filters.</p>
      ) : null}

      {view.groups.length > 0 ? (
        <fieldset className="min-w-0">
          <legend className="mb-2 font-medium text-slate-100">Proposal receipts</legend>
          <div className="max-h-96 space-y-3 overflow-auto pr-1">
            {view.groups.map((group) => (
              <section key={group.roomId} aria-labelledby={`${id}-group-${group.roomId}`}>
                <h3 id={`${id}-group-${group.roomId}`} className="sticky top-0 z-10 flex justify-between border-b border-slate-700 bg-slate-950/95 px-2 py-1.5 text-slate-200">
                  <span>{group.roomId}</span>
                  <span>{group.receipts.length} {group.receipts.length === 1 ? "match" : "matches"}</span>
                </h3>
                <div className="space-y-1 pt-1">
                  {group.receipts.map((receipt) => {
                    const armLabel = mapAfcProposalReceiptArmLabel(receipt.imageRole);
                    const selected = receipt.receiptFileName === selectedReceiptFileName;
                    const loaded = receipt.receiptFileName === loadedReceiptFileName;
                    return (
                      <label
                        key={receipt.receiptFileName}
                        className={`flex cursor-pointer items-start gap-2 rounded border p-2 outline-none focus-within:ring-2 focus-within:ring-emerald-400 ${selected ? "border-emerald-500 bg-emerald-950/25" : "border-slate-800 bg-slate-950/60"}`}
                      >
                        <input
                          type="radio"
                          name={`${id}-receipt`}
                          value={receipt.receiptFileName}
                          checked={selected}
                          onChange={() => onSelectReceipt(receipt.receiptFileName)}
                          className="mt-1 accent-emerald-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2 text-slate-100">
                            <span className="font-medium">{receipt.roomId}</span>
                            <span className="rounded border border-slate-600 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">{armLabel}</span>
                            <time dateTime={receipt.createdAt} suppressHydrationWarning>{localTimestamp(receipt.createdAt)}</time>
                            {selected ? <span className="font-medium text-emerald-200">Selected</span> : null}
                            {loaded ? <span className="font-medium text-sky-200">Loaded</span> : null}
                          </span>
                          <span className="mt-1 block break-all text-[11px] text-slate-400">
                            {deriveAfcProposalReceiptShortCandidateId(receipt.r3cCandidateId)} · not replayed — verified on Load
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </fieldset>
      ) : null}

      {selectedReceipt && !selectedIsVisible ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-800/70 bg-amber-950/20 p-2 text-amber-100">
          <span>The selected receipt is hidden by the current search or filters.</span>
          <button type="button" onClick={showSelected} className="rounded border border-amber-600 px-2 py-1 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300">Show selected</button>
        </div>
      ) : null}

      {loadedReceiptFileName && !loadedIsVisible ? (
        <p className="rounded border border-sky-800/70 bg-sky-950/20 p-2 text-sky-100">
          The loaded receipt remains rendered below but is hidden from the current inventory results.
        </p>
      ) : null}

      {selectedReceipt ? (
        <section className="rounded border border-slate-700 bg-slate-950/70 p-2" aria-label="Selected receipt details">
          <h3 className="font-medium text-slate-100">Selected receipt details</h3>
          <dl className="mt-1 grid gap-1 text-[11px] sm:grid-cols-[max-content_1fr]">
            <dt className="text-slate-500">Filename</dt><dd className="break-all">{selectedReceipt.receiptFileName}</dd>
            <dt className="text-slate-500">Receipt SHA</dt><dd className="break-all">{selectedReceipt.receiptSha256}</dd>
            <dt className="text-slate-500">Candidate ID</dt><dd className="break-all">{selectedReceipt.r3cCandidateId}</dd>
            <dt className="text-slate-500">Created</dt><dd className="break-all">{selectedReceipt.createdAt}</dd>
          </dl>
        </section>
      ) : null}
    </section>
  );
}
