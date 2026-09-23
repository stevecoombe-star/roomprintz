import { notFound } from "next/navigation";

import {
  loadP2S2CCollisionOverlayReviewRecord,
} from "../p2-s2c-collision-overlay-review-server";
import {
  P2_S2C_COLLISION_OVERLAY_REVIEW_ROOMS,
  type P2S2CCollisionOverlayReviewRoomId,
} from "../p2-s2c-collision-overlay-review";
import CollisionOverlayReviewClient from "./CollisionOverlayReviewClient";

export const metadata = {
  title: "P2-S2C Collision Overlay Review",
};

export default async function P2S2CCollisionOverlayReviewPage() {
  if (process.env.NODE_ENV === "production") notFound();

  const loaded = await Promise.all(
    P2_S2C_COLLISION_OVERLAY_REVIEW_ROOMS.map(async roomId => ({
      roomId,
      result: await loadP2S2CCollisionOverlayReviewRecord(roomId),
    }))
  );
  const failed = loaded.find(item => !item.result.ok);
  if (failed) {
    return (
      <main className="min-h-screen bg-slate-950 p-8 text-slate-100">
        <section className="mx-auto max-w-2xl rounded border border-amber-700 bg-amber-950/20 p-5">
          <h1 className="font-semibold">P2-S2C review unavailable</h1>
          <p className="mt-2 font-mono text-sm text-amber-100">
            Certified source verification failed closed for {failed.roomId}.
          </p>
        </section>
      </main>
    );
  }

  const records = Object.fromEntries(loaded.map(item => {
    if (!item.result.ok) throw new Error(item.result.code);
    return [item.roomId, item.result.record];
  })) as Record<
    P2S2CCollisionOverlayReviewRoomId,
    Extract<typeof loaded[number]["result"], { ok: true }>["record"]
  >;

  return <CollisionOverlayReviewClient records={records} />;
}
