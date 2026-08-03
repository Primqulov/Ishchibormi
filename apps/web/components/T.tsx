"use client";
import { Children, isValidElement, ReactNode } from "react";
import { useScript, tr } from "@/lib/i18n";

/**
 * <T> transliterates Uzbek-Latin to the user's chosen script.
 * Accepts either a single string, multiple string children, or mixed content
 * (e.g. <T>foo {variable} bar</T> — only the string parts are transliterated).
 */
export function T({ children }: { children: ReactNode }) {
  const script = useScript((s) => s.script);
  const items: ReactNode[] = [];
  Children.forEach(children, (c, i) => {
    if (typeof c === "string") {
      items.push(tr(c, script));
    } else if (typeof c === "number" || typeof c === "boolean" || c == null) {
      items.push(c);
    } else if (isValidElement(c)) {
      items.push(c);
    } else {
      items.push(c);
    }
    void i;
  });
  return <>{items}</>;
}

/** Hook helper for plain strings inside attributes. */
export function useT() {
  const script = useScript((s) => s.script);
  return (s: string) => tr(s, script);
}
