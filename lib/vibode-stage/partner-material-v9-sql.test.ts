import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20261010180000_vibode_stage_partner_material_metadata.sql",
);
const sql = readFileSync(migrationPath, "utf8");

type InsertStatement = {
  table: string;
  columns: string[];
  values: string[];
};

function matchParen(source: string, openIndex: number) {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error(`Unbalanced parenthesis at ${openIndex}`);
}

function splitTopLevel(source: string) {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of source) {
    if (char === "(") depth += 1;
    if (char === ")" && depth > 0) depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function insertStatements(source: string): InsertStatement[] {
  const statements: InsertStatement[] = [];
  const pattern = /insert into (public\.\w+)\s*\(/gi;
  for (const match of source.matchAll(pattern)) {
    const table = match[1];
    const columnOpen = match.index + match[0].length - 1;
    const columnClose = matchParen(source, columnOpen);
    const valuesKeyword = source.toLowerCase().indexOf("values", columnClose);
    const valueOpen = source.indexOf("(", valuesKeyword);
    const valueClose = matchParen(source, valueOpen);
    statements.push({
      table,
      columns: splitTopLevel(source.slice(columnOpen + 1, columnClose)),
      values: splitTopLevel(source.slice(valueOpen + 1, valueClose)),
    });
  }
  return statements;
}

const inserts = insertStatements(sql);

function insertFor(table: string) {
  const matches = inserts.filter((statement) => statement.table === table);
  assert.equal(matches.length, 1, table);
  return matches[0];
}

test("v9 source audit pairs every insert column with a value", () => {
  assert.deepEqual(
    inserts.map((statement) => statement.table),
    [
      "public.vibode_stage_partner_publishes",
      "public.vibode_stage_collections",
      "public.vibode_stage_products",
      "public.vibode_stage_variants",
      "public.vibode_stage_product_collections",
      "public.vibode_stage_partner_publishes",
    ],
  );
  for (const statement of inserts) {
    assert.equal(
      statement.columns.length,
      statement.values.length,
      `${statement.table} columns ${statement.columns.length} values ${statement.values.length}`,
    );
  }
});

test("v9 collection create does not write product material columns", () => {
  const collectionStart = sql.indexOf("jsonb_array_elements(p_apply->'collectionCreates')");
  const collectionLoop = sql.slice(collectionStart, sql.indexOf("end loop;", collectionStart));
  assert.doesNotMatch(collectionLoop, /primary_material|secondary_material|primaryMaterial|secondaryMaterial/);
  const collection = insertFor("public.vibode_stage_collections");
  assert.deepEqual(collection.columns, [
    "collection_id",
    "name",
    "owner",
    "partner_name",
    "partner_id",
    "status",
    "sort_order",
  ]);
  assert.deepEqual(collection.values, [
    "v_collection_id",
    "v_next_name",
    "'partner'",
    "v_partner_name",
    "v_partner_id",
    "'active'",
    "v_sort_order",
  ]);
});

test("v9 product create persists both materials from the product record", () => {
  const product = insertFor("public.vibode_stage_products");
  assert.deepEqual(product.columns.slice(-2), ["primary_material", "secondary_material"]);
  assert.deepEqual(product.values.slice(-2), ["v_create_primary", "v_create_secondary"]);
  const productInsertLoop = sql.slice(
    sql.lastIndexOf("jsonb_array_elements(p_apply->'productCreates')"),
    sql.indexOf("insert into public.vibode_stage_variants"),
  );
  assert.match(productInsertLoop, /v_create_primary := nullif\(btrim\(v_item->>'primaryMaterial'\), ''\)/);
  assert.match(productInsertLoop, /v_create_secondary := nullif\(btrim\(v_item->>'secondaryMaterial'\), ''\)/);
  assert.match(productInsertLoop, /char_length\(v_create_primary\) > 400/);
  assert.match(productInsertLoop, /char_length\(v_create_secondary\) > 400/);
});

test("v9 variant create preserves null inheritance and empty-string clears", () => {
  const variant = insertFor("public.vibode_stage_variants");
  assert.deepEqual(variant.columns.slice(-2), ["primary_material", "secondary_material"]);
  assert.deepEqual(variant.values.slice(-2), ["v_create_primary", "v_create_secondary"]);
  const variantInsertStart = sql.lastIndexOf("jsonb_array_elements(p_apply->'variantCreates')");
  const variantInsertLoop = sql.slice(
    variantInsertStart,
    sql.indexOf("p_apply->'productUpdates'", variantInsertStart),
  );
  assert.match(variantInsertLoop, /v_create_primary := btrim\(v_item->>'primaryMaterial'\)/);
  assert.match(variantInsertLoop, /v_create_secondary := btrim\(v_item->>'secondaryMaterial'\)/);
  assert.doesNotMatch(
    variantInsertLoop,
    /nullif\(btrim\(v_item->>'primaryMaterial'\)|nullif\(btrim\(v_item->>'secondaryMaterial'\)/,
  );
});

test("v9 generic updates cannot write material columns", () => {
  const productUpdateStart = sql.indexOf("jsonb_array_elements(p_apply->'productUpdates')");
  const productUpdates = sql.slice(
    productUpdateStart,
    sql.indexOf("p_apply->'productStatusTransitions'", productUpdateStart),
  );
  const variantUpdateStart = sql.lastIndexOf("jsonb_array_elements(p_apply->'variantUpdates')");
  const variantUpdates = sql.slice(
    variantUpdateStart,
    sql.indexOf("p_apply->'collectionUpdates'", variantUpdateStart),
  );
  assert.match(productUpdates, /VIBODE_STAGE_PUBLISH:UNSUPPORTED_COLUMN/);
  assert.match(variantUpdates, /VIBODE_STAGE_PUBLISH:UNSUPPORTED_COLUMN/);
  assert.doesNotMatch(productUpdates, /primary_material|secondary_material/);
  assert.doesNotMatch(variantUpdates, /primary_material|secondary_material/);
  assert.match(sql, /v_material_column not in \('primary_material', 'secondary_material'\)/);
  assert.match(sql, /set primary_material = v_material_next/);
  assert.match(sql, /set secondary_material = v_material_next/);
});

test("v9 migration does not replace v1-v8 functions", () => {
  assert.doesNotMatch(sql, /vibode_stage_apply_partner_patch_v[1-8]\b/);
  assert.doesNotMatch(sql, /create or replace function public\.vibode_stage_apply_partner_patch\s*\(/);
  assert.match(sql, /create or replace function public\.vibode_stage_apply_partner_patch_v9\(p_apply jsonb\)/);
  assert.match(sql, /grant execute on function public\.vibode_stage_apply_partner_patch_v9\(jsonb\)\s+to service_role;/);
});
