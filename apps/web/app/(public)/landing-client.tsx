"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MapPin, Send, ArrowRight, Search, Check, Plus, Minus, Tag,
  Phone, Mail, Instagram, Youtube, LifeBuoy, Users, Wallet,
  Star, ShieldCheck, Languages, Clock, AlertTriangle, RefreshCw,
  Smartphone, Bell, Signal, Wifi, BatteryFull, Briefcase, Home,
  ClipboardList, UserRound, Navigation,
} from "lucide-react";
import { AUTH_BOT, CONTACT, SOCIAL } from "@/lib/contact";
import { GooglePlayBadge, PlayGlyph } from "@/components/GooglePlayBadge";
import { api, Category, Elon, User, getAccess } from "@/lib/api";
import { Logo } from "@/components/Logo";
import { CategoryIcon } from "@/components/CategoryIcon";
import { LangMenu } from "@/components/LangMenu";
import { ThemeToggle } from "@/components/ThemeToggle";
import { T, useT } from "@/components/T";
import { fmtSum } from "@/lib/format";
import { catTone } from "@/lib/cat-color";

/** Ilovaning O'Z palitrasi — sayt mavzusiga BOG'LIQ EMAS.
 *
 * Flutter ilovasi faqat yorug' mavzuda ishlaydi (flutter-app/lib/app.dart:
 * `theme: AppTheme.light`, `darkTheme` umuman yo'q). Shu sababli telefon maketi
 * sayt qorong'i rejimga o'tganda ham yorug' qoladi: aks holda maket ilovada
 * mavjud BO'LMAGAN ekranni ko'rsatgan bo'lardi. Qiymatlar app_colors.dart va
 * globals.css dagi yorug' mavzu bilan bir xil.
 *
 * Ilovaga qorong'i mavzu qo'shilsa, bu yerni ham yangilash kerak.
 */
const APP_UI = {
  screen: "#FFFFFF",
  surface: "#F8F9FF",
  border: "rgba(195,198,215,0.30)",
  borderStrong: "rgba(195,198,215,0.60)",
  brand: "#0038D8",
  brandSoft: "#E5EEFF",
  ink: "#0B1C30",
  muted: "#434655",
  subtle: "#737686",
} as const;

/** Figma "00 · Landing sahifa". */
export default function Landing() {
  const t = useT();
  const router = useRouter();
  const [examples, setExamples] = useState<Elon[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [checking, setChecking] = useState(true);
  const [serviceError, setServiceError] = useState("");
  // getAccess() localStorage'ni o'qiydi — server (token yo'q) va client (token
  // bor) renderlarini farqlantiradi. Birinchi render server bilan mos bo'lishi
  // uchun auth'ga bog'liq shohobchalarni faqat mount'dan keyin ko'rsatamiz.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Tizimga kirgan foydalanuvchiga landing ko'rsatilmaydi — to'g'ridan-to'g'ri
  // kabinetga (yoki ro'yxatdan o'tish tugamagan bo'lsa onboardingga) yo'naltiramiz.
  useEffect(() => {
    if (!getAccess()) { setChecking(false); return; }
    api.get<User>("/api/me")
      .then((u) => router.replace(u.onboardingCompleted ? "/dashboard" : "/onboarding"))
      .catch((error) => {
        setServiceError(userErrorMessage(error));
        setChecking(false);
      });
  }, [router]);

  useEffect(() => {
    api.get<{ items: Elon[] }>("/api/elons?limit=3", { auth: "none" } as any)
      .then((r) => setExamples(r.items || []))
      .catch((error) => setServiceError(userErrorMessage(error)));
    api.get<Category[]>("/api/categories", { auth: "none" } as any)
      .then((r) => setCats(r || []))
      .catch((error) => setServiceError(userErrorMessage(error)));
  }, []);

  const ctaHref = mounted && getAccess() ? "/dashboard" : "/login";

  if (mounted && checking && getAccess()) {
    return <div className="min-h-screen grid place-items-center muted text-sm"><T>Yuklanmoqda…</T></div>;
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Nav — Figma "Landing Nav": h 80 ───────────────────────── */}
      <header
        className="sticky top-0 z-40 border-b backdrop-blur-md"
        style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--card) 92%, transparent)" }}
      >
        <div className="mx-auto max-w-shell flex h-[72px] md:h-20 items-center gap-8 px-5 md:px-[100px]">
          <Logo />
          <nav className="hidden lg:flex items-center gap-6 xl:gap-10 text-sm font-semibold muted">
            <a href="#qanday" className="hover:text-[color:var(--brand)] transition"><T>Qanday ishlaydi</T></a>
            <a href="#imkoniyatlar" className="hover:text-[color:var(--brand)] transition"><T>Imkoniyatlar</T></a>
            <a href="#kategoriyalar" className="hover:text-[color:var(--brand)] transition"><T>Kategoriyalar</T></a>
            <a href="#narxlar" className="hover:text-[color:var(--brand)] transition"><T>Narxlar</T></a>
            <a href="#ilova" className="hover:text-[color:var(--brand)] transition"><T>Ilova</T></a>
            <a href="#savollar" className="hover:text-[color:var(--brand)] transition"><T>Savollar</T></a>
          </nav>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <LangMenu />
            <ThemeToggle />
            <Link href={ctaHref} className="btn btn-primary"><T>Bepul boshlash</T></Link>
          </div>
        </div>
      </header>

      {serviceError && (
        <div
          role="alert"
          className="border-b px-5 md:px-[100px] py-3"
          style={{
            borderColor: "var(--danger-border, #fecaca)",
            background: "var(--danger-bg, #fef2f2)",
          }}
        >
          <div className="mx-auto max-w-shell flex items-center gap-3 text-[13px]">
            <AlertTriangle size={18} className="text-danger shrink-0" />
            <span className="flex-1 heading">{serviceError}</span>
            <button
              type="button"
              className="btn btn-outline !py-2 !px-3 gap-1.5 shrink-0"
              onClick={() => window.location.reload()}
            >
              <RefreshCw size={14} />
              <T>Qayta urinish</T>
            </button>
          </div>
        </div>
      )}

      <main className="flex-1">
        {/* ── HERO ────────────────────────────────────────────────── */}
        <section className="px-5 md:px-[100px] py-14 md:py-20" style={{ background: "var(--bg-subtle)" }}>
          <div className="mx-auto max-w-shell grid lg:grid-cols-[1fr_460px] gap-10 lg:gap-14 items-center">
            <div className="min-w-0">
              <span className="inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-[12.5px] font-bold"
                    style={{ background: "var(--brand-soft)", color: "var(--brand)" }}>
                <Tag size={13} /><T>E'lon berish va ariza yuborish — butunlay bepul</T>
              </span>
              <h1 className="mt-5 text-[34px] sm:text-[42px] lg:text-[50px] font-black heading leading-[1.2] tracking-[-1.6px]">
                <T>Kunlik ish topish</T><br />
                <T>va ishchi yollash —</T><br />
                <T>bir necha daqiqada.</T>
              </h1>
              <p className="mt-5 text-[17px] muted leading-[27px] max-w-[640px]">
                <T>Ishchi Bormi — O'zbekistondagi kunlik ishlar uchun platforma. Yaqin atrofdagi e'lonlarni ko'ring, bir bosishda ariza yuboring. Ishchi kerak bo'lsa — xuddi shu hisobdan e'lon bering.</T>
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Link
                  href={ctaHref}
                  className="btn btn-primary !rounded-xl !px-7 !py-4 !text-[15.5px] gap-2"
                  style={{ boxShadow: "0 8px 20px rgba(0,56,217,0.3)" }}
                >
                  <Send size={16} /><T>Telegram orqali boshlash</T>
                </Link>
                <Link href={ctaHref} className="btn !rounded-xl !px-7 !py-4 !text-[15.5px] border"
                      style={{ background: "var(--card)", borderColor: "var(--border-strong)", color: "var(--text)" }}>
                  <T>Ish e'lonlarini ko'rish</T>
                </Link>
              </div>

              {/* Ilova haqida birinchi ekrandayoq xabar beramiz, lekin asosiy
                  CTA bilan raqobatlashmasin — shuning uchun tugma emas,
                  sokin havola. To'liq blok pastda ("#ilova"). */}
              <a
                href="#ilova"
                className="mt-4 inline-flex items-center gap-2 text-[13.5px] font-semibold transition hover:opacity-80"
                style={{ color: "var(--brand)" }}
              >
                <PlayGlyph className="h-4 w-4 shrink-0" />
                <T>Android ilovasi Google Play'da — bepul</T>
                <ArrowRight size={14} />
              </a>
              <div className="mt-5 flex items-center gap-2.5 flex-wrap">
                <div className="flex items-center">
                  {["A", "M", "S", "D", "+"].map((l, i) => (
                    <span
                      key={l}
                      className="grid h-[30px] w-[30px] place-items-center rounded-full border-2 text-[11px] font-bold"
                      style={{
                        background: "var(--brand-100)", color: "var(--brand)",
                        borderColor: "var(--bg-subtle)", marginLeft: i === 0 ? 0 : -9,
                      }}
                    >
                      {l}
                    </span>
                  ))}
                </div>
                <span className="text-[13px] font-semibold muted">
                  <T>Minglab ishchi va ish beruvchi allaqachon ishlatmoqda</T>
                </span>
              </div>
            </div>

            {/* O'ng panel — jonli e'lonlar */}
            <div className="card !rounded-[22px] p-6 flex flex-col gap-3.5" style={{ boxShadow: "0 8px 28px rgba(10,28,48,0.07)" }}>
              <div className="surface flex items-center gap-2 pl-3.5 pr-1.5 py-1.5 !rounded-[11px]">
                <Search size={14} className="subtle shrink-0" />
                <span className="text-[13.5px] font-semibold heading truncate"><T>Yaqin atrofdagi ishlar</T></span>
                <span className="flex-1" />
                <Link href={ctaHref} className="btn btn-primary !px-4 !py-2 !text-[12.5px] !rounded-[9px]"><T>Qidirish</T></Link>
              </div>
              {(examples.length > 0 ? examples : SAMPLES).slice(0, 3).map((e: any, i: number) => (
                <Link
                  key={e.id || i}
                  href={e.id ? `/elon/${e.id}` : ctaHref}
                  className="surface p-3.5 !rounded-[13px] flex flex-col gap-2 transition hover:shadow-card"
                >
                  <span className="tag-cat self-start"
                        style={{ background: catTone(e.categoryName || e.category).bg, color: catTone(e.categoryName || e.category).fg }}>
                    <T>{e.categoryName || e.category}</T>
                  </span>
                  <div className="text-[14.5px] font-bold heading leading-[19px] line-clamp-2"><T>{e.title}</T></div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[11.5px] subtle truncate">
                      <MapPin size={13} className="shrink-0" />
                      {e.locationText || [e.region, e.district].filter(Boolean).join(", ") || e.location}
                    </span>
                    <span className="flex-1" />
                    <span className="text-[14px] font-bold shrink-0" style={{ color: "var(--brand)" }}>
                      {e.id
                        ? (e.pricingType === "negotiable" ? t("Kelishiladi") : `${fmtSum(e.perWorkerAmount || e.priceAmount)} so'm`)
                        : `${fmtSum(e.price)} so'm`}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* ── Statistika bandi ────────────────────────────────────── */}
        <section className="gradient-hero text-white px-5 md:px-[100px] py-9">
          <div className="mx-auto max-w-shell grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6">
            {[
              ["24 soat", "O'rtacha javob vaqti"],
              ["0 so'm", "Ilovadan foydalanish haqi"],
              ["3 daqiqa", "Ro'yxatdan o'tish"],
              ["1 hisob", "Ishchi va ish beruvchi uchun"],
              ["2 yozuv", "Lotin va kirill"],
            ].map(([v, l]) => (
              <div key={l}>
                <div className="text-[26px] font-black tracking-[-0.6px]"><T>{v}</T></div>
                <div className="mt-1 text-[13px] text-white/75"><T>{l}</T></div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Qanday ishlaydi ─────────────────────────────────────── */}
        <section id="qanday" className="px-5 md:px-[100px] py-16 md:py-24" style={{ background: "var(--card)" }}>
          <div className="mx-auto max-w-shell">
            <Head eyebrow="Qanday ishlaydi" title="Uch qadamda ish yoki ishchi"
                  subtitle="Ro'yxatdan o'tishdan ishni boshlashgacha — o'rtacha 10 daqiqa." />
            <div className="mt-10 grid md:grid-cols-2 gap-5">
              <StepsCard
                title="Ish qidiryapsizmi?"
                tone="blue"
                steps={[
                  ["Telegram bot orqali ro'yxatdan o'ting", "30 soniya — faqat ism va telefon raqam."],
                  ["Yaqin atrofdagi e'lonlarni ko'ring", "Hududingizdagi ishlar birinchi chiqadi."],
                  ["Bir bosishda ariza yuboring", "Ish beruvchi qabul qilsa, xabar va aniq manzil keladi."],
                ]}
              />
              <StepsCard
                title="Ishchi kerakmi?"
                tone="amber"
                steps={[
                  ["Xuddi shu hisobdan e'lon bering", "Alohida ro'yxatdan o'tish shart emas."],
                  ["Arizalarni ko'rib chiqing", "Nomzodning profili va bajargan ishlari ko'rinadi."],
                  ["Mos ishchini tanlang", "Qabul qilgach, telefon raqami ochiladi."],
                ]}
              />
            </div>
          </div>
        </section>

        {/* ── Imkoniyatlar ────────────────────────────────────────── */}
        <section id="imkoniyatlar" className="px-5 md:px-[100px] py-16 md:py-24" style={{ background: "var(--bg-subtle)" }}>
          <div className="mx-auto max-w-shell">
            <Head eyebrow="Imkoniyatlar" title="Nima uchun Ishchi Bormi"
                  subtitle="Kunlik ish bozorining eng katta muammolarini hal qilish uchun qurilgan." />
            <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              <Feature icon={<MapPin size={18} />} tone="blue" title="Joylashuvga qarab saralash"
                       body="E'lonlar hududingiz bo'yicha filtrlanadi — shaharning narigi chekkasiga bekorga bormaysiz." />
              <Feature icon={<Users size={18} />} tone="amber" title="Bitta hisob, ikki yo'nalish"
                       body="Bugun ishchi, ertaga ish beruvchi. Rejim almashtirish yo'q — hammasi bir profilda." />
              <Feature icon={<Wallet size={18} />} tone="green" title="To'liq bepul"
                       body="E'lon berish, ariza yuborish, bog'lanish — hech qanday komissiya yoki obuna yo'q." />
              <Feature icon={<Star size={18} />} tone="pink" title="Ishlar tarixi"
                       body="Bajarilgan har bir ish profilingizda qoladi — ishonchli odamlar ko'rinib turadi." />
              <Feature icon={<ShieldCheck size={18} />} tone="blue" title="Tasdiqlangan profillar"
                       body="Telefon va Telegram tasdig'i — kim bilan ishlayotganingizni bilasiz." />
              <Feature icon={<Languages size={18} />} tone="amber" title="Lotin va kirill"
                       body="Interfeys va bildirishnomalar siz qulay yozuvda ko'rinadi." />
            </div>
          </div>
        </section>

        {/* ── Kategoriyalar ───────────────────────────────────────── */}
        <section id="kategoriyalar" className="px-5 md:px-[100px] py-16 md:py-24" style={{ background: "var(--card)" }}>
          <div className="mx-auto max-w-shell">
            <Head eyebrow="Kategoriyalar" title="Qanday ishlar bor"
                  subtitle="Kunlik va bir martalik ishlarning barcha yo'nalishlari." />
            <div className="mt-10 grid grid-cols-2 lg:grid-cols-4 gap-5">
              {(cats.length > 0 ? cats.slice(0, 8) : FALLBACK_CATS).map((c: any, i: number) => (
                <Link key={c.id || i} href={ctaHref}
                      className="card p-5 flex flex-col gap-2 transition hover:-translate-y-0.5 hover:shadow-pop">
                  <span className="grid h-10 w-10 place-items-center rounded-xl text-lg"
                        style={{ background: "var(--brand-soft)" }}>
                    <CategoryIcon icon={c.icon} name={c.name} className="h-5 w-5" />
                  </span>
                  <div className="text-[15px] font-bold heading mt-1"><T>{c.name}</T></div>
                  {typeof c.activeCount === "number" && (
                    <div className="text-[12px] subtle">{c.activeCount} <T>ta e'lon</T></div>
                  )}
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* ── Narxlar ─────────────────────────────────────────────── */}
        <section id="narxlar" className="gradient-hero text-white px-5 md:px-[100px] py-16 md:py-24">
          <div className="mx-auto max-w-shell">
            <div className="text-center">
              <span className="inline-block rounded-full bg-white/15 px-3.5 py-1.5 text-[11.5px] font-bold tracking-[1px] uppercase">
                <T>Narxlar</T>
              </span>
              <h2 className="mt-4 text-[28px] sm:text-[34px] font-black tracking-[-0.8px]">
                <T>Hammasi bepul. Yashirin to'lov yo'q.</T>
              </h2>
              <p className="mt-3 text-[15px] text-white/80 max-w-2xl mx-auto leading-relaxed">
                <T>Ishchi Bormi ish beruvchi va ishchi o'rtasidagi pul o'tkazmalarida ishtirok etmaydi — ish haqi to'g'ridan-to'g'ri kelishiladi.</T>
              </p>
            </div>
            <div className="mt-10 grid md:grid-cols-2 gap-5">
              <PriceCard
                title="Ishchilar uchun"
                cta="Ish qidirishni boshlash"
                href={ctaHref}
                items={["Cheksiz ariza yuborish", "Barcha e'lonlarni ko'rish", "Ish beruvchi bilan bevosita bog'lanish", "Ishlar tarixi va profil", "Bildirishnomalar"]}
              />
              <PriceCard
                title="Ish beruvchilar uchun"
                cta="Birinchi e'lonni berish"
                href={ctaHref}
                items={["Cheksiz e'lon joylash", "Barcha arizalarni ko'rish", "Nomzod profilini tekshirish", "Ishchi bilan bevosita bog'lanish", "E'lon holati va statistikasi"]}
              />
            </div>
          </div>
        </section>

        {/* ── Sharhlar ────────────────────────────────────────────── */}
        <section className="px-5 md:px-[100px] py-16 md:py-24" style={{ background: "var(--bg-subtle)" }}>
          <div className="mx-auto max-w-shell">
            <Head eyebrow="Sharhlar" title="Foydalanuvchilar nima deydi" />
            <div className="mt-10 grid md:grid-cols-3 gap-5">
              <Quote
                text="Ilgari ish qidirish uchun bozorga borib turardim. Endi telefonimdan yaqin atrofdagi ishlarni ko'raman va o'sha kuni ishga chiqaman."
                name="Mahmud Sobirov" role="Ishchi · Toshkent" />
              <Quote
                text="Ofisimizga har hafta tozalovchi kerak edi. E'lon berdim — bir soatga qolmay bir nechta ariza keldi."
                name="Nodira Yusupova" role="Ish beruvchi · Toshkent" />
              <Quote
                text="Qurilishda ishlayman, ba'zan o'zimga yordamchi kerak bo'ladi. Bitta hisobdan ikkalasini ham qilaman — juda qulay."
                name="Sardor Karimov" role="Ishchi va ish beruvchi" />
            </div>
          </div>
        </section>

        {/* ── Android ilova ───────────────────────────────────────────
             Sharhlardan KEYIN: odam avval "bu nima va ishonsa bo'ladimi"
             degan savolga javob oladi, keyin ilovani yuklaydi.
             Gradient band ATAYLAB — yon qo'shnilari (Sharhlar / Telegram)
             och fonli, shuning uchun bu blok sahifada aniq ajralib turadi va
             ilova borligi e'tibordan qochmaydi. */}
        <section id="ilova" className="gradient-hero text-white px-5 md:px-[100px] py-16 md:py-24">
          <div className="mx-auto max-w-shell grid lg:grid-cols-[minmax(0,1fr)_300px] gap-10 lg:gap-14 items-center">
            <div className="min-w-0">
              <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3.5 py-1.5 text-[11.5px] font-bold uppercase tracking-[1px]">
                <Smartphone size={13} /><T>Android ilova</T>
              </span>
              <h2 className="mt-4 text-[28px] sm:text-[34px] font-black tracking-[-0.8px] leading-tight">
                <T>Ishlar doim cho'ntagingizda</T>
              </h2>
              <p className="mt-3 text-[15px] text-white/80 leading-relaxed max-w-2xl">
                <T>Ishchi Bormi ilovasini Google Play'dan bepul yuklab oling. Yangi e'lon chiqishi bilan telefoningizga bildirishnoma keladi — saytni ochib turishingiz shart emas.</T>
              </p>

              <ul className="mt-6 grid sm:grid-cols-2 gap-x-10 gap-y-3 max-w-2xl">
                {[
                  "Yangi ish chiqsa — darhol bildirishnoma",
                  "Ishlarni xaritada ko'rib, eng yaqinini tanlang",
                  "Arizangiz holatini kuzatib boring",
                  "Bepul, reklamasiz",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-[14px] text-white/85">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/20">
                      <Check size={12} />
                    </span>
                    <T>{item}</T>
                  </li>
                ))}
              </ul>

              <div className="mt-8">
                <GooglePlayBadge variant="onBrand" />
              </div>
            </div>

            {/* Telefon maketi — ilovaning HAQIQIY bosh ekrani.
                Xayoliy ekran emas: salomlashish, qidiruv, ko'k "E'lon berish"
                banneri, kategoriya kafellari, ish kartochkasi va markazida "+"
                bo'lgan pastki panel — hammasi ilovadagi joylashuvda. Odam
                do'konga o'tishdan oldin nimani yuklayotganini ko'rib turadi.

                Ranglar sayt o'zgaruvchilaridan emas, [APP_UI] dan: ilova faqat
                yorug' mavzuda ishlaydi. */}
            <div className="justify-self-center lg:justify-self-end w-[280px] shrink-0" aria-hidden="true">
              <div className="rounded-[36px] bg-[#0B0F1A] p-[7px] shadow-pop ring-1 ring-white/20">
                <div className="overflow-hidden rounded-[30px]" style={{ background: APP_UI.screen }}>

                  {/* Holat qatori — soat, kamera teshigi, tarmoq belgilari */}
                  <div className="relative flex items-center justify-between px-4 pt-2.5 pb-1"
                       style={{ color: APP_UI.ink }}>
                    <span className="text-[10px] font-bold">09:41</span>
                    <span className="absolute left-1/2 top-2 h-[9px] w-[9px] -translate-x-1/2 rounded-full bg-[#0B0F1A]" />
                    <span className="flex items-center gap-1">
                      <Signal size={9} strokeWidth={3} />
                      <Wifi size={9} strokeWidth={3} />
                      <BatteryFull size={13} strokeWidth={2} />
                    </span>
                  </div>

                  {/* Ilova paneli */}
                  <div className="flex items-center justify-between px-4 pt-1.5 pb-2">
                    <span className="text-[13px] font-black tracking-[-0.3px]" style={{ color: APP_UI.brand }}>
                      Ishchi Bormi
                    </span>
                    <Bell size={13} strokeWidth={2.5} style={{ color: APP_UI.brand }} />
                  </div>

                  {/* Salomlashish */}
                  <div className="px-4">
                    <div className="text-[13px] font-black tracking-[-0.3px]" style={{ color: APP_UI.ink }}>
                      <T>Assalomu alaykum!</T>
                    </div>
                    <div className="text-[10.5px]" style={{ color: APP_UI.muted }}>
                      <T>Bugun qanday ishlar bor?</T>
                    </div>
                  </div>

                  {/* Qidiruv maydoni */}
                  <div className="mx-4 mt-2.5 flex items-center gap-2 rounded-xl px-3 py-2"
                       style={{ background: APP_UI.surface, border: `1px solid ${APP_UI.borderStrong}` }}>
                    <Search size={11} className="shrink-0" style={{ color: APP_UI.subtle }} />
                    <span className="text-[10.5px]" style={{ color: APP_UI.subtle }}><T>Ish qidirish…</T></span>
                  </div>

                  {/* Ko'k banner — ish beruvchiga chaqiriq */}
                  <div className="relative mx-4 mt-2.5 overflow-hidden rounded-xl px-3.5 py-3"
                       style={{ background: APP_UI.brand }}>
                    <Briefcase
                      size={70}
                      strokeWidth={1.5}
                      className="pointer-events-none absolute -right-3 -bottom-3 text-white/10"
                    />
                    <div className="relative text-[12px] font-black leading-tight text-white">
                      <T>Yangi vazifangiz bormi?</T>
                    </div>
                    <div className="relative mt-1 text-[9.5px] text-white/80"><T>Tez va oson ishchi toping.</T></div>
                    <div className="relative mt-2 inline-block rounded-lg bg-white px-2.5 py-1 text-[9.5px] font-bold"
                         style={{ color: APP_UI.brand }}>
                      <T>E'lon berish</T>
                    </div>
                  </div>

                  {/* Kategoriyalar */}
                  <div className="mt-3 flex items-center justify-between px-4">
                    <span className="text-[11.5px] font-black" style={{ color: APP_UI.ink }}>
                      <T>Kategoriyalar</T>
                    </span>
                    <span className="text-[9.5px] font-bold" style={{ color: APP_UI.brand }}><T>Barchasi</T></span>
                  </div>
                  <div className="mt-1.5 flex gap-2 px-4">
                    {[
                      { e: "\u{1F69A}", l: "Yuk tashish" },
                      { e: "\u{1F527}", l: "Maxsus" },
                      { e: "\u{1F9F9}", l: "Tozalash" },
                    ].map((c) => (
                      <div key={c.l} className="flex-1 text-center">
                        <div className="grid h-11 place-items-center rounded-xl text-[17px]"
                             style={{ background: APP_UI.brandSoft }}>
                          {c.e}
                        </div>
                        <div className="mt-1 text-[8.5px] font-bold leading-tight" style={{ color: APP_UI.ink }}>
                          <T>{c.l}</T>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Yaqin atrofdagi ishlar */}
                  <div className="mt-3 px-4 text-[11.5px] font-black" style={{ color: APP_UI.ink }}>
                    <T>Yaqin atrofdagi ishlar</T>
                  </div>
                  <div className="mx-4 mt-1.5 rounded-xl p-2.5"
                       style={{ background: APP_UI.surface, border: `1px solid ${APP_UI.border}` }}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="rounded px-1.5 py-0.5 text-[7.5px] font-black uppercase tracking-[0.4px]"
                            style={{ background: APP_UI.brandSoft, color: APP_UI.brand }}>
                        <T>Yuk tashish</T>
                      </span>
                      <span className="text-[12px] font-black leading-none" style={{ color: APP_UI.brand }}>
                        200k UZS
                      </span>
                    </div>
                    <div className="mt-1.5 text-[11px] font-bold" style={{ color: APP_UI.ink }}>
                      <T>Yuk tushurish</T>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[8px]" style={{ color: APP_UI.subtle }}>
                      <span className="inline-flex items-center gap-0.5"><MapPin size={8} /><T>Toshkent</T></span>
                      <span className="inline-flex items-center gap-0.5"><Clock size={8} /><T>1 soat oldin</T></span>
                      <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-bold"
                            style={{ background: APP_UI.brandSoft, color: APP_UI.brand }}>
                        <Navigation size={7} />8.1 km
                      </span>
                    </div>
                  </div>

                  {/* Pastki panel — markazda "+" tugmasi */}
                  <div className="mt-3 flex items-end justify-between px-3 pb-2.5 pt-2"
                       style={{ borderTop: `1px solid ${APP_UI.border}` }}>
                    {[
                      { I: Home, l: "Asosiy", on: true },
                      { I: ClipboardList, l: "Ishlar", on: false },
                    ].map(({ I, l, on }) => (
                      <span key={l} className="flex flex-1 flex-col items-center gap-0.5"
                            style={{ color: on ? APP_UI.brand : APP_UI.subtle }}>
                        <I size={13} strokeWidth={on ? 2.6 : 2} />
                        <span className="text-[7.5px] font-bold"><T>{l}</T></span>
                      </span>
                    ))}
                    <span className="flex flex-1 flex-col items-center gap-0.5">
                      <span className="grid h-8 w-8 -mt-4 place-items-center rounded-full text-white shadow-blue"
                            style={{ background: APP_UI.brand }}>
                        <Plus size={16} strokeWidth={3} />
                      </span>
                      <span className="text-[7.5px] font-bold" style={{ color: APP_UI.subtle }}><T>E'lon</T></span>
                    </span>
                    {[
                      { I: Bell, l: "Xabarlar" },
                      { I: UserRound, l: "Profil" },
                    ].map(({ I, l }) => (
                      <span key={l} className="flex flex-1 flex-col items-center gap-0.5"
                            style={{ color: APP_UI.subtle }}>
                        <I size={13} strokeWidth={2} />
                        <span className="text-[7.5px] font-bold"><T>{l}</T></span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Telegram ────────────────────────────────────────────── */}
        <section className="px-5 md:px-[100px] py-16 md:py-24" style={{ background: "var(--card)" }}>
          <div className="mx-auto max-w-shell rounded-[22px] p-7 sm:p-10 grid lg:grid-cols-2 gap-8 items-center"
               style={{ background: "var(--brand-soft)" }}>
            <div>
              <span className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[11.5px] font-bold tracking-[1px] uppercase"
                    style={{ background: "var(--card)", color: "var(--brand)" }}>
                <Send size={12} /><T>Telegram</T>
              </span>
              <h2 className="mt-4 text-[26px] sm:text-[30px] font-black heading tracking-[-0.8px] leading-tight">
                <T>Ilovasiz ham ishlaydi</T>
              </h2>
              <p className="mt-3 text-[15px] muted leading-relaxed">
                <T>Ilovani o'rnatmoqchi bo'lmasangiz, ro'yxatdan o'tish va bildirishnomalar Telegram orqali ham ishlaydi. Internet sekin bo'lsa ham ishlaydi, telefon xotirasini egallamaydi.</T>
              </p>
              <ul className="mt-5 flex flex-col gap-2.5">
                {["Telegram kod bilan 30 soniyada kirish", "Ariza qabul qilinganda bildirishnoma", "Yangi e'lonlar haqida xabar"].map((s) => (
                  <li key={s} className="flex items-center gap-2.5 text-[14px] muted">
                    <span className="grid h-5 w-5 place-items-center rounded-full text-white shrink-0"
                          style={{ background: "var(--brand)" }}>
                      <Check size={12} />
                    </span>
                    <T>{s}</T>
                  </li>
                ))}
              </ul>
              <a href={AUTH_BOT.href} target="_blank" rel="noreferrer" className="btn btn-primary mt-6 gap-2">
                <Send size={15} />{AUTH_BOT.label}
              </a>
            </div>

            {/* Telegram suhbati maketi */}
            <div className="card p-4 sm:p-5 flex flex-col gap-3 max-w-[420px] w-full lg:justify-self-end">
              <div className="flex items-center gap-2.5 pb-3 border-b" style={{ borderColor: "var(--border)" }}>
                <span className="grid h-9 w-9 place-items-center rounded-full text-[12px] font-black text-white"
                      style={{ background: "var(--brand)" }}>IB</span>
                <div>
                  <div className="text-[13.5px] font-bold heading">Ishchi Bormi</div>
                  <div className="text-[11px] subtle">bot</div>
                </div>
              </div>
              <div className="surface p-3 text-[13px] muted !rounded-[13px] self-start max-w-[85%]">
                <T>Assalomu alaykum! Ro'yxatdan o'tish uchun tugmani bosing.</T>
              </div>
              <div className="rounded-[13px] px-3.5 py-2.5 text-[13px] font-bold text-white self-end"
                   style={{ background: "var(--brand)" }}>
                <T>Ro'yxatdan o'tish</T>
              </div>
              <div className="surface p-3 text-[13px] muted !rounded-[13px] self-start max-w-[85%]">
                <T>Sizning kodingiz</T>: <b className="heading">472 913</b>. <T>Saytga kiriting va ishni boshlang.</T>
              </div>
            </div>
          </div>
        </section>

        {/* ── Savollar ────────────────────────────────────────────── */}
        <section id="savollar" className="px-5 md:px-[100px] py-16 md:py-24" style={{ background: "var(--bg-subtle)" }}>
          <div className="mx-auto max-w-shell">
            <Head eyebrow="Savollar" title="Ko'p beriladigan savollar" />
            <div className="mt-10 max-w-[880px] mx-auto flex flex-col gap-3">
              {FAQ.map((f, i) => <Faq key={f.q} q={f.q} a={f.a} defaultOpen={i === 0} />)}
            </div>
          </div>
        </section>

        {/* ── CTA ─────────────────────────────────────────────────── */}
        <section className="gradient-hero text-white px-5 md:px-[100px] py-16 md:py-20">
          <div className="mx-auto max-w-shell text-center">
            <h2 className="text-[28px] sm:text-[36px] font-black tracking-[-1px] leading-tight">
              <T>Bugun ishga chiqing yoki ishchingizni toping.</T>
            </h2>
            <p className="mt-3 text-[15px] text-white/80">
              <T>Ro'yxatdan o'tish 30 soniya. Karta ham, to'lov ham kerak emas.</T>
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Link href={ctaHref} className="btn !rounded-xl !px-7 !py-4 !text-[15px] bg-white gap-2 hover:opacity-90"
                    style={{ color: "var(--brand)" }}>
                <Send size={16} /><T>Telegram orqali boshlash</T>
              </Link>
              <Link href={ctaHref} className="btn !rounded-xl !px-7 !py-4 !text-[15px] border border-white/40 text-white hover:bg-white/10">
                <T>Ish e'lonlarini ko'rish</T><ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer style={{ background: "#0B1C30", color: "rgba(255,255,255,0.72)" }}>
        <div className="mx-auto max-w-shell px-5 md:px-[100px] py-14 grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <div className="text-[21px] font-black tracking-[-0.3px]">
              <span style={{ color: "#4C8BFF" }}>Ishchi</span><span style={{ color: "var(--accent)" }}>Bormi</span>
            </div>
            <p className="mt-3 text-[13.5px] leading-relaxed max-w-xs">
              <T>O'zbekistondagi kunlik ishlar uchun bepul platforma. Ish qidiruvchi va ish beruvchini eng qisqa yo'l bilan bog'laymiz.</T>
            </p>
            <ul className="mt-5 flex flex-col gap-2 text-[13.5px]">
              <li><a href={CONTACT.phoneHref} className="flex items-center gap-2 hover:text-white transition"><Phone size={13} />{CONTACT.phone}</a></li>
              <li><a href={CONTACT.emailHref} className="flex items-center gap-2 hover:text-white transition"><Mail size={13} />{CONTACT.email}</a></li>
            </ul>
            <div className="mt-4 flex items-center gap-2">
              <Social href={SOCIAL.telegram.href} label="Telegram"><Send size={15} /></Social>
              <Social href={SOCIAL.support.href} label="Support"><LifeBuoy size={15} /></Social>
              <Social href={SOCIAL.instagram.href} label="Instagram"><Instagram size={15} /></Social>
              <Social href={SOCIAL.youtube.href} label="YouTube"><Youtube size={15} /></Social>
            </div>
          </div>

          <FooterCol title="Mahsulot" links={[
            ["Ish e'lonlari", ctaHref], ["E'lon berish", ctaHref],
            ["Qanday ishlaydi", "#qanday"], ["Kategoriyalar", "#kategoriyalar"], ["Narxlar", "#narxlar"],
          ]} />
          <FooterCol title="Kompaniya" links={[
            ["Biz haqimizda", "/biz-haqimizda"], ["Yordam markazi", "/yordam"], ["Savol-javob", "#savollar"],
          ]} />
          <FooterCol title="Huquqiy" links={[
            ["Foydalanish shartlari", "/foydalanish-shartlari"],
            ["Maxfiylik siyosati", "/maxfiylik-siyosati"],
            ["Hisobni o'chirish", "/delete-account"],
          ]} />
        </div>
        <div className="border-t border-white/10">
          <div className="mx-auto max-w-shell px-5 md:px-[100px] py-5 text-[12.5px] flex flex-wrap items-center justify-between gap-2">
            <span>© 2026 Ishchi Bormi. <T>Barcha huquqlar himoyalangan.</T></span>
            <span className="inline-flex items-center gap-1.5"><Clock size={12} /><T>24/7 qo'llab-quvvatlash</T></span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function userErrorMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "Ma'lumotlarni yuklab bo'lmadi. Qayta urinib ko'ring.";
}

/* ── helpers ───────────────────────────────────────── */

function Head({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <div className="text-center">
      <span className="inline-block rounded-full px-3.5 py-1.5 text-[11.5px] font-bold tracking-[1px] uppercase"
            style={{ background: "var(--brand-soft)", color: "var(--brand)" }}>
        <T>{eyebrow}</T>
      </span>
      <h2 className="mt-4 text-[28px] sm:text-[34px] font-black heading tracking-[-0.8px] leading-tight"><T>{title}</T></h2>
      {subtitle && <p className="mt-3 text-[15px] muted max-w-2xl mx-auto"><T>{subtitle}</T></p>}
    </div>
  );
}

const TONE: Record<string, { bg: string; fg: string }> = {
  blue:  { bg: "#E5EEFF", fg: "#0038D8" },
  amber: { bg: "#FFEED4", fg: "#8A5300" },
  green: { bg: "#DFF5E5", fg: "#1A7F3C" },
  pink:  { bg: "#FDE8EF", fg: "#BE185D" },
};

function StepsCard({ title, steps, tone }: { title: string; steps: [string, string][]; tone: keyof typeof TONE }) {
  const c = TONE[tone];
  return (
    <div className="card p-7">
      <h3 className="text-[19px] font-bold heading tracking-[-0.3px] mb-5"><T>{title}</T></h3>
      <ol className="flex flex-col gap-5">
        {steps.map(([k, v], i) => (
          <li key={k} className="flex gap-3.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-bold"
                  style={{ background: c.bg, color: c.fg }}>
              {i + 1}
            </span>
            <div>
              <div className="text-[14.5px] font-bold heading"><T>{k}</T></div>
              <div className="text-[13.5px] muted mt-1 leading-relaxed"><T>{v}</T></div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Feature({ icon, title, body, tone }: { icon: React.ReactNode; title: string; body: string; tone: keyof typeof TONE }) {
  const c = TONE[tone];
  return (
    <div className="card p-6 transition hover:-translate-y-0.5 hover:shadow-pop">
      <span className="grid h-10 w-10 place-items-center rounded-xl" style={{ background: c.bg, color: c.fg }}>{icon}</span>
      <h3 className="mt-4 text-[15.5px] font-bold heading"><T>{title}</T></h3>
      <p className="mt-2 text-[13.5px] muted leading-relaxed"><T>{body}</T></p>
    </div>
  );
}

function PriceCard({ title, items, cta, href }: { title: string; items: string[]; cta: string; href: string }) {
  return (
    <div className="rounded-2xl p-7" style={{ background: "var(--card)" }}>
      <h3 className="text-[16px] font-bold heading"><T>{title}</T></h3>
      <div className="mt-3 flex items-end gap-2">
        <span className="text-[38px] font-black leading-none" style={{ color: "var(--brand)" }}><T>0 so'm</T></span>
        <span className="text-[13px] subtle pb-1.5">/ <T>doimiy</T></span>
      </div>
      <ul className="mt-5 flex flex-col gap-2.5">
        {items.map((it) => (
          <li key={it} className="flex items-center gap-2.5 text-[13.5px] muted">
            <span className="grid h-5 w-5 place-items-center rounded-full text-white shrink-0" style={{ background: "var(--brand)" }}>
              <Check size={12} />
            </span>
            <T>{it}</T>
          </li>
        ))}
      </ul>
      <Link href={href} className="btn btn-primary w-full mt-6"><T>{cta}</T></Link>
    </div>
  );
}

function Quote({ text, name, role }: { text: string; name: string; role: string }) {
  return (
    <div className="card p-6 flex flex-col">
      <div className="flex gap-0.5 mb-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Star key={i} size={14} style={{ color: "var(--accent)", fill: "var(--accent)" }} />
        ))}
      </div>
      <p className="text-[13.5px] leading-relaxed muted flex-1">«<T>{text}</T>»</p>
      <div className="mt-5 flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-full text-[13px] font-bold"
              style={{ background: "var(--brand-100)", color: "var(--brand)" }}>
          {name[0]}
        </span>
        <div>
          <div className="text-[13.5px] font-bold heading">{name}</div>
          <div className="text-[11.5px] subtle"><T>{role}</T></div>
        </div>
      </div>
    </div>
  );
}

function Faq({ q, a, defaultOpen }: { q: string; a: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="card overflow-hidden">
      <button onClick={() => setOpen((s) => !s)} className="w-full flex items-center gap-4 p-5 text-left">
        <span className="flex-1 text-[14.5px] font-bold heading"><T>{q}</T></span>
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full"
              style={{ background: "var(--brand-soft)", color: "var(--brand)" }}>
          {open ? <Minus size={13} /> : <Plus size={13} />}
        </span>
      </button>
      {open && <div className="px-5 pb-5 -mt-1 text-[13.5px] muted leading-relaxed animate-fade-in"><T>{a}</T></div>}
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <div className="text-[13px] font-bold text-white mb-3.5"><T>{title}</T></div>
      <ul className="flex flex-col gap-2.5 text-[13.5px]">
        {links.map(([label, href]) => (
          <li key={label}>
            {href.startsWith("#")
              ? <a href={href} className="hover:text-white transition"><T>{label}</T></a>
              : <Link href={href} className="hover:text-white transition"><T>{label}</T></Link>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Social({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" aria-label={label}
       className="grid h-9 w-9 place-items-center rounded-full bg-white/10 hover:bg-white/20 text-white transition">
      {children}
    </a>
  );
}

const FAQ: { q: string; a: string }[] = [
  {
    q: "Platformadan foydalanish rostdan ham bepulmi?",
    a: "Ha. E'lon berish, ariza yuborish va bog'lanish to'liq bepul. Hech qanday komissiya, obuna yoki yashirin to'lov yo'q. Ish haqi ish beruvchi bilan ishchi o'rtasida to'g'ridan-to'g'ri kelishiladi — platforma pul o'tkazmalarida ishtirok etmaydi.",
  },
  {
    q: "Ro'yxatdan o'tish uchun nima kerak?",
    a: "Faqat Telegram hisobi va telefon raqami. Bot sizga kod yuboradi, kodni saytga kiritasiz — hisob tayyor.",
  },
  {
    q: "Bir hisobdan ham ish qidirib, ham e'lon bera olamanmi?",
    a: "Ha. Bitta hisob ikkala yo'nalish uchun ishlaydi: xohlagan vaqtda ariza yuborasiz yoki o'zingiz e'lon joylaysiz.",
  },
  {
    q: "Ish beruvchi ishonchli ekanini qanday bilaman?",
    a: "Har bir profil telefon va Telegram orqali tasdiqlanadi. Profilda bajarilgan ishlar soni va e'lonlar tarixi ko'rinadi.",
  },
  {
    q: "Ariza yuborganimdan keyin qancha vaqtda javob keladi?",
    a: "Bu ish beruvchiga bog'liq. Ariza qabul qilinganda yoki rad etilganda sizga darhol bildirishnoma keladi.",
  },
  {
    q: "Qaysi shaharlarda ishlaydi?",
    a: "O'zbekistonning barcha viloyatlarida. E'lonlarni viloyat va tuman bo'yicha filtrlash mumkin.",
  },
  {
    q: "Ilovani telefonga o'rnatish kerakmi?",
    a: "Yo'q. Sayt brauzerda ishlaydi, bildirishnomalar esa Telegram orqali keladi.",
  },
];

const FALLBACK_CATS = [
  { name: "Tozalash", icon: "🧹" },
  { name: "Yuk tashish", icon: "📦" },
  { name: "Elektrik", icon: "💡" },
  { name: "Qurilish", icon: "🧱" },
  { name: "Yetkazish", icon: "🚚" },
  { name: "Bog'bonlik", icon: "🌿" },
  { name: "Santexnika", icon: "🔧" },
  { name: "Mebel", icon: "🪑" },
];

const SAMPLES = [
  { title: "Kvartira tozalash uchun yordamchi", category: "Tozalash", location: "Chilonzor", price: 200000 },
  { title: "Mebelni 3-qavatga olib chiqish", category: "Yuk tashish", location: "Yunusobod", price: 150000 },
  { title: "Devor bo'yash ishlari", category: "Qurilish", location: "M. Ulug'bek", price: 250000 },
];
