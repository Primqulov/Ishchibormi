/**
 * Sozlamalar — Figma maketidagi "Sozlamalar sahifasi".
 *
 * Maketdagi ikkita boshqaruv Mini App'da BOSHQACHA ishlaydi va buni
 * foydalanuvchiga aytib qo'yish kerak:
 *
 *  - **Til**. Mobil ilovada til ilova ichida tanlanadi. Mini App esa
 *    Telegram'ning tilini oladi (`language_code`), chunki foydalanuvchi
 *    allaqachon Telegram'da tilni tanlagan — ikkinchi marta so'rash ortiqcha.
 *  - **Mavzu (kun/tun)**. Telegram beradi; ilova ichida almashtirgich qo'yish
 *    Telegram bilan qarama-qarshi holat yaratardi.
 *
 * Shuning uchun ular ko'rsatiladi, lekin faqat o'qish uchun.
 */

import {
  GlobeIcon,
  BellIcon,
  FileTextIcon,
  ShieldIcon,
  TrashIcon,
  HelpIcon,
  ChevronRightIcon,
} from "@/components/icons";
import { haptic, openExternal, tg } from "@/lib/telegram";

const SITE = "https://ishchibormi.uz";

const LANG_LABEL: Record<string, string> = {
  uz: "O'zbek tili",
  ru: "Русский",
  en: "English",
};

export function Settings({
  onTerms,
  onPrivacy,
  onHelp,
}: {
  onTerms: () => void;
  onPrivacy: () => void;
  onHelp: () => void;
}) {
  // Telegram foydalanuvchining tilini initData ichida beradi; u yerdan
  // o'qish uchun `user` maydonini parse qilish kerak emas — SDK'ning
  // o'zi ham bermaydi, shuning uchun oddiy zaxira.
  const lang = (navigator.language || "uz").slice(0, 2);
  const dark = tg?.colorScheme === "dark";

  return (
    <div className="flex flex-col gap-5 px-4 pb-6 pt-4 animate-fade-in">
      <Group title="Akkaunt">
        <Row
          icon={<GlobeIcon size={18} />}
          label="Til"
          value={LANG_LABEL[lang] || "O'zbek tili"}
          hint="Telegram tilidan olinadi"
        />
        <Row
          icon={<BellIcon size={18} />}
          label="Bildirishnomalar"
          value="Yoqilgan"
          hint="Telegram orqali keladi"
        />
        <Row
          icon={<ShieldIcon size={18} />}
          label="Mavzu"
          value={dark ? "Tungi" : "Kunduzgi"}
          hint="Telegram sozlamasiga ergashadi"
          last
        />
      </Group>

      <Group title="Qo'llab-quvvatlash">
        <Row
          icon={<HelpIcon size={18} />}
          label="Yordam markazi"
          onClick={onHelp}
        />
        <Row
          icon={<FileTextIcon size={18} />}
          label="Foydalanish shartlari"
          onClick={onTerms}
        />
        <Row
          icon={<ShieldIcon size={18} />}
          label="Maxfiylik siyosati"
          onClick={onPrivacy}
          last
        />
      </Group>

      {/* Hisobni o'chirish — maketdagidek qizil blokda.
          Amalning o'zi saytda: u tasdiqlash kodini talab qiladi va
          qaytarib bo'lmaydi, shuning uchun to'liq oqim bitta joyda
          (saytda va mobil ilovada) saqlanadi. */}
      <button
        type="button"
        onClick={() => {
          haptic.tap();
          openExternal(`${SITE}/delete-account`);
        }}
        className="flex w-full items-center gap-3 rounded-2xl px-4 py-4 text-left transition active:scale-[0.99]"
        style={{ background: "#FEF3F2", border: "1px solid #FEE4E2" }}
      >
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
          style={{ background: "#FEE4E2", color: "#B42318" }}
        >
          <TrashIcon size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold" style={{ color: "#B42318" }}>
            Hisobni o'chirish
          </span>
          <span className="block text-[12px]" style={{ color: "#B42318", opacity: 0.75 }}>
            Saytda ochiladi — tasdiqlash kodi kerak
          </span>
        </span>
        <span style={{ color: "#B42318" }}>
          <ChevronRightIcon size={18} />
        </span>
      </button>

      <p className="pt-2 text-center text-[12px] subtle">Ishchi Bormi · Mini App</p>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2
        className="px-1 text-[13px] font-semibold"
        style={{ color: "var(--brand)" }}
      >
        {title}
      </h2>
      <div className="card overflow-hidden">{children}</div>
    </section>
  );
}

function Row({
  icon,
  label,
  value,
  hint,
  onClick,
  last,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  hint?: string;
  onClick?: () => void;
  last?: boolean;
}) {
  const inner = (
    <>
      <span className="shrink-0 subtle">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium heading">{label}</span>
        {hint && <span className="block text-[11.5px] subtle">{hint}</span>}
      </span>
      {value && <span className="shrink-0 text-[13.5px] muted">{value}</span>}
      {onClick && <ChevronRightIcon size={18} className="shrink-0 subtle" />}
    </>
  );

  const cls = "flex w-full items-center gap-3 px-4 py-3.5 text-left";
  const style = last ? undefined : { borderBottom: "1px solid var(--border)" };

  // Bosilmaydigan qator tugma bo'lmasligi kerak — ekran o'quvchi uni
  // "bosiladi" deb e'lon qilib, foydalanuvchini chalg'itardi.
  if (!onClick) {
    return (
      <div className={cls} style={style}>
        {inner}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        haptic.tap();
        onClick();
      }}
      className={`${cls} transition active:scale-[0.99]`}
      style={style}
    >
      {inner}
    </button>
  );
}
