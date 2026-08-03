"use client";
import { T } from "./T";

const map: Record<string, { cls: string; label: string }> = {
  pending: { cls: "badge-pending", label: "Kutilmoqda" },
  accepted: { cls: "badge-success", label: "Qabul qilindi" },
  rejected: { cls: "badge-danger", label: "Rad etildi" },
  cancelled: { cls: "badge-danger", label: "Bekor qilindi" },
  completed: { cls: "badge-success", label: "Bajarildi" },
  draft: { cls: "badge-pending", label: "Qoralama" },
  recruiting: { cls: "badge-amber", label: "Faol" },
  filled: { cls: "badge-success", label: "Ishchi to'ldi" },
  in_progress: { cls: "badge-amber", label: "Bajarilmoqda" },
};

export function StatusBadge({ status }: { status: string }) {
  const m = map[status] || { cls: "badge", label: status };
  return <span className={m.cls}><T>{m.label}</T></span>;
}
