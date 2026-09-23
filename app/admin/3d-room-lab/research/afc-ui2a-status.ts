/** Read-only inventory of UI2A-1 Original-preparation receipts. */
import "server-only";

import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { computeCalibrationImageFingerprint } from "@/lib/vibodeCalibrationImageBasis";
import {
  normalizeAfcUi2aRoomLabel,
  originalPreparationReceiptFilename,
  parseAfcUi2aOriginalPreparationReceipt,
} from "./afc-ui2a-original-preparation-contract";
import { resolveAfcUi2aFixedInputsRoot } from "./afc-ui2a-fixed-input-root";

export type AfcUi2aPreparationSummary = Readonly<{
  preparationId: string;
  roomId: string;
  originalSha256: string;
  decodedWidth: number;
  decodedHeight: number;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  originalFileName: string;
  receiptFileName: string;
  receiptSha256: string;
  matchesCurrentFingerprint: boolean | null;
}>;

export type AfcUi2aStatusOptions = Readonly<{
  roomLabel?: string;
  expectedFingerprint?: string;
  resolveFixedInputsRoot?: typeof resolveAfcUi2aFixedInputsRoot;
}>;

function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
function isDigest(value: string | undefined): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
async function safeDirectory(parent: string, name: string): Promise<string | null> {
  const target = path.resolve(parent, name);
  if (!inside(parent, target) || path.basename(target) !== name) return null;
  try {
    const info = await lstat(target);
    if (!info.isDirectory() || info.isSymbolicLink()) return null;
    const actual = await realpath(target);
    return inside(parent, actual) ? actual : null;
  } catch {
    return null;
  }
}
async function safeFile(parent: string, name: string): Promise<Buffer | null> {
  const target = path.resolve(parent, name);
  if (!inside(parent, target) || path.basename(target) !== name) return null;
  try {
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink()) return null;
    const actual = await realpath(target);
    return inside(parent, actual) ? readFile(actual) : null;
  } catch {
    return null;
  }
}

export async function discoverAfcUi2aOriginalPreparations(options: AfcUi2aStatusOptions = {}): Promise<readonly AfcUi2aPreparationSummary[]> {
  const roomFilter = options.roomLabel === undefined ? null : normalizeAfcUi2aRoomLabel(options.roomLabel);
  if (options.roomLabel !== undefined && !roomFilter) return [];
  if (options.expectedFingerprint !== undefined && !isDigest(options.expectedFingerprint)) return [];
  const rootResult = await (options.resolveFixedInputsRoot ?? resolveAfcUi2aFixedInputsRoot)(process.env.AFC_UI1_FIXED_INPUTS_ROOT);
  if (!rootResult.ok) return [];
  let fixedRoot: string;
  try {
    const info = await lstat(rootResult.root);
    if (!info.isDirectory() || info.isSymbolicLink()) return [];
    fixedRoot = await realpath(rootResult.root);
  } catch {
    return [];
  }
  let roomNames: string[];
  try {
    roomNames = await readdir(fixedRoot);
  } catch {
    return [];
  }
  const summaries: AfcUi2aPreparationSummary[] = [];
  for (const roomName of roomNames.sort()) {
    if (roomFilter && roomName !== roomFilter) continue;
    const room = await safeDirectory(fixedRoot, roomName);
    if (!room) continue;
    let names: string[];
    try {
      names = await readdir(room);
    } catch {
      continue;
    }
    for (const receiptFileName of names.sort()) {
      const match = /^afc-ui2a-original-preparation\.([a-z][a-z0-9-]{0,63})\.([a-f0-9]{64})\.receipt\.json$/.exec(receiptFileName);
      if (!match || match[1] !== roomName || receiptFileName !== originalPreparationReceiptFilename(match[1], match[2])) continue;
      const bytes = await safeFile(room, receiptFileName);
      if (!bytes) continue;
      try {
        const parsed = parseAfcUi2aOriginalPreparationReceipt(JSON.parse(bytes.toString("utf8")));
        if (!parsed.ok || parsed.receipt.roomId !== roomName || parsed.receipt.original.sha256 !== match[2]) continue;
        summaries.push(Object.freeze({
          preparationId: parsed.receipt.preparationId,
          roomId: parsed.receipt.roomId,
          originalSha256: parsed.receipt.original.sha256,
          decodedWidth: parsed.receipt.original.decodedWidth,
          decodedHeight: parsed.receipt.original.decodedHeight,
          mimeType: parsed.receipt.original.mimeType,
          originalFileName: parsed.receipt.original.fileName,
          receiptFileName,
          receiptSha256: computeCalibrationImageFingerprint(bytes),
          matchesCurrentFingerprint: options.expectedFingerprint === undefined ? null : options.expectedFingerprint === parsed.receipt.original.sha256,
        }));
      } catch {
        // A malformed local research receipt is not an executable artifact and is
        // deliberately withheld from the inventory.
      }
    }
  }
  return Object.freeze(summaries.sort((a, b) => a.roomId.localeCompare(b.roomId) || a.receiptFileName.localeCompare(b.receiptFileName)));
}
