"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type LoginState = { status: "idle" | "sent" | "error"; message?: string };

export async function sendMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = z.email().safeParse(String(formData.get("email") ?? "").trim());
  if (!email.success) return { status: "error", message: "Digite um e-mail válido." };

  const origin = (await headers()).get("origin") ?? process.env.APP_URL ?? "";
  const next = String(formData.get("next") ?? "/panel");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: email.data,
    options: {
      // Only people added in Supabase Auth can enter; nobody signs up from here.
      shouldCreateUser: false,
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next.startsWith("/") ? next : "/panel")}`,
    },
  });

  if (error) return { status: "error", message: "Não foi possível enviar o link. Confira se o e-mail tem acesso." };
  return { status: "sent" };
}
