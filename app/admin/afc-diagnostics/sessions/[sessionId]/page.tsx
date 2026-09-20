import AfcDiagnosticSessionInspector from "./AfcDiagnosticSessionInspector";

export default async function AfcDiagnosticSessionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ generationId?: string | string[] }>;
}) {
  const { sessionId } = await params;
  const query = await searchParams;
  const generationId = Array.isArray(query.generationId)
    ? query.generationId[0]
    : query.generationId;
  return (
    <AfcDiagnosticSessionInspector
      sessionId={sessionId}
      generationId={generationId}
    />
  );
}
