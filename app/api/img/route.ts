import { NextRequest } from "next/server";

const ALLOWED_HOSTS = new Set(["www.ikea.com", "ikea.com"]);

function badRequest(message: string) {
  return new Response(message, { status: 400 });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const rawUrl = searchParams.get("url");

  if (!rawUrl) {
    return badRequest("Missing url");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return badRequest("Invalid url");
  }

  if (parsedUrl.protocol !== "https:") {
    return badRequest("Invalid url");
  }

  if (!ALLOWED_HOSTS.has(parsedUrl.hostname)) {
    return badRequest("Invalid url");
  }

  let upstream: Response;
  try {
    upstream = await fetch(parsedUrl.toString());
  } catch {
    return new Response("Bad gateway", { status: 502 });
  }

  if (!upstream.ok) {
    return new Response("Bad gateway", { status: 502 });
  }

  const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
  const body = await upstream.arrayBuffer();
  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set(
    "Cache-Control",
    "public, max-age=86400, stale-while-revalidate=604800"
  );

  return new Response(body, { status: 200, headers });
}
