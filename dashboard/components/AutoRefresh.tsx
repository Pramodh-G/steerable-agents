"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders the server components every few seconds so a live session grows on screen. */
export default function AutoRefresh({ ms = 3000 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, ms);
    return () => clearInterval(t);
  }, [router, ms]);
  return null;
}
