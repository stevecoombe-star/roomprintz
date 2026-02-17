export async function callCompositorVibodeMove(args: {
  imageUrl?: string;
  imageBase64?: string;
  marks: {
    id: string;
    xNorm: number;
    yNorm: number;
    dxNorm: number;
    dyNorm: number;
  }[];
  modelVersion?: string | null;
  aspectRatio?: string | null;
}) {
  const compositorBaseUrl =
    process.env.COMPOSITOR_URL ||
    process.env.NEXT_PUBLIC_COMPOSITOR_URL ||
    (process.env.NODE_ENV !== "production" ? "http://localhost:8000" : "");

  if (!compositorBaseUrl) {
    throw new Error("Missing COMPOSITOR_URL (or NEXT_PUBLIC_COMPOSITOR_URL) for Vibode compositor.");
  }

  const res = await fetch(`${compositorBaseUrl}/vibode/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      imageUrl: args.imageUrl,
      imageBase64: args.imageBase64,
      marks: args.marks,
      modelVersion: args.modelVersion ?? undefined,
      aspectRatio: args.aspectRatio ?? "auto",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vibode move failed: ${res.status} ${text}`);
  }

  return res.json();
}
