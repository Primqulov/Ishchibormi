/**
 * Ish tarixi.
 *
 * Backend `/api/me/history` da ishchi va ish beruvchi yozuvlarini BIRGA
 * qaytaradi (yakunlangan, bekor qilingan, rad etilgan). Ularni ajratmasdan
 * ko'rsatish chalkash bo'lardi — "men ishlaganman"mi yoki "men ish
 * berganman"mi bir qarashda ko'rinishi kerak. Shuning uchun har yozuvda rol
 * belgisi bor va tepada filtr turadi.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { HistoryIcon, CheckIcon, XIcon } from "@/components/icons";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/ui";
import { fmtSum, fmtDate } from "@/lib/format";
import { haptic } from "@/lib/telegram";
import {
  fetchHistory,
  type APIError,
  type Application,
  type ApplicationStatus,
} from "@/lib/api";

const STATUS: Record<ApplicationStatus, { label: string; cls: string }> = {
  pending: { label: "Kutilmoqda", cls: "badge-pending" },
  accepted: { label: "Qabul qilingan", cls: "badge-success" },
  rejected: { label: "Rad etilgan", cls: "badge-danger" },
  cancelled: { label: "Bekor qilingan", cls: "badge-neutral" },
  completed: { label: "Yakunlangan", cls: "badge-success" },
};

type Filter = "all" | "worker" | "employer";

const FILTER_LABEL: Record<Filter, string> = {
  all: "Hammasi",
  worker: "Ishchi sifatida",
  employer: "Ish beruvchi sifatida",
};

export function History({
  myId,
  onOpenJob,
}: {
  /** Rolni aniqlash uchun — yozuvda workerId meniki bo'lsa, men ishchiman. */
  myId: string;
  onOpenJob: (id: string) => void;
}) {
  const [items, setItems] = useState<Application[] | null>(null);
  const [error, setError] = useState<APIError | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [tick, setTick] = useState(0);

  const load = useCallback(() => {
    setError(null);
    fetchHistory()
      .then((list) =>
        setItems(
          [...(list || [])].sort(
            (a, b) =>
              +new Date(b.completedAt || b.decidedAt || b.appliedAt) -
              +new Date(a.completedAt || a.decidedAt || a.appliedAt),
          ),
        ),
      )
      .catch((e: APIError) => setError(e));
  }, []);

  useEffect(load, [load, tick]);

  const shown = useMemo(() => {
    if (!items) return null;
    if (filter === "all") return items;
    return items.filter((a) =>
      filter === "worker" ? a.workerId === myId : a.employerId === myId,
    );
  }, [items, filter, myId]);

  // Ikkala rolda ham yozuvi bo'lmasa filtr chiziqi ortiqcha joy egallaydi.
  const bothRoles = useMemo(() => {
    if (!items) return false;
    return (
      items.some((a) => a.workerId === myId) && items.some((a) => a.employerId === myId)
    );
  }, [items, myId]);

  if (error) return <ErrorState error={error} onRetry={() => setTick((n) => n + 1)} />;
  if (!shown) {
    return (
      <div className="px-4 pt-4">
        <ListSkeleton count={3} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-4 pt-4">
      {bothRoles && (
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
          {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => {
                haptic.select();
                setFilter(f);
              }}
              className={`chip ${filter === f ? "chip-active" : ""}`}
            >
              {FILTER_LABEL[f]}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <EmptyState
          icon={<HistoryIcon size={26} />}
          title="Tarix bo'sh"
          hint="Yakunlangan va bekor qilingan ishlar shu yerda to'planadi."
        />
      ) : (
        shown.map((a) => {
          const s = STATUS[a.status];
          const asWorker = a.workerId === myId;
          const done = a.status === "completed";

          return (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                haptic.tap();
                onOpenJob(a.elonId);
              }}
              className="job-card flex w-full gap-3 animate-fade-in"
            >
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full"
                style={
                  done
                    ? { background: "#DFF5E5", color: "#1A7F3C" }
                    : { background: "var(--bg-subtle)", color: "var(--text-subtle)" }
                }
              >
                {done ? <CheckIcon size={17} /> : <XIcon size={17} />}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  <h3 className="line-clamp-2 min-w-0 flex-1 text-[16px] font-semibold leading-[21px] heading">
                    {a.elonTitle}
                  </h3>
                  <span className={`${s.cls} shrink-0`}>{s.label}</span>
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] muted">
                  <span className="badge-neutral !px-2 !py-0.5 !text-[10.5px]">
                    {asWorker ? "Ishchi" : "Ish beruvchi"}
                  </span>
                  {!a.isNegotiable && a.amount > 0 && (
                    <span className="font-bold tabular-nums" style={{ color: "var(--brand)" }}>
                      {fmtSum(a.amount)} so'm
                    </span>
                  )}
                  <span className="subtle">
                    {fmtDate(a.completedAt || a.decidedAt || a.appliedAt)}
                  </span>
                </div>
              </div>
            </button>
          );
        })
      )}
    </div>
  );
}
