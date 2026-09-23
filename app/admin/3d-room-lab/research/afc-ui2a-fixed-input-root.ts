import "server-only";

import { lstat, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const AFC_UI2A_FIXED_INPUTS_DIRECTORY_NAME = "vibode-afc-r3c-fixed-inputs";

function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

/** Existing, non-symlinked, home-contained fixed input root only. */
export async function resolveAfcUi2aFixedInputsRoot(configured: string | null | undefined): Promise<
  { ok: true; root: string } | { ok: false; code: "fixed_inputs_root_unavailable" | "fixed_inputs_root_disallowed" }
> {
  if (typeof configured !== "string" || !configured.trim()) return { ok: false, code: "fixed_inputs_root_unavailable" };
  if (configured.includes("\0") || !path.isAbsolute(configured)) return { ok: false, code: "fixed_inputs_root_disallowed" };
  const lexicalHome = path.resolve(os.homedir());
  const lexicalRoot = path.resolve(configured.trim());
  if (path.basename(lexicalRoot) !== AFC_UI2A_FIXED_INPUTS_DIRECTORY_NAME || !inside(lexicalHome, lexicalRoot)) return { ok: false, code: "fixed_inputs_root_disallowed" };
  try {
    const info = await lstat(lexicalRoot);
    if (!info.isDirectory() || info.isSymbolicLink()) return { ok: false, code: "fixed_inputs_root_disallowed" };
    const [realRoot, realHome] = await Promise.all([realpath(lexicalRoot), realpath(lexicalHome)]);
    if (path.basename(realRoot) !== AFC_UI2A_FIXED_INPUTS_DIRECTORY_NAME || !inside(realHome, realRoot)) return { ok: false, code: "fixed_inputs_root_disallowed" };
    return { ok: true, root: realRoot };
  } catch {
    return { ok: false, code: "fixed_inputs_root_unavailable" };
  }
}
