import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { modelThumbnailObjectPath } from "./policy";

const ROOT = process.cwd();
const SHA = "ab".repeat(32);

/**
 * PostgreSQL's regex compiler rejects a bound quantifier above 255
 * with "invalid regular expression: invalid repetition count(s)".
 */
const POSTGRES_REGEX_DUPMAX = 255;

const LIVE_ASSET_IDS = [
  "afc-v2-runtime/partners/demo-furniture-co/demo-coffee-table-v1",
  "vibode-stage/partner-intake/f9c22d42-c447-4506-aac6-85a219a8a7fc",
];

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function repetitionUpperBounds(pattern: string): number[] {
  const bounds: number[] = [];
  let inClass = false;
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "\\" ) {
      index += 1;
      continue;
    }
    if (char === "[") {
      inClass = true;
      continue;
    }
    if (char === "]" && inClass) {
      inClass = false;
      continue;
    }
    if (inClass || char !== "{") continue;
    const match = /\{(\d+)(?:,(\d+))?\}/.exec(pattern.slice(index));
    if (!match) continue;
    const upper = Number(match[2] ?? match[1]);
    bounds.push(upper);
    index += match[0].length - 1;
  }
  return bounds;
}

function pathCheckPattern(sql: string): string {
  const match = sql.match(/storage_path ~ '(\^models\/[^']+)'/);
  assert.ok(match?.[1], "path check must contain a storage_path regex");
  return match[1];
}

test("the applied path regex is illegal in PostgreSQL", () => {
  const applied = source("supabase/migrations/20261001200000_vibode_stage_model_thumbnails.sql");
  const pattern = pathCheckPattern(applied);
  assert.equal(pattern, "^models/[A-Za-z0-9._/-]{1,480}/[a-f0-9]{64}\\.webp$");
  const upper = Math.max(...repetitionUpperBounds(pattern));
  assert.equal(upper, 480);
  assert.ok(upper > POSTGRES_REGEX_DUPMAX);
});

test("live asset ids satisfy the corrected thumbnail path check", () => {
  const fix = source("supabase/migrations/20261001220000_vibode_stage_model_thumbnail_path_regex.sql");
  assert.match(fix, /drop constraint if exists vibode_stage_model_thumbnails_path_safe/);
  assert.match(fix, /position\('\.\.' in storage_path\) = 0/);
  const pattern = pathCheckPattern(fix);
  const bounds = repetitionUpperBounds(pattern);
  assert.ok(bounds.length > 0);
  assert.ok(bounds.every((bound) => bound <= POSTGRES_REGEX_DUPMAX));
  const expression = new RegExp(pattern);
  const maxLength = Number(fix.match(/char_length\(storage_path\) <= (\d+)/)?.[1]);
  assert.equal(maxLength, 557);

  for (const assetId of LIVE_ASSET_IDS) {
    const storagePath = modelThumbnailObjectPath(assetId, SHA);
    assert.equal(storagePath, `models/${assetId}/${SHA}.webp`);
    assert.match(storagePath, expression);
    assert.equal(storagePath.includes(".."), false);
    assert.ok(storagePath.length <= maxLength);
  }

  const traversal = `models/../secret/${SHA}.webp`;
  assert.equal(expression.test(traversal), true);
  assert.equal(traversal.includes(".."), true);
  assert.equal(modelThumbnailObjectPath("../secret", SHA), null);
  assert.equal(expression.test(`models/has space/${SHA}.webp`), false);
});

test("persistence failures name the stage and asset", () => {
  const persist = source("lib/vibode-model-thumbnail/persist.server.ts");
  assert.match(persist, /stage: "thumbnail_upsert"/);
  assert.match(persist, /stage: "storage_upload"/);
  assert.match(persist, /stage=\$\{input\.stage\} assetId=\$\{input\.assetId\} errorCode=\$\{input\.errorCode\}/);
  assert.doesNotMatch(persist, /console\.error\([^)]*signedUrl/);
});
