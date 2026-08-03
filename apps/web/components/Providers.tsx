"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useEffect, useState } from "react";
import { useScript } from "@/lib/i18n";

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } } }));
  // Skript store'i skipHydration bilan yaratilgan — mount bo'lgach localStorage'dan
  // saqlangan qiymatni (Lotin/Kirill) qo'lda yuklaymiz. Bu SSR hydration
  // mismatch'ining oldini oladi.
  useEffect(() => { void useScript.persist.rehydrate(); }, []);
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}
