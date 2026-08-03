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
 *   - pastda TAB (Asosiy, Ishlar, Xabarlar, Profil) — TabBar bilan;
 *   - ustida OVERLAY STEKI (e'lon, e'lon berish, arizalarim, ...).
 * Har overlay bitta tarix yozuvi ochadi, "orqaga" esa bittasini yopadi —
 * shu bir-birga moslik tufayli foydalanuvchi hech qachon ilovadan tasodifan
 * chiqib ketmaydi.
 */

import { useCallback, useEffect, useState } from "react";
import { TabBar, type Tab } from "@/components/TabBar";
import { AppHeader, ScreenHeader } from "@/components/AppHeader";
import { ErrorState, Spinner } from "@/components/ui";
import { Feed } from "@/screens/Feed";
import { Candidates } from "@/screens/Candidates";
import { Filters } from "@/screens/Filters";
import { HelpCenter } from "@/screens/HelpCenter";
import { Legal } from "@/screens/Legal";
import { Settings } from "@/screens/Settings";
import { History } from "@/screens/History";
import { JobDetail } from "@/screens/JobDetail";
import { Jobs } from "@/screens/Jobs";
import { MyApplications } from "@/screens/MyApplications";
import { MyElons } from "@/screens/MyElons";
import { Notifications } from "@/screens/Notifications";
import { PostJob } from "@/screens/PostJob";
import { Profile } from "@/screens/Profile";
import { ProfileEdit } from "@/screens/ProfileEdit";
import { Register } from "@/screens/Register";
import {
  fetchMe,
  fetchNotifications,
  getAccess,
  loginWithInitData,
  EMPTY_FILTERS,
  type APIError,
  type FeedFilters,
  type User,
} from "@/lib/api";
import { isTelegram, showBackButton } from "@/lib/telegram";

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
  | { kind: "applications" }
  | { kind: "candidates" }
  | { kind: "filters" }
  | { kind: "settings" }
  | { kind: "help" }
  | { kind: "privacy" }
  | { kind: "terms" }
  | { kind: "myElons" }
  | { kind: "history" };

const OVERLAY_TITLE: Record<Overlay["kind"], string> = {
  job: "Ish tafsilotlari",
  post: "Yangi e'lon",
  edit: "Profilni tahrirlash",
  applications: "Arizalarim",
  candidates: "Nomzodlar",
  filters: "Filtrlar",
  settings: "Sozlamalar",
  help: "Yordam markazi",
  privacy: "Maxfiylik siyosati",
  terms: "Foydalanish shartlari",
  myElons: "E'lonlarim",
  history: "Ish tarixi",
};

export default function App() {
  const [gate, setGate] = useState<Gate>({ state: "loading" });
  const [tab, setTab] = useState<Tab>("home");
  const [stack, setStack] = useState<Overlay[]>([]);

  // Ro'yxatlarni tashqaridan yangilashga majburlovchi hisoblagichlar.
  const [appsVersion, setAppsVersion] = useState(0);
  const [elonsVersion, setElonsVersion] = useState(0);
  const [notifVersion, setNotifVersion] = useState(0);

  const [unread, setUnread] = useState(0);
  // Filtrlar "Ishlar" tabida yashaydi, lekin alohida ekranda tanlanadi —
  // shuning uchun holat App'da turadi (ekran yopilganda yo'qolmasin).
  const [filters, setFilters] = useState<FeedFilters>(EMPTY_FILTERS);

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

  // O'qilmagan bildirishnomalar soni — tepadagi qo'ng'iroq va tab belgisi
  // uchun. Xatosi jimgina yutiladi: belgi ko'rinmasligi ilovaning ishlashiga
  // to'sqinlik qilmaydi.
  useEffect(() => {
    if (gate.state !== "ready") return;
    fetchNotifications()
      .then((list) => setUnread((list || []).filter((n) => !n.isRead).length))
      .catch(() => {});
  }, [gate.state, notifVersion]);

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
  const openPost = useCallback(() => push({ kind: "post" }), [push]);

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
        <>
          <ScreenHeader title={OVERLAY_TITLE[top.kind]} />
          <Overlays
            top={top}
            me={me}
            onOpenJob={openJob}
            onApplied={() => setAppsVersion((n) => n + 1)}
            onCreated={() => {
              setElonsVersion((n) => n + 1);
              close();
            }}
            onSaved={(u) => {
              setGate({ state: "ready", me: u });
              close();
            }}
            onPost={openPost}
            filters={filters}
            onFilters={(f) => {
              setFilters(f);
              close();
            }}
            onTerms={() => push({ kind: "terms" })}
            onPrivacy={() => push({ kind: "privacy" })}
            onHelp={() => push({ kind: "help" })}
            appsVersion={appsVersion}
            elonsVersion={elonsVersion}
          />
        </>
      ) : (
        <>
          {/* Maketda "Bildirishnomalar" markazda ko'k sarlavha bilan
              turadi (logo emas). "Orqaga" strelkasi esa qo'yilmadi: bu tab,
              ya'ni qaytadigan joy yo'q — strelka yolg'on va'da bo'lardi. */}
          {tab === "notifications" ? (
            <ScreenHeader title="Bildirishnomalar" />
          ) : (
            <AppHeader unread={unread} onBell={() => changeTab("notifications")} />
          )}

          {tab === "home" && (
            <Feed
              me={me}
              onOpenJob={openJob}
              onPost={openPost}
              onShowAll={() => changeTab("jobs")}
            />
          )}

          {tab === "jobs" && (
            <Jobs
              onOpenJob={openJob}
              filters={filters}
              onOpenFilters={() => push({ kind: "filters" })}
            />
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
              onApplications={() => push({ kind: "applications" })}
              onCandidates={() => push({ kind: "candidates" })}
              onMyElons={() => push({ kind: "myElons" })}
              onHistory={() => push({ kind: "history" })}
              onSettings={() => push({ kind: "settings" })}
            />
          )}
        </>
      )}

      {/* Overlay ochiq bo'lganda tab bar yashiriladi: pastda Telegram'ning
          MainButton'i turadi va ikkalasi bir joyga to'g'ri kelib qolardi. */}
      {!top && (
        <TabBar active={tab} onChange={changeTab} onPost={openPost} unread={unread} />
      )}
    </Screen>
  );
}

/** Overlay steki ustidagi ekranni tanlaydi. */
function Overlays({
  top,
  me,
  onOpenJob,
  onApplied,
  onCreated,
  onSaved,
  onPost,
  filters,
  onFilters,
  onTerms,
  onPrivacy,
  onHelp,
  appsVersion,
  elonsVersion,
}: {
  top: Overlay;
  me: User;
  onOpenJob: (id: string) => void;
  onApplied: () => void;
  onCreated: () => void;
  onSaved: (u: User) => void;
  onPost: () => void;
  filters: FeedFilters;
  onFilters: (f: FeedFilters) => void;
  onTerms: () => void;
  onPrivacy: () => void;
  onHelp: () => void;
  appsVersion: number;
  elonsVersion: number;
}) {
  switch (top.kind) {
    case "job":
      return <JobDetail id={top.id} onApplied={onApplied} />;
    case "post":
      return <PostJob myPhone={me.phone} onCreated={onCreated} />;
    case "edit":
      return <ProfileEdit me={me} onSaved={onSaved} />;
    case "applications":
      return <MyApplications onOpenJob={onOpenJob} reloadKey={appsVersion} />;
    case "candidates":
      return <Candidates onOpenJob={onOpenJob} />;
    case "filters":
      return <Filters value={filters} onApply={onFilters} />;
    case "settings":
      return <Settings onTerms={onTerms} onPrivacy={onPrivacy} onHelp={onHelp} />;
    case "help":
      return <HelpCenter />;
    case "privacy":
      return <Legal kind="privacy" />;
    case "terms":
      return <Legal kind="terms" />;
    case "myElons":
      return <MyElons onOpenJob={onOpenJob} onPost={onPost} reloadKey={elonsVersion} />;
    case "history":
      return <History myId={me.id} onOpenJob={onOpenJob} />;
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
