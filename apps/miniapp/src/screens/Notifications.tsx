/**
 * Bildirishnomalar.
 *
 * O'qilmaganlar chap chetidagi rangli chiziq va to'q fon bilan ajratiladi —
 * belgi (nuqta) o'rniga butun qator ko'rinishi o'zgaradi, chunki telefonda
 * kichik nuqtani ko'z ilg'amaydi.
 *
 * Yozuv ochilganda o'sha yozuvga tegishli o'qilmaganlar server tomonda
 * belgilanadi (`/api/notifications/read`), ya'ni bir e'lon bo'yicha kelgan
 * bir nechta xabar birdan tinadi — foydalanuvchi ularni birma-bir bosib
 * chiqmaydi.
 */

import { useCallback, useEffect, useState } from "react";
import {
  BellIcon,
  CheckIcon,
  UsersIcon,
  BriefcaseIcon,
  AlertIcon,
} from "@/components/icons";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/ui";
import { fromNow } from "@/lib/format";
import { haptic } from "@/lib/telegram";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
  type APIError,
  type AppNotification,
} from "@/lib/api";

/**
 * Har bir tur uchun ikonka va rang.
 *
 * Turlar backend'dan keladi (apps/api ichida `notif.Push(...)` chaqiruvlari).
 * Ro'yxatda yo'q tur uchun neytral ko'rinish ishlatiladi — yangi tur
 * qo'shilganda Mini App buzilmaydi, shunchaki oddiy ikonka bilan chiqadi.
 */
const VISUALS: Record<string, { icon: React.ReactNode; bg: string; fg: string }> = {
  application_accepted: { icon: <CheckIcon size={17} />, bg: "#DFF5E5", fg: "#1A7F3C" },
  application_rejected: { icon: <AlertIcon size={17} />, bg: "#FEE4E2", fg: "#B42318" },
  application_cancelled: { icon: <AlertIcon size={17} />, bg: "#FEE4E2", fg: "#B42318" },
  elon_full: { icon: <UsersIcon size={17} />, bg: "var(--brand-soft)", fg: "var(--brand)" },
  elon_status: { icon: <BriefcaseIcon size={17} />, bg: "var(--brand-soft)", fg: "var(--brand)" },
  elon_delete: { icon: <AlertIcon size={17} />, bg: "#FFEED4", fg: "#8A5300" },
  report_received: { icon: <AlertIcon size={17} />, bg: "#FFEED4", fg: "#8A5300" },
};

const NEUTRAL = {
  icon: <BellIcon size={17} />,
  bg: "var(--bg-subtle)",
  fg: "var(--text-muted)",
};

export function Notifications({
  onOpenJob,
  onUnreadChange,
  reloadKey,
}: {
  onOpenJob: (id: string) => void;
  /** Tab bar'dagi belgini yangilash uchun. */
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

    // O'qilgan deb belgilash — avval ekranda, keyin serverda. Xatosi
    // ko'rsatilmaydi: foydalanuvchi e'lonni ochyapti, uni to'xtatishning
    // ma'nosi yo'q; keyingi yuklashda haqiqiy holat keladi.
    if (!n.isRead) {
      setItems((prev) =>
        prev ? prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)) : prev,
      );
      onUnreadChange(items ? Math.max(0, items.filter((x) => !x.isRead).length - 1) : 0);
      const rel = n.relatedEntity;
      if (rel?.id) void markNotificationsRead([rel.id], rel.type).catch(() => {});
    }

    // Faqat e'longa o'tish mumkin — ariza bildirishnomasi ham o'z e'loniga
    // ishora qiladi, chunki ishchi uchun kerakli kontekst o'sha yerda.
    const rel = n.relatedEntity;
    if (rel && (rel.type === "elon" || rel.type === "application") && rel.id) {
      onOpenJob(rel.id);
    }
  }

  if (error) return <ErrorState error={error} onRetry={() => setTick((n) => n + 1)} />;
  if (!items) {
    return (
      <div className="px-4 pt-4">
        <ListSkeleton count={4} />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<BellIcon size={26} />}
        title="Bildirishnoma yo'q"
        hint="Arizangizga javob berilganda yoki e'loningizga o'zgarish bo'lganda shu yerda ko'rinadi."
      />
    );
  }

  const unread = items.filter((n) => !n.isRead).length;

  return (
    <div className="flex flex-col gap-3 px-4 pt-4">
      {unread > 0 && (
        <button
          type="button"
          onClick={readAll}
          disabled={markingAll}
          className="btn-soft self-end !min-h-[36px] !px-3.5 !py-2 !text-[12.5px]"
        >
          <CheckIcon size={14} />
          Hammasini o'qilgan qilish
        </button>
      )}

      {items.map((n) => {
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
            className="card relative flex w-full gap-3 overflow-hidden p-4 text-left transition active:scale-[0.99] disabled:active:scale-100 animate-fade-in"
            style={
              n.isRead
                ? undefined
                : { background: "var(--brand-soft)", borderColor: "var(--brand-tint)" }
            }
          >
            {/* O'qilmaganlik belgisi — chap chetdagi rangli chiziq. */}
            {!n.isRead && (
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-[3px]"
                style={{ background: "var(--brand)" }}
              />
            )}

            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full"
              style={{ background: v.bg, color: v.fg }}
            >
              {v.icon}
            </span>

            <div className="min-w-0 flex-1">
              <p
                className={`text-[14px] leading-5 heading ${n.isRead ? "font-semibold" : "font-bold"}`}
              >
                {n.title}
              </p>
              {n.body && (
                <p className="mt-0.5 text-[13px] leading-relaxed muted">{n.body}</p>
              )}
              <p className="mt-1 text-[11.5px] subtle">{fromNow(n.createdAt)}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
