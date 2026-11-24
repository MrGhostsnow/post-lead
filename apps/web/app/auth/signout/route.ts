import { NextResponse } from "next/server";
import { createSupabaseServerClient, supabaseConfig } from "@/lib/supabase/server";

export async function POST(request: Request) {
  if (supabaseConfig()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
