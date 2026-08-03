"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  HelpCircle, Search, ChevronDown, LogIn, ClipboardList, Handshake,
  Star, ShieldAlert, Settings, Sparkles,
  Mail, Phone, Send, MapPin, BookOpen, ArrowRight, LifeBuoy,
  Instagram, Youtube,
} from "lucide-react";
import { CONTACT, SOCIAL } from "@/lib/contact";
import { LangMenu } from "@/components/LangMenu";
import { ThemeToggle } from "@/components/ThemeToggle";
import { T, useT } from "@/components/T";
import { getAccess } from "@/lib/api";
import { Logo } from "@/components/Logo";

type FAQ = { q: string; a: string };

const CATEGORIES: { id: string; label: string; icon: any; questions: FAQ[] }[] = [
  {
    id: "kirish",
    label: "Tizimga kirish",
    icon: LogIn,
    questions: [
      { q: "Tizimga qanday kirishim mumkin?",
        a: "Bosh sahifadagi 'Kirish' tugmasini bosing, so'ng Telegram botimizga o'ting, /start tugmasini bosing va telefon raqamingizni ulashing. Bot sizga 6 xonali kod yuboradi. Shu kodni saytdagi 'Tasdiqlash kodi' maydoniga kiriting." },
      { q: "Telegram bot kod yubormayapti, nima qilishim kerak?",
        a: "Botda /start tugmasini qaytadan bosing va telefon raqamni qayta yuboring. Agar yana ishlamasa, bot bilan suhbatni qaytadan ochib ko'ring yoki ishchibormi@gmail.com ga murojaat qiling." },
      { q: "Kod 'noto'g'ri yoki muddati o'tgan' deyapti.",
        a: "Kod 5 daqiqa amal qiladi. Yangi kod olish uchun botda /start tugmasini qaytadan bosing." },
      { q: "Telefon raqamim bilan kirish mumkinmi?",
        a: "Hozircha tizimga kirish faqat Telegram orqali amalga oshiriladi. Bu xavfsizlikni oshiradi va botning kuchli identifikatsiyasidan foydalanadi." },
    ],
  },
  {
    id: "elonlar",
    label: "E'lonlar",
    icon: ClipboardList,
    questions: [
      { q: "Yangi e'lon qanday yarataman?",
        a: "Yuqoridagi 'E'lon berish' tugmasini bosing. Vazifa nomi, kategoriya, tavsif, ish joyi (xaritadan), ishchilar soni, ish haqi va sana-vaqtni kiriting. Saqlaganingizdan so'ng e'lon darhol e'lonlar ro'yxatida ko'rinadi." },
      { q: "Yangi turkum qo'sha olamanmi?",
        a: "Ha. E'lon yaratish sahifasida 'Yangi turkum nomi' maydoniga yozib, '+ Qo'shish' tugmasini bosing — turkum darhol faollashadi va boshqa foydalanuvchilar uchun ham ko'rinadi." },
      { q: "Narxni 'Kelishiladi' qilib qo'yishim mumkinmi?",
        a: "Albatta. Narx maydonini bo'sh qoldiring — e'lon avtomatik ravishda 'Kelishiladi' deb belgilanadi." },
      { q: "E'lonimni qanday tahrirlash yoki o'chirish mumkin?",
        a: "'Mening e'lonlarim' bo'limiga o'ting. Har bir e'lon yonida qalam (tahrirlash) va savat (o'chirish) ikonkalari bor." },
      { q: "'Ishchi to'ldi' degan badge nima degani?",
        a: "Sizning e'longizga belgilangan miqdordagi ishchi qabul qilingach, e'lon avtomatik ravishda 'filled' (to'ldi) holatiga o'tadi va yangi arizalar qabul qilinmaydi." },
    ],
  },
  {
    id: "ariza",
    label: "Arizalar va ish jarayoni",
    icon: Handshake,
    questions: [
      { q: "Ariza qanday topshiriladi?",
        a: "E'lon sahifasida 'Ariza topshirish' tugmasini bosing. Telefon raqamingizni tasdiqlang. Sizning telefoningiz e'lon egasiga ko'rsatiladi va u siz bilan bog'lana oladi." },
      { q: "Bir vaqtda nechta e'longa ariza topshirish mumkin?",
        a: "Cheklov yo'q. Lekin agar bir nechtasiga qabul qilingan bo'lsangiz, boshqalarini o'zingiz bekor qilishingiz kerak." },
      { q: "'Bajarildi' qanday tasdiqlanadi?",
        a: "Ikkala tomon ham (ishchi va ish beruvchi) 'Bajarildi' tugmasini bosishi kerak. Faqat shundan keyin ariza 'Bajarildi' holatiga o'tadi va sizga reyting qoldirish imkoni paydo bo'ladi." },
      { q: "Arizani bekor qilsam nima bo'ladi?",
        a: "Ariza 'Bekor qilingan' holatiga o'tadi. Agar oldindan qabul qilingan bo'lsa, e'londagi ishchi soni qayta ochiladi. Tez-tez bekor qilish reytingingizga salbiy ta'sir ko'rsatishi mumkin." },
    ],
  },
  {
    id: "reyting",
    label: "Reyting va sharhlar",
    icon: Star,
    questions: [
      { q: "Reyting qanday hisoblanadi?",
        a: "Reyting siz olgan barcha baholarning o'rta arifmetik qiymati (0.1 aniqlikda yaxlitlangan). Har bir bajarilgan ishdan keyin bir baho hisobga olinadi." },
      { q: "Sharh qoldira olamanmi?",
        a: "Ha. Ish 'Bajarildi' holatiga o'tgach, har ikki tomon 1 dan 5 gacha yulduz va matnli sharh qoldirishi mumkin." },
      { q: "Yolg'on sharh qoldirildi, nima qilay?",
        a: "Profil yoki sharh yonidagi 'Shikoyat' tugmasini bosib, sababini yozib yuboring. Adminlar 24 soat ichida ko'rib chiqadi." },
    ],
  },
  {
    id: "shikoyat",
    label: "Shikoyat va xavfsizlik",
    icon: ShieldAlert,
    questions: [
      { q: "Shikoyatni qanday yo'llash mumkin?",
        a: "Har qanday foydalanuvchi, e'lon yoki xabar yonida 'Shikoyat' tugmasi bor. Sabab va izoh yozib yuboring — adminlarimiz ko'rib chiqadi." },
      { q: "Hisobim bloklandi, nima qilay?",
        a: "Bloklash sababini bilish va apellyatsiya qilish uchun ishchibormi@gmail.com ga email yuboring. 3-5 ish kuni ichida javob qaytaramiz." },
      { q: "Telefon raqamim boshqalarga ko'rsatiladimi?",
        a: "Faqat siz ariza topshirgan e'lon egasiga (yoki sizning e'loningizga ariza topshirgan ishchiga) ko'rsatiladi. Boshqa hollarda yashirin saqlanadi." },
    ],
  },
  {
    id: "hisob",
    label: "Hisob va sozlamalar",
    icon: Settings,
    questions: [
      { q: "Ism va familiyamni qanday o'zgartiraman?",
        a: "'Sozlamalar' bo'limiga o'ting. Ism, familiya, viloyat va bio'ni o'zgartirib, 'Saqlash' bosing." },
      { q: "Lotin/Kirill yozuvini qanday almashtiraman?",
        a: "Yuqori panelda 'Lotin / Kirill' tugmasi bor. Yoki sozlamalardan tanlashingiz mumkin — tanlovingiz saqlanadi." },
      { q: "Hisobni butunlay o'chirib tashlamoqchiman.",
        a: "'Sozlamalar' bo'limining eng pastida 'Hisobni o'chirish' tugmasi mavjud. E'lonlaringiz arxivlanadi, shaxsiy ma'lumotlaringiz esa o'chiriladi." },
    ],
  },
];

export default function HelpPage() {
  const t = useT();
  const ctaHref = getAccess() ? "/dashboard" : "/login";
  const [q, setQ] = useState("");
  const [activeCat, setActiveCat] = useState<string>(CATEGORIES[0].id);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    const lc = q.trim().toLowerCase();
    if (!lc) {
      return CATEGORIES.find((c) => c.id === activeCat)?.questions || [];
    }
    return CATEGORIES.flatMap((c) =>
      c.questions
        .filter((qq) =>
          qq.q.toLowerCase().includes(lc) || qq.a.toLowerCase().includes(lc)
        )
        .map((qq) => ({ ...qq, _cat: c.label }))
    );
  }, [q, activeCat]);

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Header ─────────────────── */}
      <header className="border-b" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
        <div className="mx-auto max-w-6xl flex items-center justify-between px-4 py-3">
          <Logo />
          <div className="flex items-center gap-3">
            <LangMenu />
            <ThemeToggle />
            <Link href={ctaHref} className="btn-primary"><T>Kirish</T></Link>
          </div>
        </div>
      </header>

      {/* ── Hero with search ───────── */}
      <section className="px-4 pt-6">
        <div className="mx-auto max-w-6xl card p-8 sm:p-12 text-center">
          <div className="mx-auto h-14 w-14 grid place-items-center rounded-2xl bg-brand-navy text-white">
            <LifeBuoy size={26} />
          </div>
          <h1 className="mt-4 text-2xl sm:text-3xl font-extrabold heading">
            <T>Sizga qanday yordam bera olamiz?</T>
          </h1>
          <p className="mt-2 text-sm muted max-w-2xl mx-auto">
            <T>Quyidagi savollarni ko'rib chiqing yoki to'g'ridan-to'g'ri biz bilan bog'laning.</T>
          </p>
          <div className="mt-6 mx-auto max-w-xl relative">
            <Search size={18} className="absolute left-3 top-3 muted" />
            <input
              className="input pl-10 py-3"
              placeholder={t("Savolingizni yozing…")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
      </section>

      {/* ── Quick links ──────────── */}
      <section className="px-4 mt-6">
        <div className="mx-auto max-w-6xl grid sm:grid-cols-3 gap-3">
          <QuickCard icon={<BookOpen size={20} />}   title="Yangi boshlovchilar" body="Tizimni 5 daqiqada o'rganib oling." />
          <QuickCard icon={<Sparkles size={20} />}   title="Maslahatlar"          body="Yaxshi reyting va ko'p mijoz topish sirlari." />
          <QuickCard icon={<ShieldAlert size={20} />} title="Xavfsizlik"           body="Firibgarlikdan qanday himoyalanish." />
        </div>
      </section>

      <main className="flex-1 mx-auto max-w-6xl w-full px-4 mt-6 pb-12 grid lg:grid-cols-[260px_1fr] gap-6">
        {/* ── Sidebar (categories) ── */}
        <aside className="card p-4 self-start lg:sticky lg:top-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
          <h3 className="text-xs uppercase tracking-wider muted px-2"><T>Bo'limlar</T></h3>
          <nav className="mt-3 grid gap-1">
            {CATEGORIES.map(({ id, label, icon: Icon, questions }) => {
              const active = activeCat === id && !q;
              return (
                <button
                  key={id}
                  onClick={() => { setActiveCat(id); setQ(""); setOpen({}); }}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-left ${active ? "bg-brand-navy text-white" : "hover:bg-black/5"}`}
                >
                  <Icon size={15} className={active ? "" : "muted"} />
                  <span className="flex-1"><T>{label}</T></span>
                  <span className={`text-[10px] rounded-full px-1.5 ${active ? "bg-white/20" : "bg-black/5"}`}>{questions.length}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* ── FAQ content ────────── */}
        <article className="grid gap-4">
          {q && (
            <div className="text-sm muted">
              <T>Topildi</T>: <b>{filtered.length}</b> <T>natija "{q}" so'rovi bo'yicha</T>
            </div>
          )}
          {filtered.length === 0 && (
            <div className="card p-8 text-center muted">
              <HelpCircle size={28} className="mx-auto mb-2" />
              <T>Hech narsa topilmadi. Boshqa kalit so'z bilan urinib ko'ring yoki biz bilan bog'laning.</T>
            </div>
          )}
          {filtered.map((item, i) => {
            const key = (item as any)._cat ? `${(item as any)._cat}::${item.q}` : `${activeCat}::${item.q}`;
            const isOpen = !!open[key];
            return (
              <div key={i} className="card p-0 overflow-hidden">
                <button
                  onClick={() => setOpen((o) => ({ ...o, [key]: !isOpen }))}
                  className="w-full flex items-center justify-between gap-3 text-left px-5 py-4"
                >
                  <span className="font-medium heading"><T>{item.q}</T></span>
                  <ChevronDown size={16} className={`transition-transform shrink-0 muted ${isOpen ? "rotate-180" : ""}`} />
                </button>
                {isOpen && (
                  <div className="px-5 pb-5 text-sm muted leading-relaxed border-t" style={{ borderColor: "var(--border)" }}>
                    {(item as any)._cat && (
                      <div className="mt-3 inline-block badge bg-accent-amberBg text-accent-amber">
                        <T>{(item as any)._cat}</T>
                      </div>
                    )}
                    <p className={`${(item as any)._cat ? "mt-2" : "mt-3"}`}><T>{item.a}</T></p>
                  </div>
                )}
              </div>
            );
          })}

          {/* ── Contact CTA ──── */}
          <div className="card p-6 mt-2 grid md:grid-cols-[1fr_auto] items-center gap-4">
            <div>
              <h3 className="font-semibold heading"><T>Javob topa olmadingizmi?</T></h3>
              <p className="text-sm muted mt-1"><T>Bizga yozing — odatda 24 soat ichida javob qaytaramiz.</T></p>
            </div>
            <a href={CONTACT.emailHref} className="btn-primary gap-2">
              <Mail size={16} /><T>Email yozish</T>
            </a>
          </div>

          {/* ── Contact channels ── */}
          <section className="grid sm:grid-cols-3 gap-3">
            <Contact icon={<Mail size={18} />}      title="Email"     text={CONTACT.email}          href={CONTACT.emailHref} />
            <Contact icon={<Phone size={18} />}     title="Telefon"   text={CONTACT.phone}          href={CONTACT.phoneHref} />
            <Contact icon={<Send size={18} />}      title="Telegram"  text={SOCIAL.telegram.label}  href={SOCIAL.telegram.href} />
            <Contact icon={<LifeBuoy size={18} />}  title="Support"   text={SOCIAL.support.label}   href={SOCIAL.support.href} />
            <Contact icon={<Instagram size={18} />} title="Instagram" text={SOCIAL.instagram.label} href={SOCIAL.instagram.href} />
            <Contact icon={<Youtube size={18} />}   title="YouTube"   text={SOCIAL.youtube.label}   href={SOCIAL.youtube.href} />
          </section>
        </article>
      </main>

      {/* ── Footer ─────────────── */}
      <footer className="mt-auto border-t" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
        <div className="mx-auto max-w-6xl px-4 py-6 grid md:grid-cols-2 gap-4 text-sm">
          <div className="flex items-center gap-2 muted">
            <span>© 2026 Ishchi Bormi</span>
          </div>
          <div className="flex md:justify-end gap-5 muted">
            <Link href="/biz-haqimizda"><T>Biz haqimizda</T></Link>
            <Link href="/maxfiylik-siyosati"><T>Maxfiylik siyosati</T></Link>
            <Link href="/foydalanish-shartlari"><T>Foydalanish shartlari</T></Link>
            <Link href="/yordam" className="heading"><T>Yordam</T></Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ── helpers ───────────────────── */

function QuickCard({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="card p-5 flex items-start gap-3">
      <div className="h-10 w-10 grid place-items-center rounded-xl bg-brand-navy text-white shrink-0">{icon}</div>
      <div>
        <h3 className="font-semibold heading flex items-center gap-2"><T>{title}</T> <ArrowRight size={14} className="muted" /></h3>
        <p className="mt-1 text-sm muted"><T>{body}</T></p>
      </div>
    </div>
  );
}

function Contact({ icon, title, text, href }: { icon: React.ReactNode; title: string; text: string; href: string }) {
  return (
    <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className="card p-4 flex items-center gap-3 hover:shadow-md transition">
      <div className="h-10 w-10 grid place-items-center rounded-xl text-accent-amber" style={{ background: "rgba(232,146,10,0.1)" }}>{icon}</div>
      <div>
        <div className="text-xs uppercase muted"><T>{title}</T></div>
        <div className="font-medium">{text}</div>
      </div>
    </a>
  );
}
