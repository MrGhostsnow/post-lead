import Link from "next/link";
import { agencyIdsFor, requireUser } from "@/lib/auth";
import { operationsOverview } from "@/lib/panelData";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clientes · Post Lead" };

export default async function PanelHome() {
  const user = await requireUser();
  const agencies = await agencyIdsFor(user.id);

  if (agencies.length === 0) {
    return (
      <main className="page">
        <div className="card stack">
          <h1>Sem acesso ainda</h1>
          <p className="muted">Seu login funciona, mas você ainda não faz parte de nenhuma agência.</p>
          <p className="small">
            Peça a um administrador para rodar <span className="code">npm run add-member -w @post-lead/worker -- --user-id {user.id}</span>
          </p>
        </div>
      </main>
    );
  }

  const rows = await operationsOverview(agencies);
  const lateTotal = rows.reduce((sum, r) => sum + r.late, 0);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Clientes</h1>
          <p className="muted">
            {lateTotal > 0 ? `${lateTotal} lead(s) esperando resposta além do prazo.` : "Nenhum lead atrasado agora."}
          </p>
        </div>
        <Link href="/panel/operations/new" className="button">Novo cliente</Link>
      </div>

      <div className="card table-wrap">
        {rows.length === 0 ? (
          <p className="empty">Nenhum cliente ainda. Cadastre o primeiro.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Modo</th>
                <th>WhatsApp</th>
                <th>Leads em 7 dias</th>
                <th>Abertos</th>
                <th>Atrasados</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ operation, leadsLast7Days, open, late, waiting }) => (
                <tr key={operation.id}>
                  <td><Link href={`/panel/operations/${operation.id}`}><b>{operation.name}</b></Link></td>
                  <td>{operation.mode === "team" ? "Equipe" : "Individual"}</td>
                  <td>{operation.phoneNumberId ? "Conectado" : <span className="small">Não conectado</span>}</td>
                  <td>{leadsLast7Days}</td>
                  <td>{open}{waiting > 0 && <span className="small"> · {waiting} aguardando</span>}</td>
                  <td>{late > 0 ? <span className="badge t-late">{late}</span> : <span className="small">0</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
