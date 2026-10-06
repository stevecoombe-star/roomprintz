import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AFC_IMAGE_MODEL_SETTINGS_MIGRATION,
  AFC_IMAGE_MODEL_SETTINGS_TABLE,
  readAfcImageModelSettings,
  readAfcImageModelSettingsStrict,
  writeAfcImageModelSettings,
} from "./afc-image-model-settings.server";

type Row = {
  id: string;
  empty_model: string;
  tiled_model: string;
  updated_at: string;
};

function memoryClient(initial: Row | null = null) {
  let row = initial;
  const client = {
    from(table: string) {
      assert.equal(table, AFC_IMAGE_MODEL_SETTINGS_TABLE);
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({ data: row, error: null }),
              };
            },
          };
        },
        upsert(payload: Row) {
          row = payload;
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return {
    client: client as unknown as SupabaseClient,
    read: () => row,
  };
}

test("missing settings client defaults EMPTY and TILED to Nano Banana Pro", async () => {
  const settings = await readAfcImageModelSettings(null);
  assert.equal(settings.empty, "nano-banana-pro");
  assert.equal(settings.tiled, "nano-banana-pro");
  const strict = await readAfcImageModelSettingsStrict(null);
  assert.equal(strict.ok, false);
});

test("model settings persist and read independently", async () => {
  const memory = memoryClient();
  const missing = await readAfcImageModelSettings(memory.client);
  assert.equal(missing.empty, "nano-banana-pro");
  assert.equal(missing.tiled, "nano-banana-pro");

  const written = await writeAfcImageModelSettings({
    empty: "gpt-image-2.5-sunburst-high",
    tiled: "nano-banana-pro",
  }, memory.client);
  assert.equal(written.ok, true);
  if (!written.ok) return;
  assert.equal(written.settings.empty, "gpt-image-2.5-sunburst-high");
  assert.equal(written.settings.tiled, "nano-banana-pro");
  assert.equal(typeof written.settings.updatedAt, "string");

  const read = await readAfcImageModelSettings(memory.client);
  assert.equal(read.empty, "gpt-image-2.5-sunburst-high");
  assert.equal(read.tiled, "nano-banana-pro");

  await writeAfcImageModelSettings({
    empty: "nano-banana-pro",
    tiled: "gpt-image-2.5-sunburst-high",
  }, memory.client);
  const swapped = await readAfcImageModelSettings(memory.client);
  assert.equal(swapped.empty, "nano-banana-pro");
  assert.equal(swapped.tiled, "gpt-image-2.5-sunburst-high");
});

test("invalid stored choices fail safe to Nano Banana Pro per stage", async () => {
  const memory = memoryClient({
    id: "global",
    empty_model: "nano-banana-2",
    tiled_model: "gpt-image-2.5-sunburst-high",
    updated_at: "2026-09-30T00:00:00.000Z",
  });
  const settings = await readAfcImageModelSettings(memory.client);
  assert.equal(settings.empty, "nano-banana-pro");
  assert.equal(settings.tiled, "gpt-image-2.5-sunburst-high");
});

test("admin write rejects an unknown model and names the migration on storage failure", async () => {
  const rejected = await writeAfcImageModelSettings({
    empty: "nano-banana-2" as "nano-banana-pro",
    tiled: "nano-banana-pro",
  }, memoryClient().client);
  assert.equal(rejected.ok, false);

  const failing = {
    from() {
      return {
        upsert: async () => ({ error: { message: "relation does not exist" } }),
      };
    },
  } as unknown as SupabaseClient;
  const failed = await writeAfcImageModelSettings({
    empty: "nano-banana-pro",
    tiled: "nano-banana-pro",
  }, failing);
  assert.equal(failed.ok, false);
  if (failed.ok) return;
  assert.match(failed.error, new RegExp(AFC_IMAGE_MODEL_SETTINGS_MIGRATION));
});
