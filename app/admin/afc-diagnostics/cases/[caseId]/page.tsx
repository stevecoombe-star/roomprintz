import AfcDiagnosticCaseInspector from "./AfcDiagnosticCaseInspector";

export default async function AfcDiagnosticCaseDetailPage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  return <AfcDiagnosticCaseInspector caseId={caseId} />;
}
