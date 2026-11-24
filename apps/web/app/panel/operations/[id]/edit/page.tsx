import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOperation, requireUser } from "@/lib/auth";
import { operationFormValues } from "@/lib/operationForm";
import { operationPeople } from "@/lib/panelData";
import { EditOperationForm } from "./EditOperationForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Editar cliente · Post Lead" };

export default async function EditOperationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const operation = await requireOperation(user.id, id);
  if (!operation) notFound();

  const team = await operationPeople(operation.id);

  return (
    <main className="page" style={{ maxWidth: 820 }}>
      <Link href={`/panel/operations/${operation.id}`} className="crumb">← {operation.name}</Link>
      <div className="page-head"><h1>Editar cliente</h1></div>
      <EditOperationForm operationId={operation.id} initial={operationFormValues(operation, team)} />
    </main>
  );
}
