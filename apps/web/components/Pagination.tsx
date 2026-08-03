"use client";

// Shared admin list pager. Renders nothing for a single page.
export function Pagination({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-3 text-sm">
      <button className="btn-secondary btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>← Oldingi</button>
      <span className="tabular-nums">{page} / {pages}</span>
      <button className="btn-secondary btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Keyingi →</button>
    </div>
  );
}
