"use client";
import Link from "next/link";
import {
  FileCheck2, UserPlus, ShieldAlert, Ban, ClipboardList, Handshake,
  Star, Wallet, Copyright, Scale, OctagonAlert, Gavel, RefreshCw, Mail,
  Phone, Send, MapPin, AlertCircle, CheckSquare, LifeBuoy, Instagram, Youtube,
} from "lucide-react";
import { CONTACT, SOCIAL } from "@/lib/contact";
import { LangMenu } from "@/components/LangMenu";
import { ThemeToggle } from "@/components/ThemeToggle";
import { T } from "@/components/T";
import { getAccess } from "@/lib/api";
import { Logo } from "@/components/Logo";

const SECTIONS = [
  { id: "intro",        label: "Kirish va qabul qilish",     icon: FileCheck2 },
  { id: "account",      label: "Hisob yaratish",             icon: UserPlus },
  { id: "obligations",  label: "Foydalanuvchi majburiyatlari", icon: CheckSquare },
  { id: "prohibited",   label: "Taqiqlangan harakatlar",     icon: Ban },
  { id: "elons",        label: "E'lonlar",                   icon: ClipboardList },
  { id: "process",      label: "Arizalar va yakunlash",      icon: Handshake },
  { id: "ratings",      label: "Baholar va sharhlar",        icon: Star },
  { id: "payments",     label: "To'lovlar",                  icon: Wallet },
  { id: "ip",           label: "Intellektual mulk",          icon: Copyright },
  { id: "disclaimers",  label: "Mas'uliyatdan ozod etish",   icon: ShieldAlert },
  { id: "liability",    label: "Mas'uliyat chegaralari",     icon: Scale },
  { id: "termination",  label: "Hisobni to'xtatish",         icon: OctagonAlert },
  { id: "law",          label: "Qo'llaniladigan qonun",      icon: Gavel },
  { id: "changes",      label: "O'zgartirishlar",            icon: RefreshCw },
  { id: "contact",      label: "Aloqa",                      icon: Mail },
];

export default function TermsPage() {
  const ctaHref = getAccess() ? "/dashboard" : "/login";

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

      {/* ── Hero ───────────────────── */}
      <section className="px-4 pt-6">
        <div className="mx-auto max-w-6xl card p-8 sm:p-12 text-center">
          <div className="mx-auto h-14 w-14 grid place-items-center rounded-2xl bg-brand-navy text-white">
            <FileCheck2 size={26} />
          </div>
          <h1 className="mt-4 text-2xl sm:text-3xl font-extrabold heading">
            <T>Foydalanish shartlari</T>
          </h1>
          <p className="mt-2 text-sm muted max-w-2xl mx-auto">
            <T>Ishchi Bormi platformasidan foydalanish qoidalari va shartlari. Iltimos, ro'yxatdan o'tishdan oldin diqqat bilan o'qing.</T>
          </p>
          <p className="mt-3 text-xs muted"><T>Oxirgi yangilanish</T>: 22.06.2026</p>
        </div>
      </section>

      <main className="flex-1 mx-auto max-w-6xl w-full px-4 mt-6 pb-12 grid lg:grid-cols-[260px_1fr] gap-6">
        {/* ── TOC ─────────────────── */}
        <aside className="card p-4 self-start lg:sticky lg:top-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
          <h3 className="text-xs uppercase tracking-wider muted px-2"><T>Mundarija</T></h3>
          <nav className="mt-3 grid gap-1">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <a key={id} href={`#${id}`} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-black/5">
                <Icon size={15} className="muted" />
                <span><T>{label}</T></span>
              </a>
            ))}
          </nav>
        </aside>

        {/* ── Content ─────────────── */}
        <article className="grid gap-4">
          <Note kind="info">
            <T>Platformaga ro'yxatdan o'tish va undan foydalanish orqali siz ushbu Foydalanish shartlari bilan rozilik bildirasiz.</T>
          </Note>

          <Sec id="intro" icon={<FileCheck2 size={18} />} title="Kirish va qabul qilish">
            <P>
              <T>Ushbu hujjat siz ("Foydalanuvchi") va Ishchi Bormi platformasi ("Biz") o'rtasidagi shartnoma hisoblanadi. Tizimga kirish, e'lon joylashtirish yoki ariza topshirish orqali siz ushbu shartlarni qabul qilgan hisoblanasiz.</T>
            </P>
            <P>
              <T>Agar siz shartlarga rozi bo'lmasangiz, iltimos, platformadan foydalanmang.</T>
            </P>
          </Sec>

          <Sec id="account" icon={<UserPlus size={18} />} title="Hisob yaratish">
            <ul className="space-y-1.5 text-sm muted list-disc pl-5">
              <li><T>Hisob yaratish uchun siz kamida 18 yoshda bo'lishingiz kerak.</T></li>
              <li><T>Faqat sizga tegishli, haqiqiy Telegram va telefon raqamidan foydalaning.</T></li>
              <li><T>Bir foydalanuvchi — bir hisob. Bir nechta hisob ochish taqiqlanadi.</T></li>
              <li><T>Hisobingiz xavfsizligi uchun siz mas'ulsiz. Maxfiy kodingizni hech kim bilan baham ko'rmang.</T></li>
              <li><T>Sizning hisobingiz orqali sodir bo'lgan barcha amallar siz tomonidan bajarilgan hisoblanadi.</T></li>
            </ul>
          </Sec>

          <Sec id="obligations" icon={<CheckSquare size={18} />} title="Foydalanuvchi majburiyatlari">
            <P><T>Platformadan foydalanganda siz quyidagilarga rioya qilishingiz shart:</T></P>
            <ul className="mt-2 space-y-1.5 text-sm muted list-disc pl-5">
              <li><T>Faqat haqiqiy ma'lumotlarni taqdim etish (ism, manzil, ko'nikmalar).</T></li>
              <li><T>Boshqa foydalanuvchilarga hurmat bilan munosabatda bo'lish.</T></li>
              <li><T>Kelishilgan ish shartlariga rioya qilish va vaqtida bajarish.</T></li>
              <li><T>O'zaro shartlashilgan to'lovni o'z vaqtida amalga oshirish (ish beruvchi).</T></li>
              <li><T>Ish jarayonida xavfsizlik talablariga rioya qilish.</T></li>
            </ul>
          </Sec>

          <Sec id="prohibited" icon={<Ban size={18} />} title="Taqiqlangan harakatlar">
            <Note kind="warning">
              <T>Quyidagi xatti-harakatlar qat'iyan taqiqlanadi va hisobni bloklashga sabab bo'ladi:</T>
            </Note>
            <ul className="mt-2 space-y-1.5 text-sm muted list-disc pl-5">
              <li><T>Soxta yoki yolg'on ma'lumotlar joylashtirish.</T></li>
              <li><T>Qonunga zid ish turlari haqida e'lon yaratish.</T></li>
              <li><T>Boshqa foydalanuvchilarni firibgarlik qilish, aldash yoki tahdid qilish.</T></li>
              <li><T>Spam, reklama yoki nojo'ya kontent tarqatish.</T></li>
              <li><T>Platformani buzishga, hacker hujumlariga urinish.</T></li>
              <li><T>Avtomatlashtirilgan bot yoki skript orqali ommaviy ariza topshirish.</T></li>
              <li><T>Bir necha hisoblar yordamida reytinglarni sun'iy ravishda oshirish.</T></li>
            </ul>
          </Sec>

          <Sec id="elons" icon={<ClipboardList size={18} />} title="E'lonlar joylashtirish">
            <ul className="space-y-1.5 text-sm muted list-disc pl-5">
              <li><T>E'lon mazmuni real ish, real manzil va aniq narx (yoki "Kelishiladi") ko'rsatilishi kerak.</T></li>
              <li><T>E'lon avval qoralama (draft) sifatida saqlanadi, keyin siz uni nashr qilishingiz mumkin.</T></li>
              <li><T>E'londa ko'rsatilgan ishlar yakuniga yetgach, e'lon arxivga o'tkaziladi.</T></li>
              <li><T>Platforma har qanday e'lonni qoidalarga zid deb topsa, o'chirib yuborish huquqini saqlab qoladi.</T></li>
            </ul>
          </Sec>

          <Sec id="process" icon={<Handshake size={18} />} title="Arizalar, ish jarayoni va yakunlash">
            <P>
              <T>Ishchi e'longa ariza topshirgach, e'lon egasi arizani qabul qilishi yoki rad etishi mumkin. Ish boshlangach, ikkala tomon ham ish bajarilganini tasdiqlashi kerak.</T>
            </P>
            <ul className="mt-2 space-y-1.5 text-sm muted list-disc pl-5">
              <li><T>Arizalar tartib bilan ko'rib chiqiladi, kafolatlangan vaqt belgilanmagan.</T></li>
              <li><T>Ish boshlangandan keyin tomonlardan biri bekor qilishi mumkin, ammo bu reytingga ta'sir qilishi mumkin.</T></li>
              <li><T>Ish bajarilganini ikkala tomon tasdiqlasagina ish "Bajarildi" deb hisoblanadi.</T></li>
            </ul>
          </Sec>

          <Sec id="ratings" icon={<Star size={18} />} title="Baholar va sharhlar">
            <ul className="space-y-1.5 text-sm muted list-disc pl-5">
              <li><T>Ish yakunlangach, har ikkala tomon bir-biriga baho qoldirishi mumkin (1 dan 5 yulduzgacha).</T></li>
              <li><T>Sharhlar haqiqatga asoslangan va hurmat doirasida bo'lishi shart.</T></li>
              <li><T>Haqoratomuz, yolg'on yoki shaxsiyatga tegadigan sharhlar o'chiriladi.</T></li>
              <li><T>Reytingni sun'iy oshirish urinishlari hisobni bloklashga sabab bo'ladi.</T></li>
            </ul>
          </Sec>

          <Sec id="payments" icon={<Wallet size={18} />} title="To'lovlar va moliya">
            <P>
              <T>Ishchi Bormi platforma sifatida tomonlar o'rtasida to'lovlarni qabul qilmaydi va o'tkazmaydi. Barcha to'lovlar to'g'ridan-to'g'ri ishchi va ish beruvchi o'rtasida amalga oshiriladi.</T>
            </P>
            <P>
              <T>Moliya bo'limidagi raqamlar faqat statistika maqsadida ko'rsatiladi (kelishilgan summalar). Haqiqiy to'lov bo'yicha kelishmovchiliklar uchun platforma javobgar emas.</T>
            </P>
          </Sec>

          <Sec id="ip" icon={<Copyright size={18} />} title="Intellektual mulk">
            <P>
              <T>Platforma logotipi, dizayni, kodi va kontenti Ishchi Bormi mulki hisoblanadi. Ularni ruxsatsiz nusxalash, tarqatish yoki o'zgartirish taqiqlanadi.</T>
            </P>
            <P>
              <T>Foydalanuvchi joylashtirgan kontent (e'lon matni, sharhlar) foydalanuvchi mulki bo'lib qoladi, ammo siz bizga ushbu kontentni platformada ko'rsatish huquqini berasiz.</T>
            </P>
          </Sec>

          <Sec id="disclaimers" icon={<ShieldAlert size={18} />} title="Mas'uliyatdan ozod etish">
            <P>
              <T>Platforma faqat ishchilar va ish beruvchilarni bog'laydigan vositachi hisoblanadi. Biz tomonlar o'rtasidagi shartnoma tomoni emasmiz.</T>
            </P>
            <P>
              <T>Bajarilgan ishning sifati, to'lov masalalari yoki tomonlar o'rtasidagi har qanday nizolar uchun platforma javobgar emas.</T>
            </P>
          </Sec>

          <Sec id="liability" icon={<Scale size={18} />} title="Mas'uliyat chegaralari">
            <P>
              <T>Qonun ruxsat etgan eng yuqori darajada, Ishchi Bormi platformasi va uning ishlab chiquvchilari sizning platformadan foydalanishingiz natijasida yuzaga keladigan bilvosita, tasodifiy yoki maxsus zararlar uchun javobgar emas.</T>
            </P>
          </Sec>

          <Sec id="termination" icon={<OctagonAlert size={18} />} title="Hisobni to'xtatish va o'chirish">
            <ul className="space-y-1.5 text-sm muted list-disc pl-5">
              <li><T>Siz istalgan vaqtda hisobingizni Sozlamalar orqali o'chirishingiz mumkin.</T></li>
              <li><T>Biz ushbu shartlarni buzgan foydalanuvchilarning hisobini ogohlantirishsiz bloklash yoki o'chirish huquqini saqlab qolamiz.</T></li>
              <li><T>Hisob o'chirilganda umumiy ma'lumot saqlanadi (tarix uchun), shaxsiy ma'lumotlar esa anonimizatsiya qilinadi.</T></li>
            </ul>
          </Sec>

          <Sec id="law" icon={<Gavel size={18} />} title="Qo'llaniladigan qonun va nizolarni hal etish">
            <P>
              <T>Ushbu shartlar O'zbekiston Respublikasi qonunchiligi asosida tuzilgan va talqin qilinadi.</T>
            </P>
            <P>
              <T>Tomonlar har qanday nizoni avval do'stona yo'l bilan, muvaffaqiyatsiz bo'lsa, O'zbekiston Respublikasi sudlari orqali hal etadilar.</T>
            </P>
          </Sec>

          <Sec id="changes" icon={<RefreshCw size={18} />} title="Shartlarga o'zgartirishlar">
            <P>
              <T>Biz vaqti-vaqti bilan ushbu shartlarni yangilab turishimiz mumkin. Muhim o'zgarishlar bo'lganda sizni platforma orqali xabardor qilamiz. O'zgarishlardan keyin platformadan foydalanishni davom ettirish — yangi shartlarga rozilik bildirish hisoblanadi.</T>
            </P>
          </Sec>

          <Sec id="contact" icon={<Mail size={18} />} title="Aloqa">
            <P><T>Savollar yoki tushuntirishlar uchun biz bilan bog'laning:</T></P>
            <div className="mt-3 grid sm:grid-cols-3 gap-3 text-sm">
              <Contact icon={<Mail size={16} />} text={CONTACT.email} href={CONTACT.emailHref} />
              <Contact icon={<Phone size={16} />} text={CONTACT.phone} href={CONTACT.phoneHref} />
              <Contact icon={<Send size={16} />} text={SOCIAL.telegram.label} href={SOCIAL.telegram.href} />
              <Contact icon={<LifeBuoy size={16} />} text={SOCIAL.support.label} href={SOCIAL.support.href} />
              <Contact icon={<Instagram size={16} />} text={SOCIAL.instagram.label} href={SOCIAL.instagram.href} />
              <Contact icon={<Youtube size={16} />} text={SOCIAL.youtube.label} href={SOCIAL.youtube.href} />
            </div>
          </Sec>

          <div className="card p-5 mt-2 text-center">
            <p className="text-sm muted">
              <T>Ushbu shartlarni o'qiganingiz uchun rahmat. Birga ishonchli mehnat bozorini quramiz.</T>
            </p>
            <Link href={ctaHref} className="btn-primary mt-4"><T>Davom etish</T></Link>
          </div>
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
            <Link href="/foydalanish-shartlari" className="heading"><T>Foydalanish shartlari</T></Link>
            <Link href="/yordam"><T>Yordam</T></Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ── helpers ───────────────────── */

function Sec({ id, icon, title, children }: { id: string; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="card p-6 scroll-mt-20">
      <h2 className="font-semibold heading flex items-center gap-2 text-lg">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-navy text-white">{icon}</span>
        <T>{title}</T>
      </h2>
      <div className="mt-3 grid gap-2">{children}</div>
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-relaxed muted">{children}</p>;
}

function Note({ children, kind = "info" }: { children: React.ReactNode; kind?: "info" | "warning" }) {
  const isWarn = kind === "warning";
  return (
    <div
      className="card p-4 flex gap-3"
      style={{ background: isWarn ? "rgba(220,38,38,0.07)" : "rgba(232,146,10,0.08)" }}
    >
      {isWarn
        ? <AlertCircle size={18} className="text-danger shrink-0 mt-0.5" />
        : <AlertCircle size={18} className="text-accent-amber shrink-0 mt-0.5" />}
      <p className="text-sm muted">{children}</p>
    </div>
  );
}

function Contact({ icon, text, href }: { icon: React.ReactNode; text: string; href?: string }) {
  const inner = (
    <>
      <span className="text-accent-amber">{icon}</span>
      <span className="text-sm break-all">{text}</span>
    </>
  );
  const cls = "rounded-xl border p-3 flex items-center gap-2";
  return href ? (
    <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer"
       className={`${cls} hover:shadow-md transition`} style={{ borderColor: "var(--border)" }}>{inner}</a>
  ) : (
    <div className={cls} style={{ borderColor: "var(--border)" }}>{inner}</div>
  );
}
