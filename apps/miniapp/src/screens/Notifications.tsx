/**
 * Bildirishnomalar — Figma maketidagi "Bildirishnomalar sahifasi".
 *
 * Maketdan olingan uch narsa:
 *  - yozuvlar SANA bo'yicha guruhlanadi ("Bugun", "Kecha", "12 avgust");
 *  - har yozuvda tur yorlig'i va o'ng chetda soat (nisbiy vaqt emas —
 *    "3 soat oldin" ro'yxatda takrorlanib, ko'zni charchatadi);
 *  - o'qilmagan yozuv butunlay boshqacha ko'rinadi: yumshoq ko'k fon, chapda
 *    ko'k chiziq va sarlavha yonida nuqta. Kichik belgi telefonda ilg'anmaydi.
 *
 * Yozuv ochilganda o'sha yozuvga tegishli o'qilmaganlar server tomonda
 * belgilanadi (`/api/notifications/read`), ya'ni bir e'lon bo'yicha kelgan
 * bir nechta xabar birdan tinadi.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BellIcon,
  CheckIcon,
  DoubleCheckIcon,
  UsersIcon,
  BriefcaseIcon,
  AlertIcon,
  InfoIcon,
} from "@/components/icons";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/ui";
import { dayGroup, fmtTime } from "@/lib/format";
import { haptic } from "@/lib/telegram";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
  type APIError,
  type AppNotification,
} from "@/lib/api";

/**
 * Tur → ko'rinish. Backend turlari `notif.Push(...)` chaqiruvlaridan keladi;
 * ro'yxatda yo'q tur neytral ko'rinishda chiqadi, ya'ni yangi tur qo'shilsa
 * ilova buzilmaydi.
 */
const VISUALS: Record<
  string,
  { icon: React.ReactNode; bg: string; fg: string; tag: string }
> = {
  application_accepted: { icon: <CheckIcon size={16} />, bg: "#DFF5E5", fg: "#1A7F3C", tag: "Ariza" },
  application_rejected: { icon: <AlertIcon size={16} />, bg: "#FEE4E2", fg: "#B42318", tag: "Ariza" },
  application_cancelled: { icon: <AlertIcon size={16} />, bg: "#FEE4E2", fg: "#B42318", tag: "Ariza" },
  elon_full: { icon: <UsersIcon size={16} />, bg: "var(--brand-tint)", fg: "var(--brand)", tag: "E'lon" },
  elon_status: { icon: <BriefcaseIcon size={16} />, bg: "var(--brand-tint)", fg: "var(--brand)", tag: "E'lon" },
  elon_delete: { icon: <AlertIcon size={16} />, bg: "var(--accent-soft)", fg: "var(--accent-text)", tag: "E'lon" },
  report_received: { icon: <AlertIcon size={16} />, bg: "var(--accent-soft)", fg: "var(--accent-text)", tag: "Shikoyat" },
};

const NEUTRAL = {
  icon: <InfoIcon size={16} />,
  bg: "var(--bg-subtle)",
  fg: "var(--text-muted)",
  tag: "Tizim xabari",
};

export function Notifications({
  onOpenJob,
  onUnreadChange,
  reloadKey,
}: {
  onOpenJob: (id: string) => void;
  /** Tepadagi qo'ng'iroq va tab belgisini yangilash uchun. */
  onUnreadChange: (n: number) => void;
  reloadKey: number;
}) {
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [error, setError] = useState<APIError | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [tick, setTick] = useState(0);

  const load = useCallback(() => {
    setError(null);
    fetchNotifications()
      .then((list) => {
        const arr = list || [];
        setItems(arr);
        onUnreadChange(arr.filter((n) => !n.isRead).length);
      })
      .catch((e: APIError) => setError(e));
  }, [onUnreadChange]);

  useEffect(load, [load, reloadKey, tick]);

  // Sana bo'yicha guruhlash. Ro'yxat serverdan yangisi birinchi bo'lib
  // keladi, shuning uchun guruhlar ham o'z-o'zidan to'g'ri tartibda chiqadi.
  const groups = useMemo(() => {
    if (!items) return null;
    const out: { day: string; rows: AppNotification[] }[] = [];
    for (const n of items) {
      const day = dayGroup(n.createdAt);
      const last = out[out.length - 1];
      if (last && last.day === day) last.rows.push(n);
      else out.push({ day, rows: [n] });
    }
    return out;
  }, [items]);

  async function readAll() {
    if (markingAll) return;
    setMarkingAll(true);
    // Optimistik: ro'yxat darhol o'zgaradi. So'rov yiqilsa `load()` haqiqiy
    // holatni qaytaradi, ya'ni yolg'on holat uzoq turmaydi.
    setItems((prev) => (prev ? prev.map((n) => ({ ...n, isRead: true })) : prev));
    onUnreadChange(0);
    try {
      await markAllNotificationsRead();
      haptic.success();
    } catch {
      haptic.error();
    } finally {
      setMarkingAll(false);
      load();
    }
  }

  function open(n: AppNotification) {
    haptic.tap();

    if (!n.isRead) {
      setItems((prev) =>
        prev ? prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)) : prev,
      );
      onUnreadChange(items ? Math.max(0, items.filter((x) => !x.isRead).length - 1) : 0);
      const rel = n.relatedEntity;
      // Xatosi ko'rsatilmaydi: foydalanuvchi e'lonni ochyapti, uni to'xtatish
      // ma'nosiz; keyingi yuklashda haqiqiy holat keladi.
      if (rel?.id) void markNotificationsRead([rel.id], rel.type).catch(() => {});
    }

    const rel = n.relatedEntity;
    if (rel && (rel.type === "elon" || rel.type === "application") && rel.id) {
      onOpenJob(rel.id);
    }
  }

  if (error) return <ErrorState error={error} onRetry={() => setTick((n) => n + 1)} />;
  if (!groups) {
    return (
      <div className="px-4 pt-4">
        <ListSkeleton count={4} />
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <EmptyState
        icon={<BellIcon size={26} />}
        title="Bildirishnoma yo'q"
        hint="Arizangizga javob berilganda yoki e'loningizga o'zgarish bo'lganda shu yerda ko'rinadi."
      />
    );
  }

  const unread = (items || []).filter((n) => !n.isRead).length;

  return (
    <div className="flex flex-col gap-5 px-4 pb-4 pt-4">
      {groups.map((g, gi) => (
        <section key={g.day} className="flex flex-col gap-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-[12px] font-semibold uppercase tracking-[1px] subtle">
              {g.day}
            </h2>
            {/* "Hammasini o'qilgan qilish" — maketda birinchi guruh
                sarlavhasining o'ng chetidagi ikki belgi. */}
            {gi === 0 && unread > 0 && (
              <button
                type="button"
                onClick={readAll}
                disabled={markingAll}
                aria-label="Hammasini o'qilgan qilish"
                className="grid h-8 w-8 place-items-center rounded-full transition active:scale-90"
                style={{ color: "var(--brand)" }}
              >
                <DoubleCheckIcon size={18} />
              </button>
            )}
          </div>

          <div className="flex flex-col gap-3">
            {g.rows.map((n) => {
              const v = VISUALS[n.type] || NEUTRAL;
              const rel = n.relatedEntity;
              const clickable = Boolean(
                rel?.id && (rel.type === "elon" || rel.type === "application"),
              );

              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => open(n)}
                  disabled={!clickable}
                  className="relative flex w-full gap-3 overflow-hidden rounded-xl p-4 text-left transition active:scale-[0.99] disabled:active:scale-100 animate-fade-in"
                  style={
                    n.isRead
                      ? {
                          background: "var(--card)",
                          border: "1px solid color-mix(in srgb, var(--border) 70%, transparent)",
                          boxShadow: "0 2px 4px rgba(0,0,0,.02)",
                        }
                      : {
                          background: "var(--brand-soft)",
                          border: "1px solid var(--brand-tint)",
                        }
                  }
                >
                  {/* O'qilmaganlik belgisi — chap chetdagi ko'k chiziq. */}
                  {!n.isRead && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-0 left-0 w-1"
                      style={{ background: "var(--brand)" }}
                    />
                  )}

                  <span
                    className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full"
                    style={{ background: v.bg, color: v.fg }}
                  >
                    {v.icon}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                        style={
                          n.isRead
                            ? { background: "var(--bg-subtle)", color: "var(--text-subtle)" }
                            : { background: "var(--brand-tint)", color: "var(--brand)" }
                        }
                      >
                        {v.tag}
                      </span>
                      {!n.isRead && (
                        <span
                          aria-hidden="true"
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ background: "var(--brand)" }}
                        />
                      )}
                      <span className="ml-auto shrink-0 text-[12px] subtle">
                        {fmtTime(n.createdAt)}
                      </span>
                    </div>

                    <p
                      className={`mt-1 text-[16px] leading-6 ${n.isRead ? "font-semibold" : "font-bold"}`}
                      style={{ color: n.isRead ? "var(--text-muted)" : "var(--heading)" }}
                    >
                      {n.title}
                    </p>
                    {n.body && (
                      <p className="mt-0.5 text-[14px] leading-5 muted">{n.body}</p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
