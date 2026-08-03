/**
 * Ilova qobig'i: kirish darvozasi + navigatsiya.
 *
 * Router kutubxonasi ataylab ishlatilmagan. Mini App'da manzil qatori yo'q,
 * chuqur havolalar ham kerak emas. Buning o'rniga oddiy stek + brauzer
 * tarixi ishlatiladi, chunki tarix Telegram'ning BackButton'i bilan tabiiy
 * bog'lanadi (u ham, Android'ning "orqaga" tugmasi ham history.back() ga
 * tushadi).
 *
 * Tuzilishi ikki qavatli:
 *   - pastda TAB (ro'yxat, arizalar, xabarlar, profil) — TabBar bilan;
 *   - ustida OVERLAY STEKI (e'lon, e'lon berish, profil tahriri, ...).
 * Har overlay bitta tarix yozuvi ochadi, "orqaga" esa bittasini yopadi —
 * shu bir-birga moslik tufayli foydalanuvchi hech qachon ilovadan tasodifan
 * chiqib ketmaydi.
 */

import { useCallback, useEffect, useState } from "react";
import { TabBar, type Tab } from "@/components/TabBar";
import { ErrorState, Spinner } from "@/components/ui";
import { ListIcon, MapIcon } from "@/components/icons";
import { Feed } from "@/screens/Feed";
import { History } from "@/screens/History";
import { JobDetail } from "@/screens/JobDetail";
import { MapView } from "@/screens/MapView";
import { MyApplications } from "@/screens/MyApplications";
import { MyElons } from "@/screens/MyElons";
import { Notifications } from "@/screens/Notifications";
import { PostJob } from "@/screens/PostJob";
import { Profile } from "@/screens/Profile";
import { ProfileEdit } from "@/screens/ProfileEdit";
import { Register } from "@/screens/Register";
import {
  fetchMe,
  fetchMyApplications,
  fetchNotifications,
  getAccess,
  loginWithInitData,
  type APIError,
  type User,
} from "@/lib/api";
import { haptic, isTelegram, showBackButton } from "@/lib/telegram";

type Gate =
  | { state: "loading" }
  | { state: "register" }
  | { state: "ready"; me: User }
  | { state: "error"; error: APIError };

/** Tab ustida ochiladigan ekranlar. */
type Overlay =
  | { kind: "job"; id: string }
  | { kind: "post" }
  | { kind: "edit" }
  | { kind: "myElons" }
  | { kind: "history" };

const TAB_TITLE: Record<Tab, string> = {
  feed: "Ishlar",
  applications: "Arizalarim",
  notifications: "Xabarlar",
  profile: "Profil",
};

export default function App() {
  const [gate, setGate] = useState<Gate>({ state: "loading" });
  const [tab, setTab] = useState<Tab>("feed");
  const [stack, setStack] = useState<Overlay[]>([]);
  const [feedMode, setFeedMode] = useState<"list" | "map">("list");

  // Ro'yxatlarni tashqaridan yangilashga majburlovchi hisoblagichlar.
  const [appsVersion, setAppsVersion] = useState(0);
  const [elonsVersion, setElonsVersion] = useState(0);
  const [notifVersion, setNotifVersion] = useState(0);

  const [unread, setUnread] = useState(0);
  const [pending, setPending] = useState(0);

  // ── Kirish ────────────────────────────────────────────────────────
  const authenticate = useCallback(async () => {
    setGate({ state: "loading" });

    // Saqlangan token bo'lsa avval uni ishlatib ko'ramiz: bu ortiqcha
    // tarmoq borishini tejaydi va ilova bir zumda ochiladi.
    if (getAccess()) {
      try {
        const me = await fetchMe();
        setGate({ state: "ready", me });
        return;
      } catch (e) {
        // 401 bo'lsa api.ts tokenni allaqachon tozalagan — pastda initData
        // bilan qaytadan kiramiz. Boshqa xatoda ham shu yo'l sinaladi.
        if ((e as APIError).code === "network") {
          setGate({ state: "error", error: e as APIError });
          return;
        }
      }
    }

    if (!isTelegram) {
      setGate({
        state: "error",
        error: {
          code: "not_telegram",
          message:
            "Bu ilova Telegram ichida ochilishi kerak. @Ishchibormibot ga o'ting va «Ishlarni ochish» tugmasini bosing.",
        },
      });
      return;
    }

    try {
      const { user } = await loginWithInitData();
      setGate({ state: "ready", me: user });
    } catch (e) {
      const err = e as APIError;
      // 409 need_contact — xato emas: shunchaki hali telefon bog'lanmagan.
      if (err.code === "need_contact") {
        setGate({ state: "register" });
        return;
      }
      setGate({ state: "error", error: err });
    }
  }, []);

  useEffect(() => {
    void authenticate();
  }, [authenticate]);

  // Tab bar belgilari. Xatosi jimgina yutiladi — belgi ko'rinmasligi
  // ilovaning ishlashiga to'sqinlik qilmaydi.
  useEffect(() => {
    if (gate.state !== "ready") return;
    fetchNotifications()
      .then((list) => setUnread((list || []).filter((n) => !n.isRead).length))
      .catch(() => {});
    fetchMyApplications()
      .then((list) => setPending((list || []).filter((a) => a.status === "pending").length))
      .catch(() => {});
  }, [gate.state, notifVersion, appsVersion]);

  // ── Navigatsiya ───────────────────────────────────────────────────

  const push = useCallback((o: Overlay) => {
    setStack((s) => {
      const next = [...s, o];
      // Tarixga chuqurlikni YOZAMIZ, shunchaki belgi emas. Sabab: bir necha
      // qavatni birdan yopganda (tab almashish) brauzer `history.go(-n)`
      // uchun popstate'ni FAQAT BIR MARTA chiqaradi. "Har popstate'da bitta
      // yechish" mantig'i o'shanda stekni tarixdan chuqurroq qoldirardi va
      // keyingi "orqaga" ilovadan chiqarib yuborardi.
      history.pushState({ ibDepth: next.length }, "");
      return next;
    });
  }, []);

  const close = useCallback(() => {
    // history.back() popstate'ni chaqiradi, u esa stekni qisqartiradi —
    // holatni bu yerda qo'lda o'zgartirsak tarix bilan rasstrojka bo'lardi.
    history.back();
  }, []);

  const openJob = useCallback((id: string) => push({ kind: "job", id }), [push]);

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      // Manzilda qancha qavat qolgani — tarix holatidan. Boshlang'ich
      // yozuvda `ibDepth` yo'q, ya'ni 0 (hech qanday overlay ochiq emas).
      const depth = Number((e.state as { ibDepth?: number } | null)?.ibDepth ?? 0);
      setStack((s) => (depth < s.length ? s.slice(0, depth) : s));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Telegram'ning "orqaga" tugmasi faqat overlay ochiq bo'lganda ko'rinadi.
  const top = stack[stack.length - 1];
  useEffect(() => {
    if (!top) return;
    return showBackButton(close);
  }, [top, close]);

  // Tab almashganda ochiq overlay'lar yopilsin.
  const changeTab = useCallback(
    (t: Tab) => {
      if (stack.length > 0) history.go(-stack.length);
      // "Xabarlar"ga har kirganda ro'yxat qaytadan so'raladi: ilova ochiq
      // turganda yangi bildirishnoma kelgan bo'lishi mumkin va foydalanuvchi
      // aynan shuni ko'rish uchun kiradi.
      if (t === "notifications") setNotifVersion((n) => n + 1);
      setTab(t);
    },
    [stack.length],
  );

  // ── Ko'rinish ─────────────────────────────────────────────────────

  if (gate.state === "loading") {
    return (
      <Screen>
        <Spinner label="Yuklanmoqda..." />
      </Screen>
    );
  }

  if (gate.state === "error") {
    return (
      <Screen>
        <ErrorState error={gate.error} onRetry={() => void authenticate()} />
      </Screen>
    );
  }

  if (gate.state === "register") {
    return (
      <Screen>
        <Register onDone={() => void authenticate()} />
      </Screen>
    );
  }

  const { me } = gate;

  return (
    <Screen>
      {top ? (
        <Overlays
          top={top}
          me={me}
          onOpenJob={openJob}
          onClose={close}
          onApplied={() => setAppsVersion((n) => n + 1)}
          onCreated={() => {
            setElonsVersion((n) => n + 1);
            close();
          }}
          onSaved={(u) => {
            setGate({ state: "ready", me: u });
            close();
          }}
          onPost={() => push({ kind: "post" })}
          elonsVersion={elonsVersion}
        />
      ) : (
        <>
          <Header
            title={TAB_TITLE[tab]}
            action={
              tab === "feed" ? (
                <ModeToggle mode={feedMode} onChange={setFeedMode} />
              ) : undefined
            }
          />

          {tab === "feed" &&
            (feedMode === "map" ? (
              <MapView onOpenJob={openJob} />
            ) : (
              <Feed onOpenJob={openJob} />
            ))}

          {tab === "applications" && (
            <MyApplications onOpenJob={openJob} reloadKey={appsVersion} />
          )}

          {tab === "notifications" && (
            <Notifications
              onOpenJob={openJob}
              onUnreadChange={setUnread}
              reloadKey={notifVersion}
            />
          )}

          {tab === "profile" && (
            <Profile
              me={me}
              onEdit={() => push({ kind: "edit" })}
              onMyElons={() => push({ kind: "myElons" })}
              onHistory={() => push({ kind: "history" })}
            />
          )}
        </>
      )}

      {/* Overlay ochiq bo'lganda tab bar yashiriladi: pastda Telegram'ning
          MainButton'i turadi va ikkalasi bir joyga to'g'ri kelib qolardi. */}
      {!top && (
        <TabBar
          active={tab}
          onChange={changeTab}
          onPost={() => push({ kind: "post" })}
          unread={unread}
          pendingCount={pending}
        />
      )}
    </Screen>
  );
}

/** Overlay steki ustidagi ekranni tanlaydi. */
function Overlays({
  top,
  me,
  onOpenJob,
  onClose,
  onApplied,
  onCreated,
  onSaved,
  onPost,
  elonsVersion,
}: {
  top: Overlay;
  me: User;
  onOpenJob: (id: string) => void;
  onClose: () => void;
  onApplied: () => void;
  onCreated: () => void;
  onSaved: (u: User) => void;
  onPost: () => void;
  elonsVersion: number;
}) {
  switch (top.kind) {
    case "job":
      return <JobDetail id={top.id} onApplied={onApplied} />;
    case "post":
      return <PostJob myPhone={me.phone} onCreated={onCreated} onClose={onClose} />;
    case "edit":
      return <ProfileEdit me={me} onSaved={onSaved} onClose={onClose} />;
    case "myElons":
      return (
        <>
          <Header title="E'lonlarim" />
          <MyElons onOpenJob={onOpenJob} onPost={onPost} reloadKey={elonsVersion} />
        </>
      );
    case "history":
      return (
        <>
          <Header title="Ish tarixi" />
          <History myId={me.id} onOpenJob={onOpenJob} />
        </>
      );
  }
}

/**
 * Sahifa idishi.
 *
 * Balandlik --tg-vh dan olinadi (telegram.ts uni viewportStableHeight bilan
 * yangilaydi), 100vh emas: Telegram'da klaviatura ochilganda 100vh haqiqiy
 * ko'rinadigan balandlikdan katta bo'lib qoladi va pastki panel ekrandan
 * tushib ketadi.
 */
function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="pb-tabbar mx-auto w-full max-w-md"
      style={{ minHeight: "var(--tg-vh)" }}
    >
      {children}
    </div>
  );
}

function Header({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <header className="flex items-center justify-between gap-3 px-4 pt-5">
      <h1 className="text-[26px] font-black leading-tight tracking-[-0.5px] heading">
        {title}
      </h1>
      {action}
    </header>
  );
}

/** Ro'yxat ↔ xarita almashtirgichi. */
function ModeToggle({
  mode,
  onChange,
}: {
  mode: "list" | "map";
  onChange: (m: "list" | "map") => void;
}) {
  return (
    <div className="surface flex shrink-0 items-center gap-0.5 p-1">
      {(["list", "map"] as const).map((m) => {
        const on = mode === m;
        return (
          <button
            key={m}
            type="button"
            onClick={() => {
              if (!on) haptic.select();
              onChange(m);
            }}
            aria-label={m === "list" ? "Ro'yxat" : "Xarita"}
            aria-pressed={on}
            className="grid h-8 w-9 place-items-center rounded-md transition"
            style={
              on
                ? { background: "var(--brand)", color: "#fff" }
                : { color: "var(--text-subtle)" }
            }
          >
            {m === "list" ? <ListIcon size={16} /> : <MapIcon size={16} />}
          </button>
        );
      })}
    </div>
  );
}
