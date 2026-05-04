import { normalizeDetectedRoomObjectLabels } from "@/lib/vibodeRoomObjectLabels";

const ROOM_READ_PROMPT = `Analyze this room photo for visible furniture and decor items.

Return only furniture, decor, and removable room objects that a user may reasonably want to remove or replace.

Do not include architectural features such as walls, floors, ceilings, windows, doors, trim, baseboards, outlets, or lighting reflections.

Use simple consumer-friendly labels.

Return JSON only in this shape:
{
  "objects": [
    { "label": "sofa", "confidence": 0.93 }
  ]
}`;

function safeStr(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractResponseText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;

  const directText = safeStr(record.text) ?? safeStr(record.outputText);
  if (directText) return directText;

  const candidates = Array.isArray(record.candidates) ? record.candidates : [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const content = (candidate as Record<string, unknown>).content;
    if (!content || typeof content !== "object") continue;
    const parts = Array.isArray((content as Record<string, unknown>).parts)
      ? ((content as Record<string, unknown>).parts as unknown[])
      : [];
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const text = safeStr((part as Record<string, unknown>).text);
      if (text) return text;
    }
  }

  return null;
}

function parseJsonFromText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch?.[1]) {
      return JSON.parse(fencedMatch[1].trim());
    }
    throw new Error("Failed to parse room-read JSON response.");
  }
}

function parseDataUrlImage(dataUrl: string): { mime: string; base64: string } {
  const match = dataUrl.trim().match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Invalid data URL image.");
  return { mime: match[1], base64: match[2] };
}

async function fetchImageAsBase64(imageUrl: string): Promise<{ mime: string; base64: string }> {
  if (imageUrl.startsWith("data:")) {
    return parseDataUrlImage(imageUrl);
  }
  if (!/^https?:\/\//i.test(imageUrl)) {
    throw new Error("imageUrl must be an http(s) URL or data URL.");
  }
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Failed to fetch room image (${res.status}).`);
  const mime = res.headers.get("content-type") || "image/jpeg";
  const base64 = Buffer.from(await res.arrayBuffer()).toString("base64");
  return { mime, base64 };
}

async function callGeminiRoomRead(args: {
  mime: string;
  imageBase64: string;
  prompt: string;
  modelVersion: string;
}): Promise<unknown> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY/GOOGLE_API_KEY for room-read fallback.");
  }
  const model = args.modelVersion || "gemini-3-flash-preview";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: args.prompt },
            {
              inlineData: {
                mimeType: args.mime,
                data: args.imageBase64,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gemini room-read failed (${res.status}): ${text}`);
  }
  return await res.json().catch(() => ({}));
}

export async function runGeminiRoomReadFromImageUrl(args: {
  imageUrl: string;
  modelVersion?: string;
}) {
  const modelVersion = safeStr(args.modelVersion) ?? "gemini-3-flash-preview";
  const { mime, base64 } = await fetchImageAsBase64(args.imageUrl);
  const rawPayload = await callGeminiRoomRead({
    mime,
    imageBase64: base64,
    prompt: ROOM_READ_PROMPT,
    modelVersion,
  });
  const text = extractResponseText(rawPayload);
  const parsed = text ? parseJsonFromText(text) : rawPayload;
  return normalizeDetectedRoomObjectLabels(parsed);
}
