/**
 * Ilova qobig'i: kirish darvozasi + navigatsiya.
 *
 * Router kutubxonasi ataylab ishlatilmagan. Mini App'da manzil qatori yo'q,
 * chuqur havolalar ham kerak emas — ekranlar soni beshta. Buning o'rniga
 * oddiy holat + brauzer tarixi ishlatiladi, chunki tarix Telegram'ning
 * BackButton'i bilan tabiiy bog'lanadi (u ham, Android'ning "orqaga"
 * tugmasi ham history.back() ga tushadi).
 */

import { useCallback, useEffect, useState } from "react";
import { TabBar, type Tab } from "@/components/TabBar";
import { ErrorState, Spinner } from "@/components/ui";
import { Feed } from "@/screens/Feed";
import { JobDetail } from "@/screens/JobDetail";
import { MyApplications } from "@/screens/MyApplications";
import { Profile } from "@/screens/Profile";
import { Register } from "@/screens/Register";
import {
  fetchMe,
  getAccess,
  loginWithInitData,
  type APIError,
  type User,
} from "@/lib/api";
import { isTelegram, showBackButton } from "@/lib/telegram";

type Gate =
  | { state: "loading" }
  | { state: "register" }
  | { state: "ready"; me: User }
  | { state: "error"; error: APIError };

const TAB_TITLE: Record<Tab, string> = {
  feed: "Ishlar",
  applications: "Arizalarim",
  profile: "Profil",
};

export default function App() {
  const [gate, setGate] = useState<Gate>({ state: "loading" });
  const [tab, setTab] = useState<Tab>("feed");
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  // Ariza yuborilgach "Arizalarim" ro'yxatini qayta yuklashga majburlaydi.
  const [appsVersion, setAppsVersion] = useState(0);

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

  // ── Navigatsiya ───────────────────────────────────────────────────

  const openJob = useCallback((id: string) => {
    setOpenJobId(id);
    // Tarixga yozamiz — shunda BackButton ham, Android'ning tizim "orqaga"
    // tugmasi ham ro'yxatga qaytaradi (ilovadan chiqib ketmaydi).
    history.pushState({ job: id }, "");
  }, []);

  const closeJob = useCallback(() => {
    // history.back() popstate'ni chaqiradi, u esa openJobId ni tozalaydi —
    // holatni bu yerda qo'lda o'zgartirsak tarix bilan rasstrojka bo'lardi.
    history.back();
  }, []);

  useEffect(() => {
    const onPop = () => setOpenJobId(null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Telegram'ning "orqaga" tugmasi faqat e'lon ochilganda ko'rinadi.
  useEffect(() => {
    if (!openJobId) return;
    return showBackButton(closeJob);
  }, [openJobId, closeJob]);

  // Tab almashganda ochiq e'lon yopilsin.
  const changeTab = useCallback(
    (t: Tab) => {
      if (openJobId) history.back();
      setTab(t);
    },
    [openJobId],
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
      {openJobId ? (
        <JobDetail
          id={openJobId}
          onApplied={() => setAppsVersion((n) => n + 1)}
        />
      ) : (
        <>
          <Header title={TAB_TITLE[tab]} />
          {tab === "feed" && <Feed onOpenJob={openJob} />}
          {tab === "applications" && (
            <MyApplications onOpenJob={openJob} reloadKey={appsVersion} />
          )}
          {tab === "profile" && <Profile me={me} />}
        </>
      )}

      {/* E'lon ochiq bo'lganda tab bar yashiriladi: pastda Telegram'ning
          MainButton'i turadi va ikkalasi bir joyga to'g'ri kelib qolardi. */}
      {!openJobId && <TabBar active={tab} onChange={changeTab} />}
    </Screen>
  );
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

function Header({ title }: { title: string }) {
  return (
    <header className="px-4 pt-5">
      <h1 className="text-[26px] font-black leading-tight tracking-[-0.5px] heading">
        {title}
      </h1>
    </header>
  );
}
