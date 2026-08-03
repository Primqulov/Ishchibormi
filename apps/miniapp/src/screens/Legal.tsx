/**
 * Maxfiylik siyosati va Foydalanish shartlari.
 *
 * MUHIM QAROR: to'liq huquqiy matn bu yerga KO'CHIRILMAGAN.
 *
 * Sabab — bu hujjatlarning yagona manbai bo'lishi shart. Repo allaqachon shu
 * muammoni biladi: saqlash muddati apps/web/lib/retention.ts da bitta joyda
 * turadi va backend bilan mos bo'lishi SHART (PLAY_COMPLIANCE.md). Agar
 * huquqiy matnning ikkinchi nusxasi Mini App'da yashasa, saytdagisi
 * yangilanganda bu yerdagisi eskirib qoladi va foydalanuvchiga ikki xil
 * va'da beriladi — bu Google Play siyosati buzilishi ham, huquqiy xavf ham.
 *
 * Shuning uchun bu yerda asosiy bandlar qisqacha, to'liq matn esa saytdagi
 * doim yangi versiyada ochiladi.
 */

import { ExternalIcon, ShieldIcon, FileTextIcon } from "@/components/icons";
import { haptic, openExternal } from "@/lib/telegram";

const SITE = "https://ishchibormi.uz";

type Point = { title: string; body: string };

const PRIVACY: Point[] = [
  {
    title: "Qanday ma'lumot yig'amiz",
    body: "Ism, telefon raqami va Telegram hisobingiz identifikatori; e'lon va arizalaringiz; siz yuklagan rasmlar; e'lon joyi koordinatasi (agar o'zingiz belgilasangiz).",
  },
  {
    title: "Nima uchun kerak",
    body: "Ish beruvchi va ishchining bir-biri bilan bog'lanishi uchun. Telefon raqami faqat ariza qabul qilingandan keyin ikkinchi tomonga ochiladi.",
  },
  {
    title: "Kim ko'radi",
    body: "Ochiq e'lonlaringiz hammaga ko'rinadi. Telefon raqamingiz esa faqat siz bilan ish qilayotgan tomonga ochiladi — ro'yxatda ko'rinmaydi.",
  },
  {
    title: "Hisobni o'chirish",
    body: "Hisobni istalgan vaqtda o'chirishingiz mumkin. O'chirilgandan so'ng ma'lumotlar belgilangan muddat davomida tiklanadigan holatda turadi, keyin butunlay yo'q qilinadi. Aniq muddat to'liq matnda ko'rsatilgan.",
  },
];

const TERMS: Point[] = [
  {
    title: "Platformaning roli",
    body: "Ishchi Bormi ish beruvchi va ishchini bog'laydigan maydon. Ish shartlari, to'lov va bajarilishi uchun javobgarlik tomonlarning o'zida.",
  },
  {
    title: "E'lon berish qoidalari",
    body: "E'lon haqiqiy ish haqida bo'lishi, narx va shartlar to'g'ri ko'rsatilishi kerak. Yolg'on, haqoratli yoki qonunga zid e'lonlar o'chiriladi.",
  },
  {
    title: "Ariza va kelishuv",
    body: "Ariza yuborish taklif hisoblanadi. Ish beruvchi uni qabul qilgach, tomonlar kelishilgan shart bo'yicha ish bajarilishini kutadi.",
  },
  {
    title: "Hisobni cheklash",
    body: "Qoidalarni buzgan hisoblar ogohlantirishsiz bloklanishi mumkin.",
  },
];

export function Legal({ kind }: { kind: "privacy" | "terms" }) {
  const privacy = kind === "privacy";
  const points = privacy ? PRIVACY : TERMS;
  const href = privacy ? `${SITE}/maxfiylik-siyosati` : `${SITE}/foydalanish-shartlari`;

  return (
    <div className="flex flex-col gap-5 px-4 pb-6 pt-4 animate-fade-in">
      <div className="flex items-start gap-3">
        <span
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl"
          style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
        >
          {privacy ? <ShieldIcon size={20} /> : <FileTextIcon size={20} />}
        </span>
        <p className="flex-1 text-[14px] leading-relaxed muted">
          {privacy
            ? "Qisqacha: qanday ma'lumot yig'amiz va u kimga ko'rinadi."
            : "Qisqacha: platformadan foydalanish qoidalari."}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {points.map((p) => (
          <section key={p.title} className="card p-4">
            <h2 className="text-[16px] font-semibold heading">{p.title}</h2>
            <p className="mt-1.5 text-[14px] leading-relaxed muted">{p.body}</p>
          </section>
        ))}
      </div>

      {/* To'liq matn — doim saytdagi eng yangi versiya.
          Nusxa ko'chirilmaganining sababi fayl boshidagi izohda. */}
      <button
        type="button"
        onClick={() => {
          haptic.tap();
          openExternal(href);
        }}
        className="btn-outline w-full"
      >
        <ExternalIcon size={16} />
        To'liq matnni o'qish
      </button>

      <p className="text-center text-[12px] subtle">
        Bu yerda qisqacha bayon berilgan. Yuridik kuchga ega to'liq matn saytda.
      </p>
    </div>
  );
}
