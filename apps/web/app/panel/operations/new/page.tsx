import Link from "next/link";
import { agencies, inArray } from "@post-lead/db";
import { agencyIdsFor, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/server";
import { DEFAULT_VALUES } from "@/lib/operationForm";
import { NewOperationForm } from "./NewOperationForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Novo cliente · Post Lead" };

export default async function NewOperationPage() {
  const user = await requireUser();
  const ids = await agencyIdsFor(user.id);
  const list = ids.length
    ? await getDb().select({ id: agencies.id, name: agencies.name }).from(agencies).where(inArray(agencies.id, ids))
    : [];

  return (
    <main className="page" style={{ maxWidth: 820 }}>
      <Link href="/panel" className="crumb">← Clientes</Link>
      <div className="page-head"><h1>Novo cliente</h1></div>
      {list.length === 0 ? <p className="error">Você não faz parte de nenhuma agência.</p> : <NewOperationForm agencies={list} defaults={DEFAULT_VALUES} />}
    </main>
  );
}
