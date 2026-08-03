"use client";
import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";
import { useEffect, useState } from "react";

/** Til menyusi bilan bir xil uslubdagi yumaloq tugma (Figma: nav'dagi kichik boshqaruvlar). */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <span className="h-[34px] w-[34px] shrink-0" />;
  const dark = theme === "dark";
  return (
    <button
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full transition hover:opacity-80"
      style={{ background: "var(--bg-subtle)", color: "var(--text-muted)" }}
      aria-label="Theme"
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
