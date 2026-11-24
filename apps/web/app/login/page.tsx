import { LoginForm } from "./LoginForm";

export const metadata = { title: "Entrar · Post Lead" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;

  return (
    <main className="auth">
      <div className="card auth-card">
        <h1>Post Lead</h1>
        <p className="muted">Painel da agência. Entre com o e-mail cadastrado.</p>
        {error === "config" && <p className="error">O Supabase ainda não está configurado no .env.</p>}
        {error === "link" && <p className="error">O link expirou ou já foi usado. Peça outro.</p>}
        <LoginForm next={next ?? "/panel"} />
      </div>
    </main>
  );
}
