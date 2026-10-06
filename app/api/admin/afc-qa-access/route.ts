import {
  handleAfcQaAccessAdd,
  handleAfcQaAccessGet,
  handleAfcQaAccessRemove,
  handleAfcQaAccessSetMode,
} from "@/lib/afc-v2-diagnostics/qa-access.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handleAfcQaAccessGet();
}

export async function PATCH(request: Request) {
  return handleAfcQaAccessSetMode({ request });
}

export async function POST(request: Request) {
  return handleAfcQaAccessAdd({ request });
}

export async function DELETE(request: Request) {
  return handleAfcQaAccessRemove({ request });
}
