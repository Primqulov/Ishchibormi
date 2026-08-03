/**
 * Nomzodlar — e'lonlarimga kelgan arizalar (Figma "Arizalar ro'yxati").
 *
 * Mini App'dagi eng muhim yetishmayotgan bo'lak edi: ish beruvchi e'lon
 * bera olardi, lekin kelgan arizani ko'ra ham, qabul qila ham olmasdi —
 * ya'ni oqim yarim yo'lda uzilardi.
 *
 * Qabul qilish va rad etish QAYTARIB BO'LMAYDI (backend `decide` ariza
 * holatini yakuniy qiladi va ishchiga bildirishnoma yuboradi), shuning
 * uchun ikkalasi ham tasdiqlash so'raydi. Mobil ilovada ham shunday.
 */

import { useCallback, useEffect, useState } from "react";
import {
  CheckIcon,
  XIcon,
  PhoneIcon,
  UsersIcon,
  InboxIcon,
} from "@/components/icons";
import { Avatar, EmptyState, ErrorState, ListSkeleton } from "@/components/ui";
import { fmtPhone, fmtSum, fromNow } from "@/lib/format";
import { alertUser, confirmUser, haptic, openExternal } from "@/lib/telegram";
import {
  acceptApplication,
  confirmDone,
  fetchMyElonsApplications,
  rejectApplication,
  type APIError,
  type Application,
  type ApplicationStatus,
} from "@/lib/api";

const STATUS: Record<ApplicationStatus, { label: string; cls: string }> = {
  pending: { label: "Javob kutilmoqda", cls: "badge-pending" },
  accepted: { label: "Qabul qilindi", cls: "badge-success" },
  rejected: { label: "Rad etildi", cls: "badge-danger" },
  cancelled: { label: "Bekor qilindi", cls: "badge-neutral" },
  completed: { label: "Yakunlandi", cls: "badge-info" },
};

// Javob kutayotganlar tepada — ish beruvchi aynan ular uchun kiradi.
const ORDER: Record<ApplicationStatus, number> = {
  pending: 0, accepted: 1, completed: 2, rejected: 3, cancelled: 4,
};

export function Candidates({ onOpenJob }: { onOpenJob: (id: string) => void }) {
  const [groups, setGroups] = useState<
    { elonId: string; elonTitle: string; apps: Application[] }[] | null
  >(null);
  const [error, setError] = useState<APIError | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(() => {
    setError(null);
    fetchMyElonsApplications()
      .then((gs) =>
        setGroups(
          gs.map((g) => ({
            ...g,
            apps: [...g.apps].sort(
              (a, b) =>
                ORDER[a.status] - ORDER[b.status] ||
                +new Date(b.appliedAt) - +new Date(a.appliedAt),
            ),
          })),
        ),
      )
      .catch((e: APIError) => setError(e));
  }, []);

  useEffect(load, [load, tick]);

  async function decide(a: Application, action: "accept" | "reject") {
    const who = a.workerName || "nomzod";
    const ok = await confirmUser(
      action === "accept"
        ? `${who}ni ishga qabul qilasizmi? Bu qarorni qaytarib bo'lmaydi.`
        : `${who}ning arizasini rad etasizmi? Bu qarorni qaytarib bo'lmaydi.`,
    );
    if (!ok) return;

    setBusyId(a.id);
    try {
      if (action === "accept") await acceptApplication(a.id);
      else await rejectApplication(a.id);
      haptic.success();
      load();
    } catch (e) {
      haptic.error();
      alertUser((e as APIError).message || "Amal bajarilmadi.");
    } finally {
      setBusyId(null);
    }
  }

  async function markDone(a: Application) {
    const ok = await confirmUser("Ish bajarilganini tasdiqlaysizmi?");
    if (!ok) return;
    setBusyId(a.id);
    try {
      await confirmDone(a.id);
      haptic.success();
      load();
    } catch (e) {
      haptic.error();
      alertUser((e as APIError).message || "Tasdiqlanmadi.");
    } finally {
      setBusyId(null);
    }
  }

  if (error) return <ErrorState error={error} onRetry={() => setTick((n) => n + 1)} />;
  if (!groups) {
    return (
      <div className="px-4 pt-4">
        <ListSkeleton count={3} />
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <EmptyState
        icon={<InboxIcon size={26} />}
        title="Hali ariza yo'q"
        hint="E'loningizga ariza kelganda shu yerda ko'rinadi va nomzodni qabul qilishingiz mumkin."
      />
    );
  }

  return (
    <div className="flex flex-col gap-5 px-4 pb-4 pt-4">
      {groups.map((g) => {
        const pending = g.apps.filter((a) => a.status === "pending").length;
        return (
          <section key={g.elonId} className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => {
                haptic.tap();
                onOpenJob(g.elonId);
              }}
              className="flex items-center gap-2 px-1 text-left"
            >
              <h2 className="min-w-0 flex-1 truncate text-[18px] font-semibold leading-6 heading">
                {g.elonTitle}
              </h2>
              {pending > 0 && (
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold text-white"
                  style={{ background: "var(--accent)" }}
                >
                  {pending} yangi
                </span>
              )}
            </button>

            <div className="flex flex-col gap-3">
              {g.apps.map((a) => {
                const s = STATUS[a.status];
                const busy = busyId === a.id;
                // Ish beruvchi hali tasdiqlamagan qabul qilingan ariza —
                // "bajarildi" tugmasi shu holatda mantiqiy.
                const canFinish = a.status === "accepted" && !a.employerConfirmedDone;

                return (
                  <div key={a.id} className="job-card flex flex-col gap-3 animate-fade-in">
                    <div className="flex items-start gap-3">
                      <Avatar firstName={a.workerName} size={44} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[16px] font-semibold heading">
                          {a.workerName || "Nomzod"}
                        </p>
                        <p className="text-[12.5px] subtle">{fromNow(a.appliedAt)}</p>
                      </div>
                      <span className={`${s.cls} shrink-0`}>{s.label}</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] muted">
                      {!a.isNegotiable && a.amount > 0 && (
                        <span
                          className="text-[18px] font-bold tabular-nums"
                          style={{ color: "var(--brand)" }}
                        >
                          {fmtSum(a.amount)} so'm
                        </span>
                      )}
                      {a.peopleCount && a.peopleCount > 1 && (
                        <span className="inline-flex items-center gap-1">
                          <UsersIcon size={13} className="subtle" />
                          {a.peopleCount} kishi
                        </span>
                      )}
                    </div>

                    {/* Telefon FAQAT qabul qilingandan keyin ko'rinadi —
                        backend ham shu tartibda beradi. */}
                    {a.status === "accepted" && a.workerPhone && (
                      <button
                        type="button"
                        onClick={() => {
                          haptic.tap();
                          openExternal(`tel:${a.workerPhone}`);
                        }}
                        className="btn-soft self-start !min-h-[38px] !px-3.5 !py-2 !text-[13px]"
                      >
                        <PhoneIcon size={14} />
                        {fmtPhone(a.workerPhone)}
                      </button>
                    )}

                    {a.status === "pending" && (
                      <div
                        className="flex gap-2 pt-3"
                        style={{
                          borderTop: "1px solid color-mix(in srgb, var(--border) 70%, transparent)",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => decide(a, "reject")}
                          disabled={busy}
                          className="btn-outline flex-1 !min-h-[42px]"
                          style={{ color: "#D92D20", borderColor: "rgba(217,45,32,.25)" }}
                        >
                          <XIcon size={15} />
                          Rad etish
                        </button>
                        <button
                          type="button"
                          onClick={() => decide(a, "accept")}
                          disabled={busy}
                          className="btn-primary flex-1 !min-h-[42px]"
                        >
                          <CheckIcon size={15} />
                          {busy ? "..." : "Qabul qilish"}
                        </button>
                      </div>
                    )}

                    {canFinish && (
                      <button
                        type="button"
                        onClick={() => markDone(a)}
                        disabled={busy}
                        className="btn-soft w-full !min-h-[42px]"
                      >
                        <CheckIcon size={15} />
                        {busy ? "..." : "Ish bajarildi"}
                      </button>
                    )}

                    {a.status === "accepted" && a.employerConfirmedDone && !a.workerConfirmedDone && (
                      <p className="text-[12.5px] subtle">
                        Siz tasdiqladingiz — ishchining tasdig'i kutilmoqda.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
