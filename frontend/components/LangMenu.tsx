"use client";
import { useEffect, useRef, useState } from "react";
import { Globe, ChevronDown, Check } from "lucide-react";
import { useScript, type Script } from "@/lib/i18n";

type Option = {
  value: Script | "ru";
  code: string;      // pill ichidagi qisqa kod — Figma: "UZ"
  label: string;     // menyudagi nom
  native: string;    // ostidagi izoh
  soon?: boolean;    // hali tayyor emas
};

const OPTIONS: Option[] = [
  { value: "latin",    code: "UZ", label: "O'zbekcha", native: "Lotin" },
  { value: "cyrillic", code: "ЎЗ", label: "Ўзбекча",   native: "Kirill" },
  { value: "ru",       code: "RU", label: "Русский",   native: "Rus tili", soon: true },
];

/**
 * Figma "Landing Nav → IconText (ic/globe + UZ)": kichik yumaloq pill.
 * Bosilganda tepadan pastga ochiladigan menyu chiqadi — lotin, kirill, rus.
 */
export function LangMenu({ compact }: { compact?: boolean }) {
  const script = useScript((s) => s.script);
  const setScript = useScript((s) => s.setScript);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = OPTIONS.find((o) => o.value === script) || OPTIONS[0];

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Til"
        className="inline-flex items-center gap-2 rounded-full h-[34px] pl-3 pr-2.5 text-[14px] font-semibold transition"
        style={{
          background: open ? "var(--brand-soft)" : "var(--bg-subtle)",
          color: open ? "var(--brand)" : "var(--text-muted)",
        }}
      >
        <Globe size={14} className="shrink-0" />
        {!compact && <span>{current.code}</span>}
        <ChevronDown size={13} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="listbox"
          className="card-elevated absolute right-0 top-[calc(100%+8px)] w-[190px] p-1.5 z-50 animate-scale-in origin-top"
        >
          {OPTIONS.map((o) => {
            const active = o.value === script;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={active}
                disabled={o.soon}
                onClick={() => {
                  if (o.soon) return;
                  setScript(o.value as Script);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition ${
                  o.soon ? "opacity-55 cursor-not-allowed" : "hover:bg-[color:var(--bg-subtle)]"
                }`}
                style={active ? { background: "var(--brand-soft)" } : undefined}
              >
                <span
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[11px] font-bold"
                  style={
                    active
                      ? { background: "var(--brand)", color: "#fff" }
                      : { background: "var(--bg-subtle)", color: "var(--text-muted)" }
                  }
                >
                  {o.code}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-bold leading-tight"
                        style={{ color: active ? "var(--brand)" : "var(--text)" }}>
                    {o.label}
                  </span>
                  <span className="block text-[11px] subtle leading-tight mt-0.5">
                    {o.soon ? "tez orada" : o.native}
                  </span>
                </span>
                {active && <Check size={15} style={{ color: "var(--brand)" }} className="shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
