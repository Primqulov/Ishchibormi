/**
 * "E'lonlarim" — foydalanuvchi bergan e'lonlar.
 *
 * Bekor qilish bor, o'chirish yo'q: o'chirish e'longa bog'langan arizalarni
 * ham yo'q qiladi va ishchilar nima bo'lganini tushunmay qoladi. Bekor
 * qilinganda esa holat ochiq qoladi va ishchiga bildirishnoma boradi
 * (backend elon.Cancel shuni qiladi).
 */

import { useCallback, useEffect, useState } from "react";
import { BriefcaseIcon, UsersIcon } from "@/components/icons";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/ui";
import { fmtSum, fmtWhen, fromNow } from "@/lib/format";
import { catTone } from "@/lib/cat-color";
import { alertUser, haptic } from "@/lib/telegram";
import {
  cancelElon,
  fetchMyElons,
  type APIError,
  type Elon,
  type ElonStatus,
} from "@/lib/api";

const STATUS: Record<ElonStatus, { label: string; cls: string }> = {
  draft: { label: "Qoralama", cls: "badge-neutral" },
  recruiting: { label: "Ishchi qidirilmoqda", cls: "badge-info" },
  filled: { label: "O'rinlar to'ldi", cls: "badge-success" },
  in_progress: { label: "Ish ketmoqda", cls: "badge-pending" },
  completed: { label: "Yakunlandi", cls: "badge-success" },
  cancelled: { label: "Bekor qilindi", cls: "badge-neutral" },
  hidden: { label: "Yashirilgan", cls: "badge-neutral" },
};

// Faol e'lonlar tepada — ish beruvchi eng ko'p ular bilan ishlaydi.
const ORDER: Record<ElonStatus, number> = {
  recruiting: 0, filled: 1, in_progress: 2, draft: 3,
  completed: 4, cancelled: 5, hidden: 6,
};

export function MyElons({
  onOpenJob,
  onPost,
  reloadKey,
}: {
  onOpenJob: (id: string) => void;
  onPost: () => void;
  reloadKey: number;
}) {
  const [items, setItems] = useState<Elon[] | null>(null);
  const [error, setError] = useState<APIError | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(() => {
    setError(null);
    fetchMyElons()
      .then((list) =>
        setItems(
          [...(list || [])].sort(
            (a, b) =>
              ORDER[a.status] - ORDER[b.status] ||
              +new Date(b.createdAt) - +new Date(a.createdAt),
          ),
        ),
      )
      .catch((e: APIError) => setError(e));
  }, []);

  useEffect(load, [load, reloadKey, tick]);

  async function cancel(e: Elon) {
    setBusyId(e.id);
    try {
      await cancelElon(e.id);
      haptic.success();
      load();
    } catch (err) {
      haptic.error();
      alertUser((err as APIError).message || "Bekor qilinmadi.");
    } finally {
      setBusyId(null);
    }
  }

  if (error) return <ErrorState error={error} onRetry={() => setTick((n) => n + 1)} />;
  if (!items) {
    return (
      <div className="px-4 pt-4">
        <ListSkeleton count={3} />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center">
        <EmptyState
          icon={<BriefcaseIcon size={26} />}
          title="Hali e'lon bermagansiz"
          hint="Ishchi kerak bo'lsa e'lon joylang — arizalar shu yerda ko'rinadi."
        />
        <button type="button" onClick={onPost} className="btn-primary -mt-6">
          E'lon berish
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-4 pt-4">
      {items.map((e) => {
        const s = STATUS[e.status] || STATUS.hidden;
        const tone = catTone(e.categoryName);
        const negotiable = e.pricingType === "negotiable";
        // Bekor qilish faqat hali tugamagan e'londa mantiqiy.
        const canCancel =
          e.status === "recruiting" || e.status === "filled" || e.status === "in_progress";

        return (
          <div key={e.id} className="card flex flex-col gap-3 p-4 animate-fade-in">
            <div className="flex items-start gap-3">
              <button
                type="button"
                onClick={() => {
                  haptic.tap();
                  onOpenJob(e.id);
                }}
                className="min-w-0 flex-1 text-left"
              >
                {e.categoryName && (
                  <span
                    className="tag-cat mb-1.5 inline-block"
                    style={{ background: tone.bg, color: tone.fg }}
                  >
                    {e.categoryName}
                  </span>
                )}
                <h3 className="line-clamp-2 text-[15px] font-semibold leading-5 heading">
                  {e.title}
                </h3>
              </button>
              <span className={`${s.cls} shrink-0`}>{s.label}</span>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] muted">
              <span className="font-bold tabular-nums" style={{ color: "var(--brand)" }}>
                {negotiable ? "Kelishiladi" : `${fmtSum(e.perWorkerAmount || e.priceAmount)} so'm`}
              </span>
              <span className="inline-flex items-center gap-1">
                <UsersIcon size={12} className="subtle" />
                {e.acceptedCount || 0}/{e.workersNeeded || 0}
              </span>
              {fmtWhen(e.startDate, e.workTimeFrom) && (
                <span className="subtle">{fmtWhen(e.startDate, e.workTimeFrom)}</span>
              )}
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-[11.5px] subtle">
                {fromNow(e.publishedAt || e.createdAt)}
              </span>
              {canCancel && (
                <button
                  type="button"
                  onClick={() => cancel(e)}
                  disabled={busyId === e.id}
                  className="btn-ghost !min-h-[34px] !px-0 !text-[12.5px]"
                  style={{ color: "#D92D20" }}
                >
                  {busyId === e.id ? "Bekor qilinmoqda..." : "E'lonni bekor qilish"}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
