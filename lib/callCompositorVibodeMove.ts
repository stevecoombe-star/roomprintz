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
  const res = await fetch(`${process.env.NEXT_PUBLIC_COMPOSITOR_URL}/vibode/move`, {
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
