import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import AfcQaAccessSettings from "./AfcQaAccessSettings";

test("AFC diagnostics QA access section renders the mode and allowlist controls", () => {
  const html = renderToStaticMarkup(createElement(AfcQaAccessSettings));
  assert.match(html, /AFC QA Access/);
  assert.match(html, /QA Mode/);
  assert.match(html, /Authorized QA Users/);
  assert.match(html, /aria-label="AFC QA Mode"/);
  assert.match(html, /aria-label="QA user email"/);
  assert.match(html, /Add QA User/);
  assert.doesNotMatch(html, /VIBODE_AFC_QA_|SUPABASE_SERVICE_ROLE_KEY|service_role/);
});
