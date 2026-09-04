"use client";
import { IK, tugma } from "@/components/admin/ui";

// Shared admin list pager. Renders nothing for a single page.
// Ko'rinishi: Figma "3.3 · Foydalanuvchilar — ro'yxat", jadval oyoqchasi.
export function Pagination({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  const oldingiOchiq = page <= 1;
  const keyingiOchiq = page >= pages;
  return (
    <div className="flex items-center justify-center gap-[14px]">
      <button
        disabled={oldingiOchiq}
        onClick={() => onPage(page - 1)}
        {...tugma("ikkilamchi", { kichik: true, ochiq: oldingiOchiq })}
      >
        ← Oldingi
      </button>
      {/* Figma 3.5 (61:194): Medium 13/18 — tugma matni bilan bir og'irlikda.
          Ilgari 14/semibold edi va sanoq tugmalardan kattaroq turardi. */}
      <span className="text-[13px] font-medium leading-[18px] tabular-nums" style={{ color: IK }}>
        {page} / {pages}
      </span>
      <button
        disabled={keyingiOchiq}
        onClick={() => onPage(page + 1)}
        {...tugma("ikkilamchi", { kichik: true, ochiq: keyingiOchiq })}
      >
        Keyingi →
      </button>
    </div>
  );
}
