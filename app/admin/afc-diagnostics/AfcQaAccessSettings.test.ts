import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import AfcQaAccessSettings, { AfcQaAuthorizedUsersList } from "./AfcQaAccessSettings";

const USERS = [
  { userId: "11111111-1111-4111-8111-111111111111", email: "one@example.com", addedAt: null },
  { userId: "22222222-2222-4222-8222-222222222222", email: "two@example.com", addedAt: null },
] as const;

function list(open: boolean, users: readonly { userId: string; email: string | null; addedAt: string | null }[]) {
  return renderToStaticMarkup(createElement(AfcQaAuthorizedUsersList, {
    open,
    users,
    busy: false,
    showLoading: false,
    loadFailed: false,
    onToggle: () => undefined,
    onRemove: () => undefined,
  }));
}

test("AFC QA Access starts collapsed and keeps QA Mode and Add QA User available", () => {
  const html = renderToStaticMarkup(createElement(AfcQaAccessSettings));
  assert.match(html, /AFC QA Access/);
  assert.match(html, /QA Mode/);
  assert.match(html, /aria-label="AFC QA Mode"/);
  assert.match(html, /Authorized QA Users \(0\)/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /▸/);
  assert.doesNotMatch(html, /<table/);
  assert.doesNotMatch(html, />Remove</);
  assert.match(html, /aria-label="QA user email"/);
  assert.match(html, />Add QA User</);
  assert.doesNotMatch(html, /VIBODE_AFC_QA_|SUPABASE_SERVICE_ROLE_KEY|service_role/);
});

test("Authorized QA Users collapses and expands without changing the user count", () => {
  const collapsed = list(false, USERS);
  assert.match(collapsed, /aria-expanded="false"/);
  assert.match(collapsed, /▸/);
  assert.match(collapsed, /Authorized QA Users \(2\)/);
  assert.doesNotMatch(collapsed, /<table/);
  assert.doesNotMatch(collapsed, /one@example.com/);

  const expanded = list(true, USERS);
  assert.match(expanded, /aria-expanded="true"/);
  assert.match(expanded, /▾/);
  assert.match(expanded, /Authorized QA Users \(2\)/);
  assert.match(expanded, /<table/);
  assert.match(expanded, /one@example.com/);
  assert.match(expanded, /two@example.com/);
  assert.match(expanded, />Remove</);
});

test("Authorized QA Users count follows the current allowlist", () => {
  assert.match(list(false, []), /Authorized QA Users \(0\)/);
  assert.match(list(false, USERS.slice(0, 1)), /Authorized QA Users \(1\)/);
  assert.match(list(true, USERS), /Authorized QA Users \(2\)/);
});
