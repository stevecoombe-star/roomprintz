import assert from "node:assert/strict";
import test from "node:test";

import { POST as claim } from "@/app/api/internal/vibode-thumbnail-jobs/claim/route";
import { POST as mint } from "@/app/api/internal/vibode-thumbnail-render/access/route";
import { GET } from "@/app/api/internal/vibode-thumbnail-render/route";
import {
  thumbnailRenderContractRouteEnabled,
  thumbnailRenderRouteEnabled,
} from "@/lib/vibode-thumbnail-render/access.server";

import { thumbnailJobFailureIsRetryable } from "./policy";
import { thumbnailWorkerAuthorization } from "./worker-auth.server";

test("worker secret comparison fails closed", () => {
  const previous = process.env.VIBODE_THUMBNAIL_WORKER_SECRET;
  delete process.env.VIBODE_THUMBNAIL_WORKER_SECRET;
  try {
    assert.equal(
      thumbnailWorkerAuthorization(new Request("https://app.example/claim")),
      "unconfigured",
    );
    process.env.VIBODE_THUMBNAIL_WORKER_SECRET = "correct-secret";
    assert.equal(
      thumbnailWorkerAuthorization(new Request("https://app.example/claim", {
        headers: { "x-vibode-thumbnail-worker": "wrong" },
      })),
      "rejected",
    );
    assert.equal(
      thumbnailWorkerAuthorization(new Request("https://app.example/claim", {
        headers: { "x-vibode-thumbnail-worker": "correct-secret" },
      })),
      "ok",
    );
  } finally {
    restore("VIBODE_THUMBNAIL_WORKER_SECRET", previous);
  }
});

test("an invalid worker secret cannot claim a job", async () => {
  const previous = process.env.VIBODE_THUMBNAIL_WORKER_SECRET;
  process.env.VIBODE_THUMBNAIL_WORKER_SECRET = "correct-secret";
  try {
    const response = await claim(new Request("https://app.example/api/internal/vibode-thumbnail-jobs/claim", {
      method: "POST",
      headers: { "x-vibode-thumbnail-worker": "wrong" },
    }));
    assert.equal(response.status, 401);
    const body = await response.text();
    assert.equal(body.includes("service_role"), false);
    assert.equal(body.includes("accessToken"), false);
  } finally {
    restore("VIBODE_THUMBNAIL_WORKER_SECRET", previous);
  }
});

test("production contract route requires the HMAC secret and ignores roomId", async () => {
  const previousNode = process.env.NODE_ENV;
  const previousSecret = process.env.VIBODE_THUMBNAIL_RENDER_TOKEN_SECRET;
  setEnv("NODE_ENV", "production");
  delete process.env.VIBODE_THUMBNAIL_RENDER_TOKEN_SECRET;
  try {
    const closed = await GET(new Request("https://app.example/api/internal/vibode-thumbnail-render?roomId=11111111-1111-4111-8111-111111111111"));
    assert.equal(closed.status, 404);
    assert.equal(thumbnailRenderContractRouteEnabled(
      new Request("https://app.example/api/internal/vibode-thumbnail-render"),
    ), false);
    process.env.VIBODE_THUMBNAIL_RENDER_TOKEN_SECRET = "production-render-secret";
    assert.equal(thumbnailRenderContractRouteEnabled(
      new Request("https://app.example/api/internal/vibode-thumbnail-render"),
    ), true);
    assert.equal(thumbnailRenderRouteEnabled(
      new Request("https://app.example/api/internal/vibode-thumbnail-render/access"),
    ), false);
    const missing = await GET(new Request("https://app.example/api/internal/vibode-thumbnail-render?roomId=11111111-1111-4111-8111-111111111111"));
    assert.equal(missing.status, 401);
    const invalid = await GET(new Request("https://app.example/api/internal/vibode-thumbnail-render", {
      headers: { "x-vibode-thumbnail-access": "not-a-token" },
    }));
    assert.equal(invalid.status, 401);
    const minted = await mint(new Request("https://app.example/api/internal/vibode-thumbnail-render/access", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        roomId: "11111111-1111-4111-8111-111111111111",
        versionId: "22222222-2222-4222-8222-222222222222",
      }),
    }));
    assert.equal(minted.status, 404);
    assert.equal(thumbnailJobFailureIsRetryable("render_timeout"), true);
    assert.equal(thumbnailJobFailureIsRetryable("render_access_denied"), false);
  } finally {
    restore("NODE_ENV", previousNode);
    restore("VIBODE_THUMBNAIL_RENDER_TOKEN_SECRET", previousSecret);
  }
});

function restore(name: string, value: string | undefined) {
  setEnv(name, value);
}

function setEnv(name: string, value: string | undefined) {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env[name];
  else env[name] = value;
}
