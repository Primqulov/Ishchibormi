"use client";
import Link from "next/link";
import {
  Trash2, Smartphone, Send, ListChecks, Clock, ShieldAlert,
  Mail, Phone, LifeBuoy, AlertCircle, RotateCcw, Database,
} from "lucide-react";
import { CONTACT, SOCIAL } from "@/lib/contact";
import { RETENTION_DAYS, RETENTION_TABLE } from "@/lib/retention";
import { LangMenu } from "@/components/LangMenu";
import { ThemeToggle } from "@/components/ThemeToggle";
import { T } from "@/components/T";
import { getAccess } from "@/lib/api";
import { Logo } from "@/components/Logo";

/**
 * Ochiq (login talab qilmaydigan) hisobni o'chirish sahifasi.
 *
 * Google Play "Data deletion" talabi: foydalanuvchi ilovani o'rnatmasdan ham
 * hisobini o'chirishni so'ray olishi va nima o'chishini oldindan bilishi kerak.
 * Shu sababli sahifa ochiq — hech qanday `useQuery`/auth chaqiruvi yo'q.
 *
 * Sahifadagi barcha muddatlar `lib/retention.ts` dan olinadi, u esa backend
 * kodidagi aniq qiymatlarga bog'langan. Hech qachon bu yerga qo'lda raqam
 * yozmang.
 */
export default function DeleteAccountPage() {
  const ctaHref = getAccess() ? "/dashboard" : "/login";

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Header ─────────────────── */}
      <header className="border-b" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
        <div className="mx-auto max-w-4xl flex items-center justify-between px-4 py-3">
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
        <div className="mx-auto max-w-4xl card p-8 sm:p-12 text-center">
          <div className="mx-auto h-14 w-14 grid place-items-center rounded-2xl bg-red-600 text-white">
            <Trash2 size={26} />
          </div>
          <h1 className="mt-4 text-2xl sm:text-3xl font-extrabold heading">
            <T>Hisobni o'chirish</T>
          </h1>
          <p className="mt-2 text-sm muted max-w-2xl mx-auto">
            <T>
              Ishchi Bormi hisobingizni va unga bog'liq ma'lumotlarni qanday
              o'chirishingiz mumkinligi, nima o'chishi va nima qancha muddat
              saqlanishi shu sahifada tushuntirilgan.
            </T>
          </p>
          <p className="mt-3 text-xs muted">
            <T>Ilova</T>: Ishchi Bormi (uz.ishchibormi.app) · <T>Oxirgi yangilanish</T>: 19.07.2026
          </p>
        </div>
      </section>

      <main className="flex-1 mx-auto max-w-4xl w-full px-4 mt-6 pb-12 grid gap-4">
        {/* ── English summary (Google Play review uchun) ───────────────── */}
        <div className="card p-5" style={{ background: "rgba(30,64,175,0.06)" }}>
          <h2 className="font-semibold heading text-sm uppercase tracking-wider">In English</h2>
          <p className="mt-2 text-sm leading-relaxed muted">
            To delete your <b className="heading">Ishchi Bormi</b> account, open the app
            and go to <b className="heading">Profile → Settings → Delete account</b>, or
            use the same option on this website after signing in. We send a one-time
            confirmation code to the Telegram account you signed up with. Once
            confirmed, your account is disabled immediately, your job posts are
            withdrawn, your pending applications are cancelled, and your phone number
            and Telegram ID are released right away. All remaining personal data —
            profile, job posts, applications, uploaded images, notifications,
            feedback, reports, and your support-bot conversations (text, voice
            messages and photos) — is <b className="heading">permanently erased after {RETENTION_DAYS} days</b>.
            One documented exception: voice messages and photos you sent to our
            Telegram support bot are stored on Telegram's servers, not ours. We
            delete our record and the reference to them, but the Telegram Bot API
            provides no way for us to delete the file on Telegram's side.
            If you cannot access the app, email{" "}
            <a className="underline" href={CONTACT.emailHref}>{CONTACT.email}</a> or message{" "}
            <a className="underline" href={SOCIAL.support.href} target="_blank" rel="noreferrer">
              {SOCIAL.support.label}
            </a>{" "}on Telegram from the phone number linked to your account, and we
            will delete it for you.
          </p>
        </div>

        <Note>
          <T>
            Hisobni o'chirish qaytarib bo'lmaydigan amal. Muhlat tugagach
            ma'lumotlarni tiklashning imkoni yo'q — bizda ham nusxasi qolmaydi.
          </T>
        </Note>

        {/* ── 1. Ilova orqali ─────────────────────────────────────────── */}
        <Sec icon={<Smartphone size={18} />} title="1-usul: ilova orqali (tavsiya etiladi)">
          <Steps
            items={[
              "Ilovani oching va hisobingizga kiring.",
              "Profil → Sozlamalar bo'limiga o'ting.",
              "«Hisobni o'chirish» tugmasini bosing va tasdiqlang.",
              "Telegram'ga yuborilgan bir martalik kodni kiriting.",
            ]}
          />
          <P>
            <T>
              Kod ro'yxatdan o'tishda ishlatgan Telegram hisobingizga yuboriladi.
              Bu — qurilmangiz boshqa birovning qo'liga tushib qolsa ham hisobingiz
              o'chirilib ketmasligi uchun qo'yilgan himoya.
            </T>
          </P>
          <P>
            <T>
              Agar bot sizga yoza olmasa (hech qachon «Start» bosmagan yoki botni
              bloklagan bo'lsangiz), ilova bot havolasini ko'rsatadi: botni oching,
              «Start» bosing va o'chirishni qaytadan boshlang.
            </T>
          </P>
        </Sec>

        {/* ── 2. Ilovasiz ─────────────────────────────────────────────── */}
        <Sec icon={<Send size={18} />} title="2-usul: ilovasiz (agar ilovaga kira olmasangiz)">
          <P>
            <T>
              Telefoningizni yo'qotgan, ilovani o'chirib tashlagan yoki hisobingizga
              kira olmayotgan bo'lsangiz — o'chirishni bevosita bizdan so'rang:
            </T>
          </P>
          <div className="mt-3 grid sm:grid-cols-3 gap-3 text-sm">
            <Contact icon={<Mail size={16} />} text={CONTACT.email} href={CONTACT.emailHref} />
            <Contact icon={<LifeBuoy size={16} />} text={SOCIAL.support.label} href={SOCIAL.support.href} />
            <Contact icon={<Phone size={16} />} text={CONTACT.phone} href={CONTACT.phoneHref} />
          </div>
          <P>
            <T>
              Murojaatingizda hisobingizga bog'langan telefon raqamini ko'rsating va
              mavzuga «Hisobni o'chirish» deb yozing. Biz raqam haqiqatan sizniki
              ekanini tasdiqlaymiz va so'rovni 30 kun ichida bajaramiz — odatda ancha
              tezroq. So'rov bajarilgach, quyidagi muddatlar ilovadagi bilan bir xil
              ishlaydi.
            </T>
          </P>
        </Sec>

        {/* ── Nima darhol sodir bo'ladi ───────────────────────────────── */}
        <Sec icon={<ListChecks size={18} />} title="O'chirishni tasdiqlaganingizda darhol nima bo'ladi">
          <Bullets
            items={[
              "Hisobingiz o'chiriladi — barcha qurilmalardan chiqarilasiz va boshqa kira olmaysiz.",
              "Telefon raqamingiz va Telegram identifikatoringiz hisobdan uziladi. Ular darhol bo'shaydi: xohlasangiz, o'sha raqam bilan yangi (bo'sh) hisob ochishingiz mumkin.",
              "E'lonlaringiz e'lonlar ro'yxatidan olib tashlanadi — boshqa hech kim ularni ko'rmaydi.",
              "Ko'rib chiqilayotgan va qabul qilingan arizalaringiz bekor qilinadi, ikkala tomonda ham.",
              "Yuklagan rasmlaringiz saqlash xizmatidan o'chiriladi.",
              "Profilingiz boshqa foydalanuvchilarga ko'rinmay qoladi.",
            ]}
          />
        </Sec>

        {/* ── Nima qoladi va qancha ───────────────────────────────────── */}
        <Sec icon={<Clock size={18} />} title={`${RETENTION_DAYS} kun davomida nima saqlanadi`}>
          <P>
            <T>
              Hisob darhol ishlamay qoladi, lekin yozuvlar bazadan bir zumda emas,
            </T>{" "}
            <b className="heading">{RETENTION_DAYS} <T>kundan keyin</T></b>{" "}
            <T>butunlay o'chiriladi. Bu muhlat davomida quyidagilar bazada qoladi (hech kimga ko'rinmagan holda):</T>
          </P>
          <Bullets
            items={[
              "Profil ma'lumotlari: ism, familiya, viloyat/tuman, bio, ko'nikmalar, avatar havolasi.",
              "Arxivlangan telefon raqami va Telegram identifikatori (faqat qo'llab-quvvatlash xizmati murojaatni tekshira olishi uchun).",
              "E'lonlar, arizalar, bildirishnomalar, taklif/shikoyatlar va sizga aloqador moderatsiya shikoyatlari.",
            ]}
          />
          <P>
            <T>
              Muhlat nima uchun kerak: xatoga yo'l qo'yib yoki begona odam
              qurilmangizdan foydalanib hisobni o'chirsa, siz qo'llab-quvvatlash
              xizmatiga murojaat qilib nima bo'lganini aniqlay olasiz; shuningdek,
              o'chirishdan sal oldin yuborilgan firibgarlik shikoyatlari ko'rib
              chiqilishi mumkin bo'ladi.
            </T>
          </P>
        </Sec>

        {/* ── Muhlat tugagach ─────────────────────────────────────────── */}
        <Sec icon={<ShieldAlert size={18} />} title={`${RETENTION_DAYS} kundan keyin nima o'chadi`}>
          <P>
            <T>
              Muhlat tugashi bilan avtomatik jarayon (server har 6 soatda tekshiradi)
              hisobingizga tegishli hamma narsani bazadan butunlay o'chiradi:
            </T>
          </P>
          <Bullets
            items={[
              "Hisob yozuvi — ism, familiya, bio, ko'nikmalar, viloyat/tuman, avatar, reyting va statistika.",
              "Arxivlangan telefon raqami va Telegram identifikatori.",
              "Barcha e'lonlaringiz.",
              "Ikkala tomondagi barcha arizalaringiz.",
              "Barcha bildirishnomalaringiz.",
              "Yuborgan taklif va shikoyatlaringiz.",
              "Siz yuborgan va siz haqingizdagi moderatsiya shikoyatlari.",
              "Bir martalik kirish va o'chirish kodlari.",
              "Yuklangan rasmlar (o'chirish qayta tasdiqlanadi).",
              "Qo'llab-quvvatlash botiga yozgan murojaatlaringiz — matn, ovozli xabar va rasmlar, hamda ular bilan saqlangan telefon raqamingiz, ismingiz va Telegram foydalanuvchi nomingiz.",
            ]}
          />
          <P>
            <T>
              Shundan so'ng bizning tizimimizda sizga olib boradigan hech narsa
              qolmaydi.
            </T>
          </P>
          <P>
            <b className="heading"><T>Bitta istisno — ochiq aytamiz</T>:</b>{" "}
            <T>
              qo'llab-quvvatlash botiga ovozli xabar yoki rasm yuborgan
              bo'lsangiz, faylning o'zi Telegram serverlarida saqlanadi, bizda
              emas — biz faqat unga havolani saqlaymiz. Havolani va murojaat
              yozuvini o'chiramiz, lekin Telegram'dagi faylni o'chirishga texnik
              imkoniyatimiz yo'q: Telegram bot API'si bunday amalni umuman
              qo'llab-quvvatlamaydi. Xuddi shunday, suhbat tarixi sizning va
              botning Telegram chatida qoladi. Uni o'chirish uchun Telegram'da
              bot bilan suhbatni o'zingiz o'chirib tashlang.
            </T>
          </P>
        </Sec>

        {/* ── Saqlash muddatlari jadvali ──────────────────────────────── */}
        <Sec icon={<Database size={18} />} title="Saqlash muddatlari — to'liq jadval">
          <div className="mt-1 overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left">
                  <th className="heading font-semibold py-2 pr-4 align-top border-b" style={{ borderColor: "var(--border)" }}>
                    <T>Ma'lumot turi</T>
                  </th>
                  <th className="heading font-semibold py-2 align-top border-b" style={{ borderColor: "var(--border)" }}>
                    <T>Qancha saqlanadi</T>
                  </th>
                </tr>
              </thead>
              <tbody>
                {RETENTION_TABLE.map((row) => (
                  <tr key={row.what} className="align-top">
                    <td className="py-2 pr-4 heading border-b" style={{ borderColor: "var(--border)" }}>
                      <T>{row.what}</T>
                    </td>
                    <td className="py-2 muted border-b" style={{ borderColor: "var(--border)" }}>
                      <T>{row.howLong}</T>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Sec>

        {/* ── Fikringizni o'zgartirsangiz ─────────────────────────────── */}
        <Sec icon={<RotateCcw size={18} />} title="Fikringizni o'zgartirsangiz">
          <P>
            <T>
              O'chirilgan hisobni tiklab bo'lmaydi — hatto muhlat tugamagan bo'lsa
              ham. Lekin telefon raqamingiz darhol bo'shatilgani uchun, o'sha raqam
              bilan istalgan paytda yangidan ro'yxatdan o'tishingiz mumkin. Bu
              butunlay yangi va bo'sh hisob bo'ladi: eski e'lonlar, arizalar, reyting
              va sharhlar unga o'tmaydi.
            </T>
          </P>
        </Sec>

        {/* ── Aloqa ───────────────────────────────────────────────────── */}
        <Sec icon={<Mail size={18} />} title="Savollaringiz bo'lsa">
          <P><T>Hisobni o'chirish yoki ma'lumotlaringiz bo'yicha istalgan savol bilan murojaat qiling:</T></P>
          <div className="mt-3 grid sm:grid-cols-2 gap-3 text-sm">
            <Contact icon={<Mail size={16} />} text={CONTACT.email} href={CONTACT.emailHref} />
            <Contact icon={<Phone size={16} />} text={CONTACT.phone} href={CONTACT.phoneHref} />
            <Contact icon={<LifeBuoy size={16} />} text={SOCIAL.support.label} href={SOCIAL.support.href} />
            <Contact icon={<Send size={16} />} text={SOCIAL.telegram.label} href={SOCIAL.telegram.href} />
          </div>
          <P>
            <T>Ma'lumotlaringiz umuman qanday qayta ishlanishini</T>{" "}
            <Link href="/maxfiylik-siyosati" className="underline heading">
              <T>Maxfiylik siyosati</T>
            </Link>{" "}
            <T>sahifasida o'qishingiz mumkin.</T>
          </P>
        </Sec>
      </main>

      {/* ── Footer ─────────────── */}
      <footer className="mt-auto border-t" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
        <div className="mx-auto max-w-4xl px-4 py-6 grid md:grid-cols-2 gap-4 text-sm">
          <div className="flex items-center gap-2 muted">
            <span>© 2026 Ishchi Bormi</span>
          </div>
          <div className="flex md:justify-end gap-5 muted">
            <Link href="/biz-haqimizda"><T>Biz haqimizda</T></Link>
            <Link href="/maxfiylik-siyosati"><T>Maxfiylik siyosati</T></Link>
            <Link href="/foydalanish-shartlari"><T>Foydalanish shartlari</T></Link>
            <Link href="/yordam"><T>Yordam</T></Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ── helpers ───────────────────── */

function Sec({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="card p-6">
      <h2 className="font-semibold heading flex items-center gap-2 text-lg">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-navy text-white shrink-0">{icon}</span>
        <T>{title}</T>
      </h2>
      <div className="mt-3 grid gap-3">{children}</div>
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-relaxed muted">{children}</p>;
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5 text-sm muted list-disc pl-5">
      {items.map((it) => <li key={it}><T>{it}</T></li>)}
    </ul>
  );
}

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="space-y-1.5 text-sm muted list-decimal pl-5">
      {items.map((it) => <li key={it}><T>{it}</T></li>)}
    </ol>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="card p-4 flex gap-3" style={{ background: "rgba(220,38,38,0.08)" }}>
      <AlertCircle size={18} className="text-red-600 shrink-0 mt-0.5" />
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
