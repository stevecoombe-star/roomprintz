import { notFound } from "next/navigation";

import {
  loadP2S2BFrozenReviewReceipt,
} from "../p2-s2b-frozen-prediction-review-server";
import FrozenPredictionReviewClient from "./FrozenPredictionReviewClient";

export const metadata = {
  title: "P2-S2B Frozen Prediction Review",
};

export default async function P2S2BFrozenPredictionReviewPage() {
  if (process.env.NODE_ENV === "production") notFound();

  const [roomB, roomD] = await Promise.all([
    loadP2S2BFrozenReviewReceipt("room-b"),
    loadP2S2BFrozenReviewReceipt("room-d"),
  ]);
  if (!roomB.ok || !roomD.ok) {
    return (
      <main className="min-h-screen bg-slate-950 p-8 text-slate-100">
        <section className="mx-auto max-w-2xl rounded border border-amber-700 bg-amber-950/20 p-5">
          <h1 className="font-semibold">Frozen review unavailable</h1>
          <p className="mt-2 font-mono text-sm text-amber-100">
            Frozen receipt verification failed closed.
          </p>
        </section>
      </main>
    );
  }

  return (
    <FrozenPredictionReviewClient
      records={{
        "room-b": {
          receipt: roomB.receipt,
          receiptSha256: roomB.receiptSha256,
        },
        "room-d": {
          receipt: roomD.receipt,
          receiptSha256: roomD.receiptSha256,
        },
      }}
    />
  );
}
