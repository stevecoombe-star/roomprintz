import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type IngestBody = {
  imageUrl?: string;
  imageBase64?: string;
  label?: string;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as IngestBody;
    const compositorBase = (process.env.VIBODE_COMPOSITOR_URL ?? "http://localhost:8000").replace(
      /\/$/,
      ""
    );
    const upstream = `${compositorBase}/api/vibode/user-skus/ingest`;

    const upstreamRes = await fetch(upstream, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageUrl: body.imageUrl,
        imageBase64: body.imageBase64,
        label: body.label,
      }),
    });

    const raw = await upstreamRes.text();
    let parsed: any = null;

    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }

    if (!upstreamRes.ok) {
      return NextResponse.json(
        {
          error: "Failed to ingest user SKU.",
          detail: parsed ?? raw ?? "Unknown upstream error",
        },
        { status: upstreamRes.status }
      );
    }

    return NextResponse.json(parsed ?? {});
  } catch (err: any) {
    return NextResponse.json(
      {
        error: "Failed to ingest user SKU.",
        detail: err?.message ?? "Unknown error",
      },
      { status: 500 }
    );
  }
}
