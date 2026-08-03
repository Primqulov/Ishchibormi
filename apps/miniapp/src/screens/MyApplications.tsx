/**
 * "Arizalarim" — foydalanuvchi yuborgan arizalar.
 *
 * Tartib: javob kutilayotganlar tepada, yakunlanganlar pastda. Ishchi uchun
 * eng dolzarb savol "meni oldilarmi?" — shuning uchun aynan shu holatdagilar
 * birinchi ko'rinadi.
 */

import { useCallback, useEffect, useState } from "react";
import { FileTextIcon } from "@/components/icons";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/ui";
import { fmtSum, fromNow } from "@/lib/format";
import { alertUser, haptic } from "@/lib/telegram";
import {
  cancelApplication,
  fetchMyApplications,
  type APIError,
  type Application,
  type ApplicationStatus,
} from "@/lib/api";

const STATUS: Record<ApplicationStatus, { label: string; cls: string }> = {
  pending:   { label: "Javob kutilmoqda", cls: "badge-pending" },
  accepted:  { label: "Qabul qilindi",    cls: "badge-success" },
  rejected:  { label: "Rad etildi",       cls: "badge-danger" },
  cancelled: { label: "Bekor qilindi",    cls: "badge-neutral" },
  completed: { label: "Yakunlandi",       cls: "badge-info" },
};

// Ro'yxatdagi tartib og'irliklari.
const ORDER: Record<ApplicationStatus, number> = {
  pending: 0, accepted: 1, completed: 2, rejected: 3, cancelled: 4,
};

export function MyApplications({
  onOpenJob,
  reloadKey,
}: {
  onOpenJob: (id: string) => void;
  /** Tashqaridan yangilashga majburlash (masalan yangi ariza berilgach). */
  reloadKey: number;
}) {
  const [items, setItems] = useState<Application[] | null>(null);
  const [error, setError] = useState<APIError | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(() => {
    setError(null);
    fetchMyApplications()
      .then((list) =>
        setItems(
          [...(list || [])].sort(
            (a, b) =>
              ORDER[a.status] - ORDER[b.status] ||
              +new Date(b.appliedAt) - +new Date(a.appliedAt),
          ),
        ),
      )
      .catch((e: APIError) => setError(e));
  }, []);

  useEffect(load, [load, reloadKey, tick]);

  async function cancel(a: Application) {
    setBusyId(a.id);
    try {
      await cancelApplication(a.id);
      haptic.success();
      load();
    } catch (e) {
      haptic.error();
      alertUser((e as APIError).message || "Bekor qilinmadi.");
    } finally {
      setBusyId(null);
    }
  }

  if (error) return <ErrorState error={error} onRetry={() => setTick((n) => n + 1)} />;
  if (!items) return <div className="px-4 pt-4"><ListSkeleton count={3} /></div>;

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<FileTextIcon size={26} />}
        title="Hali ariza bermagansiz"
        hint="«Ishlar» bo'limidan mos e'lonni tanlab ariza yuboring — javobi shu yerda ko'rinadi."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3 px-4 pt-4">
      {items.map((a) => {
        const s = STATUS[a.status];
        // Bekor qilish faqat javob kutilayotgan yoki qabul qilingan arizada
        // mantiqiy — qolganlari allaqachon yakuniy holat.
        const canCancel = a.status === "pending" || a.status === "accepted";

        return (
          <div key={a.id} className="job-card flex flex-col gap-3 animate-fade-in">
            <div className="flex items-start gap-3">
              <button
                type="button"
                onClick={() => {
                  haptic.tap();
                  onOpenJob(a.elonId);
                }}
                className="min-w-0 flex-1 text-left"
              >
                <h3 className="line-clamp-2 text-[18px] font-semibold leading-[22.5px] heading">
                  {a.elonTitle}
                </h3>
              </button>
              <span className={`${s.cls} shrink-0`}>{s.label}</span>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] muted">
              <span className="text-[18px] font-bold tabular-nums" style={{ color: "var(--brand)" }}>
                {a.isNegotiable ? "Kelishiladi" : `${fmtSum(a.amount)} so'm`}
              </span>
              <span className="subtle">{fromNow(a.appliedAt)}</span>
            </div>

            {a.status === "accepted" && a.ownerName && (
              <p
                className="rounded-lg px-3 py-2 text-[12.5px]"
                style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
              >
                Ish beruvchi: <b>{a.ownerName}</b> — u siz bilan bog'lanadi.
              </p>
            )}

            {a.status === "rejected" && a.cancelReason && (
              <p className="text-[12.5px] muted">Sabab: {a.cancelReason}</p>
            )}

            {canCancel && (
              <button
                type="button"
                onClick={() => cancel(a)}
                disabled={busyId === a.id}
                className="btn-ghost !min-h-[38px] self-start !px-0 !text-[13px]"
                style={{ color: "#D92D20" }}
              >
                {busyId === a.id ? "Bekor qilinmoqda..." : "Arizani bekor qilish"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
