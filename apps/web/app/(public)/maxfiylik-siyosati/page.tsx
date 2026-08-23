"use client";
import Link from "next/link";
import {
  ShieldCheck, Database, Lock, Share2, UserCog, Baby, Smartphone,
  RefreshCw, Mail, Phone, Send, MapPin, FileText, AlertCircle, Clock,
  LifeBuoy, Instagram, Youtube, Trash2, HardDrive,
} from "lucide-react";
import { CONTACT, SOCIAL } from "@/lib/contact";
import { RETENTION_DAYS, RETENTION_TABLE } from "@/lib/retention";
import { LangMenu } from "@/components/LangMenu";
import { ThemeToggle } from "@/components/ThemeToggle";
import { T } from "@/components/T";
import { getAccess } from "@/lib/api";
import { Logo } from "@/components/Logo";

/**
 * Maxfiylik siyosati.
 *
 * MUHIM QOIDA: bu sahifadagi HAR BIR gap manba kodida tasdiqlangan bo'lishi
 * shart. Ilova/backend qilmaydigan narsani yozish — Google Play siyosatini
 * buzish (noto'g'ri oshkor qilish). Xususan, quyidagilar ATAYLAB yo'q, chunki
 * kodda ular yo'q:
 *   - reklama identifikatorlari va reklama tarmoqlari (yig'ilmaydi)
 *   - kamera (ilova faqat galereyadan rasm tanlaydi — pickMultiImage)
 *   - chat/xabarlar va moliyaviy hisobotlar (backend'da bunday endpoint yo'q)
 *   - sharhlar va baholar (kodda hech qachon yozilmaydi)
 *   - foydalanuvchi paroli (kirish faqat Telegram OTP orqali; parol umuman yo'q)
 * Firebase (Crashlytics, Analytics, Cloud Messaging) mobil ilovaga ULANGAN va
 * "firebase" bo'limida oshkor qilingan — bu bo'limni o'chirmang; SDK'lar
 * pubspec.yaml da, ishga tushirish flutter-app/lib/bootstrap.dart da.
 * Muddatlar `lib/retention.ts` dan olinadi — u backend qiymatlariga bog'langan.
 */

const SECTIONS = [
  { id: "intro",     label: "Kirish",                        icon: FileText },
  { id: "collect",   label: "Qaysi ma'lumotlarni yig'amiz",  icon: Database },
  { id: "notcollect",label: "Nimalarni yig'MAYMIZ",          icon: ShieldCheck },
  { id: "firebase",  label: "Texnik xizmatlar (Firebase)",   icon: AlertCircle },
  { id: "use",       label: "Ma'lumotlardan foydalanish",    icon: UserCog },
  { id: "permissions",label: "Ilova ruxsatlari",             icon: Smartphone },
  { id: "location",  label: "Joylashuv va xaritalar",        icon: MapPin },
  { id: "storage",   label: "Qurilmangizda saqlanadigan",    icon: HardDrive },
  { id: "share",     label: "Uchinchi shaxslar",             icon: Share2 },
  { id: "security",  label: "Xavfsizlik",                    icon: Lock },
  { id: "retention", label: "Saqlash muddatlari",            icon: Clock },
  { id: "delete",    label: "Hisobni o'chirish",             icon: Trash2 },
  { id: "rights",    label: "Sizning huquqlaringiz",         icon: ShieldCheck },
  { id: "children",  label: "Bolalar maxfiyligi",            icon: Baby },
  { id: "changes",   label: "O'zgartirishlar",               icon: RefreshCw },
  { id: "contact",   label: "Aloqa",                         icon: Mail },
];

export default function PrivacyPage() {
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
            <ShieldCheck size={26} />
          </div>
          <h1 className="mt-4 text-2xl sm:text-3xl font-extrabold heading">
            <T>Maxfiylik siyosati</T>
          </h1>
          <p className="mt-2 text-sm muted max-w-2xl mx-auto">
            <T>
              Ishchi Bormi sizning shaxsiy ma'lumotlaringizni qanday yig'ishi,
              ishlatishi, saqlashi va o'chirishini aniq tushuntiramiz — hech
              narsani bo'rttirmasdan.
            </T>
          </p>
          <p className="mt-3 text-xs muted">
            <T>Amal qiladi</T>: <T>veb-sayt</T> ishchibormi.uz · <T>Android ilovasi</T> Ishchi Bormi (uz.ishchibormi.app)
          </p>
          <p className="mt-1 text-xs muted"><T>Oxirgi yangilanish</T>: 19.07.2026</p>
        </div>
      </section>

      <main className="flex-1 mx-auto max-w-6xl w-full px-4 mt-6 pb-12 grid lg:grid-cols-[260px_1fr] gap-6">
        {/* ── TOC ─────────────────── */}
        <aside className="card p-4 self-start lg:sticky lg:top-4">
          <h3 className="text-xs uppercase tracking-wider muted px-2"><T>Mundarija</T></h3>
          <nav className="mt-3 grid gap-1">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <a key={id} href={`#${id}`} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-black/5">
                <Icon size={15} className="muted shrink-0" />
                <span><T>{label}</T></span>
              </a>
            ))}
          </nav>
        </aside>

        {/* ── Content ─────────────── */}
        <article className="grid gap-4">
          <Note>
            <T>
              Bu hujjat Ishchi Bormi veb-sayti va Android ilovasiga birdek
              taalluqli. Ilova Google Play orqali tarqatiladi va Flutter'da
              yozilgan.
            </T>
          </Note>

          <Sec id="intro" icon={<FileText size={18} />} title="Kirish">
            <P>
              <T>
                Ushbu Maxfiylik siyosati Ishchi Bormi platformasi ("Biz",
                "Platforma") foydalanuvchilarning shaxsiy ma'lumotlarini qanday
                qayta ishlashini belgilaydi. Platforma — ish beruvchilar va
                ishchilarni bog'laydigan e'lonlar maydoni. Platformadan
                foydalanish orqali siz ushbu siyosat shartlariga rozilik
                bildirasiz.
              </T>
            </P>
          </Sec>

          <Sec id="collect" icon={<Database size={18} />} title="Qaysi ma'lumotlarni yig'amiz">
            <P><T>Faqat quyidagilarni — boshqa hech narsani:</T></P>
            <ul className="mt-2 space-y-1.5 text-sm muted list-disc pl-5">
              <li>
                <b className="heading"><T>Telefon raqami</T>:</b>{" "}
                <T>
                  Telegram orqali ro'yxatdan o'tishda olinadi. Bu — hisobingizning
                  asosiy identifikatori.
                </T>
              </li>
              <li>
                <b className="heading"><T>Telegram identifikatori</T>:</b>{" "}
                <T>
                  Kirish kodini (OTP) va hisobni o'chirish kodini yuborishimiz
                  uchun kerak.
                </T>
              </li>
              <li>
                <b className="heading"><T>Profil ma'lumotlari</T>:</b>{" "}
                <T>
                  ism, familiya, viloyat va tuman, qisqacha bio, ko'nikmalar va
                  (agar yuklasangiz) avatar rasmi. Bio, ko'nikmalar va avatar —
                  ixtiyoriy.
                </T>
              </li>
              <li>
                <b className="heading"><T>E'lonlar</T>:</b>{" "}
                <T>
                  siz joylagan ish e'loni matni, turkumi, narxi, ish vaqti,
                  kerakli ishchilar soni, aloqa telefoni va — agar xaritadan
                  belgilasangiz — ish joyi koordinatalari.
                </T>
              </li>
              <li>
                <b className="heading"><T>Rasmlar</T>:</b>{" "}
                <T>
                  e'longa qo'shgan rasmlaringiz va avataringiz. Ular qurilmangiz
                  galereyasidan tanlanadi.
                </T>
              </li>
              <li>
                <b className="heading"><T>Arizalar</T>:</b>{" "}
                <T>
                  qaysi e'longa ariza berganingiz, necha kishi bilan
                  kelayotganingiz va arizaning holati.
                </T>
              </li>
              <li>
                <b className="heading"><T>Taklif, shikoyat va murojaatlar</T>:</b>{" "}
                <T>
                  bizga yoki boshqa foydalanuvchi ustidan yuborgan xabaringiz
                  matni.
                </T>
              </li>
              <li>
                <b className="heading"><T>Qo'llab-quvvatlash (Telegram)</T>:</b>{" "}
                <T>
                  Yordam bo'limidagi tugma sizni Telegram'dagi qo'llab-quvvatlash
                  akkauntimizga olib boradi. U yerda yozgan xabarlaringiz (matn,
                  ovozli xabar, rasm) Telegram serverlarida, Telegram'ning o'z
                  maxfiylik siyosati asosida qoladi — biz ularni o'z bazamizga
                  SAQLAMAYMIZ.
                </T>
              </li>
              <li>
                <b className="heading"><T>IP manzil</T>:</b>{" "}
                <T>
                  server so'rovlar jurnalida va so'rovlar sonini cheklash
                  (rate limiting) uchun ishlatiladi — bu suiiste'mol va
                  firibgarlikning oldini oladi.
                </T>
              </li>
            </ul>
          </Sec>

          <Sec id="notcollect" icon={<ShieldCheck size={18} />} title="Nimalarni yig'maymiz">
            <P>
              <T>
                Aniqlik uchun — quyidagilar bizda umuman yo'q, chunki ilova
                kodida bunday funksiya mavjud emas:
              </T>
            </P>
            <ul className="mt-2 space-y-1.5 text-sm muted list-disc pl-5">
              <li><T>Reklama identifikatorlari va reklama tarmoqlari yo'q. Ilovada reklama umuman ko'rsatilmaydi.</T></li>
              <li><T>Sizni reklama maqsadida kuzatadigan yoki profillaydigan tizimlar yo'q — quyidagi "Texnik xizmatlar" bo'limida yozilgan xatolik va statistika xizmatlaridan boshqa hech narsa ishlatilmaydi.</T></li>
              <li><T>Kontaktlar ro'yxati, SMS va qo'ng'iroqlar tarixiga murojaat qilinmaydi.</T></li>
              <li><T>Kameraga murojaat qilinmaydi — rasmlar faqat galereyadan tanlanadi.</T></li>
              <li><T>Fon rejimida (ilovadan chiqqaningizdan keyin) joylashuv kuzatilmaydi.</T></li>
              <li><T>Parolingiz yo'q va saqlanmaydi — kirish faqat Telegram orqali yuboriladigan bir martalik kod bilan amalga oshiriladi.</T></li>
              <li><T>To'lov ma'lumotlari (karta raqami va h.k.) qabul qilinmaydi — pul hisob-kitobi platformadan tashqarida, tomonlar o'rtasida bo'ladi.</T></li>
            </ul>
          </Sec>

          <Sec id="firebase" icon={<AlertCircle size={18} />} title="Texnik xizmatlar (Firebase)">
            <P>
              <T>
                Mobil ilova barqaror ishlashi va bildirishnomalar yetib borishi
                uchun Google Firebase xizmatlaridan foydalanadi. Ular quyidagi
                texnik ma'lumotlarni yig'adi va bu ma'lumotlar reklama yoki
                shaxsni profillash uchun ishlatilmaydi:
              </T>
            </P>
            <ul className="mt-2 space-y-1.5 text-sm muted list-disc pl-5">
              <li>
                <b className="heading">Crashlytics (xatolik hisobotlari):</b>{" "}
                <T>
                  ilova kutilmaganda yopilsa, xatolik joyi, qurilma modeli va
                  Android versiyasi kabi texnik ma'lumotlar yuboriladi — faqat
                  nosozliklarni topib tuzatish uchun.
                </T>
              </li>
              <li>
                <b className="heading">Analytics (foydalanish statistikasi):</b>{" "}
                <T>
                  qaysi ekranlar ochilgani kabi umumlashtirilgan, anonim
                  statistika — ilovani yaxshilash uchun. Bu sizning ismingiz yoki
                  telefon raqamingizga bog'lanmaydi.
                </T>
              </li>
              <li>
                <b className="heading">Cloud Messaging (push-bildirishnomalar):</b>{" "}
                <T>
                  bildirishnoma yetkazish uchun qurilmangizga beriladigan texnik
                  token serverimizda hisobingizga bog'lab saqlanadi. Hisobdan
                  chiqsangiz yoki hisobni o'chirsangiz token ham o'chiriladi.
                  Bildirishnomalarni ilova sozlamalaridan o'chirib qo'yishingiz
                  mumkin.
                </T>
              </li>
            </ul>
            <P>
              <T>
                Bu xizmatlar bo'yicha Google ma'lumotlarni o'z maxfiylik
                siyosatiga muvofiq qayta ishlaydi (policies.google.com/privacy).
              </T>
            </P>
          </Sec>

          <Sec id="use" icon={<UserCog size={18} />} title="Ma'lumotlardan foydalanish">
            <P><T>Yig'ilgan ma'lumotlar faqat quyidagilar uchun ishlatiladi:</T></P>
            <ul className="mt-2 space-y-1.5 text-sm muted list-disc pl-5">
              <li><T>Hisobingizni yaratish va Telegram orqali yuborilgan kod bilan tasdiqlash.</T></li>
              <li><T>E'lonlarni ko'rsatish va sizga eng yaqin ishlarni yuqorida chiqarish.</T></li>
              <li><T>Ish beruvchi va ishchini bog'lash — ariza va uning holati bo'yicha.</T></li>
              <li><T>Ilova ichidagi bildirishnomalarni yuborish (arizangiz qabul qilindi, bekor qilindi va h.k.).</T></li>
              <li><T>Shikoyatlarni ko'rib chiqish, qoidabuzarlik va firibgarlikning oldini olish.</T></li>
              <li><T>Platformaning umumiy statistikasini (masalan, jami e'lonlar soni) administratorlar panelida ko'rish. Bu — jamlangan sonlar, shaxsni profillash emas.</T></li>
            </ul>
          </Sec>

          <Sec id="permissions" icon={<Smartphone size={18} />} title="Android ilovasi qaysi ruxsatlarni so'raydi">
            <P>
              <T>
                Ilova beshta tizim ruxsatini e'lon qiladi va har biri aniq bir
                funksiya uchun. Ulardan faqat joylashuv va bildirishnoma
                ruxsatlari sizdan so'raladi — qolganlari "oddiy" (normal)
                toifadagi ruxsatlar bo'lib, alohida tasdiq talab qilmaydi:
              </T>
            </P>
            <ul className="mt-2 space-y-1.5 text-sm muted list-disc pl-5">
              <li>
                <b className="heading">INTERNET:</b>{" "}
                <T>serverimiz bilan bog'lanish va xarita plitalarini yuklash uchun.</T>
              </li>
              <li>
                <b className="heading">ACCESS_NETWORK_STATE:</b>{" "}
                <T>
                  internet ulanishi bor-yo'qligini bilish va uzilganda sizga
                  ogohlantirish ko'rsatish uchun. Bu ruxsat orqali hech qanday
                  ma'lumot yig'ilmaydi.
                </T>
              </li>
              <li>
                <b className="heading">ACCESS_FINE_LOCATION / ACCESS_COARSE_LOCATION:</b>{" "}
                <T>
                  ish joyini xaritada belgilash va sizga eng yaqin e'lonlarni
                  birinchi ko'rsatish uchun. Ruxsat bermasangiz ham ilova
                  ishlaydi — e'lonlar shunchaki masofa bo'yicha tartiblanmaydi.
                </T>
              </li>
              <li>
                <b className="heading">POST_NOTIFICATIONS:</b>{" "}
                <T>
                  push-bildirishnomalar ko'rsatish uchun (arizangiz qabul
                  qilindi va h.k., Android 13+ da so'raladi). Rad etsangiz ham
                  ilova to'liq ishlaydi — bildirishnomalarni ilova ichida
                  ko'raverasiz.
                </T>
              </li>
            </ul>
            <P>
              <T>
                Rasm tanlash uchun alohida ruxsat so'ralmaydi: e'longa rasm
                qo'shganingizda tizimning o'z rasm tanlash oynasi ochiladi va
                ilova faqat siz tanlagan rasmni oladi — galereyangizni ko'rib
                chiqa olmaydi.
              </T>
            </P>
            <P>
              <T>
                Bulardan tashqari Android kutubxonalari ilova ichki ehtiyoji
                uchun bitta texnik ruxsat avtomatik qo'shadi
                (DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION). U faqat ilovaning o'z
                komponentlari o'rtasida ishlaydi, hech qanday ma'lumotga kirish
                bermaydi va boshqa ilovalar undan foydalana olmaydi.
              </T>
            </P>
          </Sec>

          <Sec id="location" icon={<MapPin size={18} />} title="Joylashuv va xaritalar">
            <P>
              <T>
                Joylashuvingiz faqat ilova ochiq turganda va faqat siz so'raganda
                (xaritadan joy tanlash yoki "yaqinimdagi ishlar" tartibi uchun)
                olinadi. Bu <b className="heading">aniq joylashuv</b> (precise
                location, ACCESS_FINE_LOCATION) — ya'ni GPS koordinatalari.
                Koordinatalar serverga faqat siz e'londa ish joyini
                belgilasangiz yuboriladi — u holda ular e'lon bilan birga ochiq
                ko'rinadi. Aks holda joylashuv qurilmangizdan chiqmaydi. Fon
                rejimida (ilova yopiq turganda) joylashuv umuman olinmaydi.
              </T>
            </P>
            <P>
              <T>
                Xaritalar uchun tashqi plita (tile) xizmatlaridan foydalanamiz:
                oddiy xarita — OpenStreetMap, sun'iy yo'ldosh ko'rinishi — Esri
                (ArcGIS World Imagery). Xarita ko'rsatilganda brauzeringiz yoki
                ilovangiz to'g'ridan-to'g'ri o'sha xizmatlarga murojaat qiladi,
                shu sababli ular IP manzilingizni va qaysi hududni
                ko'rayotganingizni ko'rishi mumkin. Biz ularga ismingizni,
                telefoningizni yoki hisob ma'lumotlaringizni yubormaymiz.
              </T>
            </P>
          </Sec>

          <Sec id="storage" icon={<HardDrive size={18} />} title="Qurilmangizda nima saqlanadi">
            <P><T>Ilova quyidagilarni faqat qurilmangizning o'zida saqlaydi:</T></P>
            <ul className="mt-2 space-y-1.5 text-sm muted list-disc pl-5">
              <li>
                <b className="heading">flutter_secure_storage:</b>{" "}
                <T>
                  kirish va yangilash tokenlari (JWT). Bular Android'ning
                  shifrlangan xotirasida saqlanadi, shuning uchun har safar
                  qaytadan kirishingiz shart emas.
                </T>
              </li>
              <li>
                <b className="heading">shared_preferences:</b>{" "}
                <T>
                  profilingizning keshlangan nusxasi (ilova tez ochilishi uchun),
                  til va mavzu tanlovingiz, bildirishnoma sozlamalari va
                  tanishtiruv oynasi ko'rilgani haqidagi belgi.
                </T>
              </li>
              <li>
                <b className="heading"><T>Rasm keshi</T>:</b>{" "}
                <T>ko'rgan rasmlaringiz internetni tejash uchun vaqtincha saqlanadi.</T>
              </li>
              <li>
                <b className="heading">localStorage (<T>veb-sayt</T>):</b>{" "}
                <T>saytda kirish tokeni brauzeringizning localStorage'ida saqlanadi.</T>
              </li>
            </ul>
            <P>
              <T>
                Ilovadan chiqqaningizda yoki hisobni o'chirganingizda tokenlar va
                profil keshi qurilmangizdan tozalanadi (til va mavzu tanlovingiz
                esa keyingi safar uchun qoladi). Ilovani o'chirib tashlasangiz,
                bularning hammasi qurilmangizdan yo'qoladi. Bu ma'lumotlar
                reklama uchun ishlatilmaydi va hech kimga uzatilmaydi.
              </T>
            </P>
          </Sec>

          <Sec id="share" icon={<Share2 size={18} />} title="Uchinchi shaxslar bilan bo'lishish">
            <P>
              <T>
                Biz shaxsiy ma'lumotlaringizni sotmaymiz va reklama maqsadida
                hech kimga bermaymiz. Ma'lumot faqat quyidagi hollarda va faqat
                zaruriy doirada oshkor bo'ladi:
              </T>
            </P>
            <ul className="mt-2 space-y-1.5 text-sm muted list-disc pl-5">
              <li>
                <b className="heading"><T>Boshqa foydalanuvchilar bilan</T>:</b>{" "}
                <T>
                  ismingiz, viloyat/tumaningiz, bio, ko'nikmalaringiz va
                  avataringiz ochiq profilingizda ko'rinadi. Ariza
                  topshirganingizda telefon raqamingiz e'lon egasiga ko'rsatiladi;
                  e'londa ko'rsatilgan aloqa raqami esa e'lonni ko'rgan
                  foydalanuvchilarga ochiq bo'ladi.
                </T>
              </li>
              <li>
                <b className="heading">Telegram:</b>{" "}
                <T>
                  kirish kodi va hisobni o'chirish kodi Telegram bot orqali
                  yuboriladi. Qo'llab-quvvatlash akkauntimizga yozgan
                  xabarlaringiz (matn, ovozli xabar, rasm) Telegram orqali o'tadi
                  va Telegram serverlarida hamda sizning Telegram'ingizdagi suhbat
                  tarixida qoladi — biz ularni saqlamaymiz. Telegram'ning o'z
                  maxfiylik siyosati amal qiladi.
                </T>
              </li>
              <li>
                <b className="heading">OpenStreetMap, Esri:</b>{" "}
                <T>xarita ko'rsatilganda IP manzilingiz ularga ko'rinadi (yuqoriga qarang).</T>
              </li>
              <li>
                <b className="heading">Nominatim (OpenStreetMap):</b>{" "}
                <T>
                  e'longa xaritadan ish joyini belgilasangiz, serverimiz o'sha
                  koordinatalarni Nominatim xizmatiga yuboradi — viloyat va
                  tuman nomini aniqlash uchun. Faqat koordinatalar yuboriladi:
                  ism, telefon yoki hisob ma'lumotlaringiz emas.
                </T>
              </li>
              <li>
                <b className="heading"><T>Xarita ilovalari</T> (Google Maps <T>va boshqalar</T>):</b>{" "}
                <T>
                  e'londagi "yo'nalish" tugmasini bosganingizda ish joyi
                  koordinatalari qurilmangizdagi xarita ilovasiga uzatiladi. Bu
                  faqat siz tugmani bosganingizda sodir bo'ladi va o'sha
                  ilovaning maxfiylik siyosati amal qiladi.
                </T>
              </li>
              <li>
                <b className="heading">Hetzner:</b>{" "}
                <T>
                  serverimiz Hetzner'ning Germaniyadagi ma'lumot markazida
                  joylashgan; ma'lumotlar bazasi va yuklangan rasmlar ham
                  o'sha serverda saqlanadi. Hetzner bizning nomimizdan,
                  bizning ko'rsatmamiz bilan ma'lumotni saqlaydi.
                </T>
              </li>
              <li>
                <b className="heading">Google Play:</b>{" "}
                <T>
                  ilovani Google Play orqali o'rnatasiz. Google ilova
                  o'rnatilishi bilan bog'liq ma'lumotni o'zi to'playdi — bunga
                  Google'ning siyosati amal qiladi va bu ma'lumot bizga
                  yuborilmaydi.
                </T>
              </li>
              <li>
                <b className="heading"><T>Qonuniy talab asosida</T>:</b>{" "}
                <T>vakolatli davlat organining rasmiy so'rovi bo'yicha.</T>
              </li>
            </ul>
          </Sec>

          <Sec id="security" icon={<Lock size={18} />} title="Xavfsizlik choralari">
            <P>
              <T>
                Ilova va sayt server bilan faqat HTTPS orqali, shifrlangan
                aloqada ishlaydi. Ma'lumotlar MongoDB ma'lumotlar bazasida
                saqlanadi. Kirish JWT tokenlari orqali tekshiriladi va tokenlar
                qurilmangizning shifrlangan xotirasida turadi.
              </T>
            </P>
            <P>
              <T>
                Hisobingizga kirish uchun parol yo'q — har safar Telegram'ga
                yuboriladigan bir martalik kod ishlatiladi va u 3 daqiqadan keyin
                kuchini yo'qotadi. Hisobni o'chirish ham alohida kod bilan
                tasdiqlanadi, shuning uchun ochiq qolgan qurilma hisobingizni
                o'chira olmaydi. Kodni bir necha marta xato kiritilsa, u
                bloklanadi; so'rovlar soni IP bo'yicha cheklanadi.
              </T>
            </P>
            <P>
              <T>
                Administrator hisoblari alohida himoyalangan: parollar bcrypt
                bilan xeshlanadi va ikki bosqichli tasdiqlash (TOTP) mavjud.
                Shunga qaramay, hech bir tizim 100% xavfsiz emas — sizga kelgan
                kodlarni hech kim bilan baham ko'rmang.
              </T>
            </P>
          </Sec>

          <Sec id="retention" icon={<Clock size={18} />} title="Ma'lumotlar qancha saqlanadi">
            <P>
              <T>
                Har bir ma'lumot turi uchun aniq muddat belgilangan va u server
                tomonida avtomatik bajariladi:
              </T>
            </P>
            <div className="mt-3 overflow-x-auto">
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

          <Sec id="delete" icon={<Trash2 size={18} />} title="Hisobni o'chirish">
            <P>
              <T>
                Hisobingizni istalgan paytda o'zingiz o'chirishingiz mumkin:
                ilovada Profil → Sozlamalar → «Hisobni o'chirish», yoki saytda
                shu bo'limdan. Tasdiqlash uchun Telegram'ga bir martalik kod
                yuboriladi.
              </T>
            </P>
            <P>
              <T>
                Tasdiqlaganingizdan so'ng hisob darhol ishlamay qoladi,
                e'lonlaringiz ro'yxatdan olinadi, faol arizalar bekor qilinadi,
                rasmlaringiz o'chiriladi, telefon raqamingiz va Telegram
                identifikatoringiz esa darhol bo'shatiladi. Qolgan barcha shaxsiy
                yozuvlar
              </T>{" "}
              <b className="heading">{RETENTION_DAYS} <T>kundan keyin butunlay o'chiriladi</T></b>{" "}
              <T>
                — buni server avtomatik bajaradi.
              </T>
            </P>
            <P>
              <T>
                Qo'llab-quvvatlash uchun Telegram akkauntimizga yozgan
                xabarlaringiz bizning bazamizda saqlanmaydi — ular Telegram'da
                turadi. Ularni istalgan payt Telegram'dagi suhbatni o'zingiz
                o'chirib tashlashingiz orqali olib tashlashingiz mumkin.
              </T>
            </P>
            <P>
              <T>
                Ilovaga kira olmasangiz ham o'chirishni so'rashingiz mumkin.
                To'liq tartib, nima o'chishi va nima qancha saqlanishi alohida
                sahifada batafsil yozilgan:
              </T>{" "}
              <Link href="/delete-account" className="underline heading">
                <T>Hisobni o'chirish sahifasi</T>
              </Link>.
            </P>
          </Sec>

          <Sec id="rights" icon={<ShieldCheck size={18} />} title="Sizning huquqlaringiz">
            <P><T>Sizda quyidagi huquqlar mavjud:</T></P>
            <ul className="mt-2 space-y-1.5 text-sm muted list-disc pl-5">
              <li><T>Profilingizdagi ma'lumotlarni ko'rish va istalgan paytda tahrirlash.</T></li>
              <li><T>E'loningizni o'chirish — u bazadan darhol va butunlay o'chadi.</T></li>
              <li><T>Hisobingizni o'chirish (yuqoridagi bo'limga qarang).</T></li>
              <li><T>Joylashuv ruxsatini tizim sozlamalaridan istalgan paytda qaytarib olish.</T></li>
              <li><T>Boshqa foydalanuvchini bloklash yoki uning ustidan shikoyat qilish.</T></li>
              <li><T>Ma'lumotlaringiz nusxasini so'rash — quyidagi manzillarga murojaat qiling, so'rovni 30 kun ichida bajaramiz.</T></li>
            </ul>
          </Sec>

          <Sec id="children" icon={<Baby size={18} />} title="Bolalar maxfiyligi">
            <P>
              <T>
                Platforma 18 yoshdan kichik foydalanuvchilarga mo'ljallanmagan va
                ular uchun jalb qilinmaydi. Agar bolaning ma'lumoti tasodifan
                yig'ilgani aniqlansa, biz uni o'chiramiz.
              </T>
            </P>
          </Sec>

          <Sec id="changes" icon={<RefreshCw size={18} />} title="Siyosatga o'zgartirishlar">
            <P>
              <T>
                Ushbu siyosat vaqti-vaqti bilan yangilanishi mumkin. Sahifaning
                yuqorisida oxirgi yangilangan sana ko'rsatiladi. Muhim
                o'zgarishlar bo'lganda sizni ilova ichidagi bildirishnoma orqali
                xabardor qilamiz.
              </T>
            </P>
          </Sec>

          <Sec id="contact" icon={<Mail size={18} />} title="Biz bilan bog'lanish">
            <P><T>Maxfiylik bo'yicha savol yoki so'rovlaringiz uchun:</T></P>
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
              <T>Bu siyosatni o'qib chiqqaningiz uchun rahmat. Bizning maqsadimiz — sizning ma'lumotlaringizni xavfsiz saqlash.</T>
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
          <div className="flex md:justify-end flex-wrap gap-5 muted">
            <Link href="/biz-haqimizda"><T>Biz haqimizda</T></Link>
            <Link href="/maxfiylik-siyosati" className="heading"><T>Maxfiylik siyosati</T></Link>
            <Link href="/foydalanish-shartlari"><T>Foydalanish shartlari</T></Link>
            <Link href="/delete-account"><T>Hisobni o'chirish</T></Link>
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
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-navy text-white shrink-0">{icon}</span>
        <T>{title}</T>
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-relaxed muted mt-2 first:mt-0">{children}</p>;
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="card p-4 flex gap-3" style={{ background: "rgba(232,146,10,0.08)" }}>
      <AlertCircle size={18} className="text-accent-amber shrink-0 mt-0.5" />
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
