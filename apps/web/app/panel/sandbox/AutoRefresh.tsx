"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Reloads the server data every few seconds, so the worker's replies show up. */
export function AutoRefresh({ everyMs = 3000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs]);
  return null;
}
