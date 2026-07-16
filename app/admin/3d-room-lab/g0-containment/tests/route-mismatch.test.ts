import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import { G0_SYNTHETIC_ASSETS } from "../assets-and-lineage";
import { buildLabRequestBody, startG0LoopbackAssetServer, withG0RouteEnv } from "../harness";

type ModuleLoad = (request: string, parent: unknown, isMain: boolean) => unknown;

async function withModuleMocks<T>(
  mocks: Record<string, unknown>,
  run: () => Promise<T>
): Promise<T> {
  const originalLoad = (Module as unknown as { _load: ModuleLoad })._load;
  (Module as unknown as { _load: ModuleLoad })._load = function patched(
    request: string,
    parent: unknown,
    isMain: boolean
  ) {
    if (request in mocks) {
      return mocks[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return await run();
  } finally {
    (Module as unknown as { _load: ModuleLoad })._load = originalLoad;
  }
}

test("9) detect-vision mismatch returns reason and attested fingerprint before Gemini", async () => {
  const server = await startG0LoopbackAssetServer();
  let geminiReached = false;
  try {
    await withG0RouteEnv(
      {
        AUTO_FLOOR_VISION_ENABLED: "true",
        GEMINI_API_KEY: "test-key",
        AUTO_FLOOR_VISION_ALLOW_LOCALHOST_HTTP: "true",
      },
      () =>
        withModuleMocks(
          {
            "@/lib/adminServer": {
              getAuthenticatedAdminUser: async () => ({ id: "admin-1" }),
            },
            "@/lib/vibodeGeminiUsageAccounting": {
              getRequestIdFromHeaders: () => "g0-test-request",
            },
            "@/lib/vibodeAutoFloorVisionDetect": {
              detectFloorFromVerifiedBytes: async () => {
                geminiReached = true;
                throw new Error("gemini_should_not_run");
              },
            },
          },
          async () => {
            const route = await import("@/app/api/admin/3d-room-lab/auto-floor/detect-vision/route");

            const request = new Request(
              "http://localhost/api/admin/3d-room-lab/auto-floor/detect-vision",
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(
                  buildLabRequestBody({
                    imageUrl: `${server.origin}/A-parent.jpg`,
                    expectedBasisFingerprint: "f".repeat(64),
                  })
                ),
              }
            );
            const response = await route.POST(request);
            const json = (await response.json()) as {
              failureReasons: string[];
              attestedBasisFingerprint?: string;
            };
            assert.equal(json.failureReasons[0], "basis_fingerprint_mismatch");
            assert.equal(json.attestedBasisFingerprint, G0_SYNTHETIC_ASSETS["A-parent"].sha256);
            assert.equal(geminiReached, false);
          }
        )
    );
  } finally {
    await server.close();
  }
});

test("10) empty-room mismatch blocks before compositor and Gemini", async () => {
  const server = await startG0LoopbackAssetServer();
  let geminiReached = false;
  let compositorReached = false;
  try {
    await withG0RouteEnv(
      {
        EMPTY_ROOM_ASSIST_ENABLED: "true",
        AUTO_FLOOR_VISION_ENABLED: "true",
        GEMINI_API_KEY: "test-key",
        AUTO_FLOOR_VISION_ALLOW_LOCALHOST_HTTP: "true",
      },
      () =>
        withModuleMocks(
          {
            "@/lib/adminServer": {
              getAuthenticatedAdminUser: async () => ({ id: "admin-1" }),
            },
            "@/lib/vibodeGeminiUsageAccounting": {
              getRequestIdFromHeaders: () => "g0-test-request",
            },
            "@/lib/vibodeAutoFloorVisionDetect": {
              detectFloorFromVerifiedBytes: async () => {
                geminiReached = true;
                throw new Error("gemini_should_not_run");
              },
            },
            "@/lib/vibodeEmptyRoomAssist": {
              getOrGenerateEmptyRoomImage: async () => {
                compositorReached = true;
                throw new Error("compositor_should_not_run");
              },
            },
          },
          async () => {
            const route = await import("@/app/api/admin/3d-room-lab/empty-room-assist/run/route");

            const request = new Request("http://localhost/api/admin/3d-room-lab/empty-room-assist/run", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(
                buildLabRequestBody({
                  imageUrl: `${server.origin}/A-parent.jpg`,
                  expectedBasisFingerprint: "e".repeat(64),
                })
              ),
            });
            const response = await route.POST(request);
            const json = (await response.json()) as {
              assist: {
                failureReason: string | null;
                attestedOriginalBasisFingerprint: string | null;
                calibratedCameraEligible: boolean;
              };
            };
            assert.equal(json.assist.failureReason, "basis_fingerprint_mismatch");
            assert.equal(
              json.assist.attestedOriginalBasisFingerprint,
              G0_SYNTHETIC_ASSETS["A-parent"].sha256
            );
            assert.equal(json.assist.calibratedCameraEligible, false);
            assert.equal(geminiReached, false);
            assert.equal(compositorReached, false);
          }
        )
    );
  } finally {
    await server.close();
  }
});
