/**
 * Yordam markazi — Figma maketidagi "Yordam markazi sahifasi".
 *
 * Savol-javoblar apps/web/app/(public)/yordam/page.tsx dan olingan: matn
 * bir mahsulot uchun bitta bo'lishi kerak, aks holda saytda bir javob,
 * ilovada boshqasi turadi. Mini App kontekstiga tegishli bo'lmagan
 * bandlar (sayt navigatsiyasi haqidagilar) qisqartirildi.
 */

import { useState } from "react";
import {
  ChevronDownIcon,
  HelpIcon,
  MessageIcon,
  SearchIcon,
} from "@/components/icons";
import { haptic, openTelegramLink } from "@/lib/telegram";

const SUPPORT = "Ishchi_bormi_support";

type FAQ = { q: string; a: string };

const CATEGORIES: { id: string; label: string; items: FAQ[] }[] = [
  {
    id: "auth",
    label: "Kirish va ro'yxatdan o'tish",
    items: [
      {
        q: "Mini App'ga qanday kiraman?",
        a: "Agar Telegram hisobingiz allaqachon ro'yxatdan o'tgan bo'lsa, ilova ochilishi bilan o'zi kiradi — hech narsa bosish kerak emas. Birinchi marta esa telefon raqamingizni ulashish so'raladi: bot ochiladi, «Telefon raqamni ulashish» tugmasini bosasiz va bot bergan 6 xonali kodni kiritasiz.",
      },
      {
        q: "Nega telefon raqami kerak?",
        a: "Telegram ilovaga telefon raqamini bermaydi, platformada esa u majburiy — ish beruvchi ishchi bilan aynan shu raqam orqali bog'lanadi. Shuning uchun bir marta botda kontakt ulashiladi.",
      },
      {
        q: "Kod «noto'g'ri yoki muddati o'tgan» deyapti.",
        a: "Kod qisqa muddat amal qiladi. Yangi kod olish uchun botda /start tugmasini qaytadan bosing va raqamni qayta ulashing.",
      },
    ],
  },
  {
    id: "jobs",
    label: "Ish qidirish va ariza",
    items: [
      {
        q: "Ishga qanday ariza beraman?",
        a: "E'lonni oching va pastdagi «Ariza yuborish» tugmasini bosing. Arizangiz ish beruvchiga boradi, javobi esa Profil → Arizalarim bo'limida ko'rinadi.",
      },
      {
        q: "Ariza berganimdan keyin nima bo'ladi?",
        a: "Ish beruvchi arizangizni ko'rib chiqadi. Qabul qilsa sizga bildirishnoma keladi va u siz bilan telefon orqali bog'lanadi. Ish tugagach ikkalangiz ham «Ishni bajardim» tugmasi bilan tasdiqlaysiz.",
      },
      {
        q: "Arizani bekor qila olamanmi?",
        a: "Ha. Profil → Arizalarim bo'limida «Arizani bekor qilish» tugmasi bor. Ish beruvchi allaqachon qabul qilgan bo'lsa, uni oldindan ogohlantiring.",
      },
    ],
  },
  {
    id: "post",
    label: "E'lon berish",
    items: [
      {
        q: "Yangi e'lon qanday yarataman?",
        a: "Pastdagi ko'k «+» tugmasini bosing. Ish nomi, turkum, tavsif, ishchilar soni, to'lov, sana-vaqt va ish joyini kiriting. Saqlaganingizdan so'ng e'lon darhol ro'yxatda ko'rinadi.",
      },
      {
        q: "Nega ish sanasini uzoqqa qo'ya olmayapman?",
        a: "Platforma kunlik ishlar uchun: ish sanasi eng ko'pi 3 kun ichida bo'lishi mumkin — bugun, ertaga yoki indinga. Bu ro'yxatdagi e'lonlar dolzarb bo'lib turishini ta'minlaydi.",
      },
      {
        q: "Kelgan arizalarni qayerdan ko'raman?",
        a: "Profil → Nomzodlar bo'limida. U yerda har e'lon bo'yicha arizalar guruhlangan; qabul qilganingizdan keyin ishchining telefon raqami ochiladi.",
      },
    ],
  },
];

export function HelpCenter() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const needle = q.trim().toLowerCase();
  const shown = CATEGORIES.map((c) => ({
    ...c,
    items: needle
      ? c.items.filter(
          (i) => i.q.toLowerCase().includes(needle) || i.a.toLowerCase().includes(needle),
        )
      : c.items,
  })).filter((c) => c.items.length > 0);

  return (
    <div className="flex flex-col gap-5 px-4 pb-6 pt-4 animate-fade-in">
      <div className="search-pill">
        <SearchIcon size={18} className="shrink-0 subtle" />
        <input
          placeholder="Savolingizni qidiring..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          type="search"
          aria-label="Savol qidirish"
        />
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <span className="subtle">
            <HelpIcon size={26} />
          </span>
          <p className="text-[15px] font-semibold heading">Javob topilmadi</p>
          <p className="max-w-[280px] text-[13px] muted">
            Savolingizni boshqacha yozib ko'ring yoki pastdagi tugma orqali bizga yozing.
          </p>
        </div>
      ) : (
        shown.map((c) => (
          <section key={c.id} className="flex flex-col gap-2">
            <h2 className="px-1 text-[13px] font-semibold" style={{ color: "var(--brand)" }}>
              {c.label}
            </h2>
            <div className="card overflow-hidden">
              {c.items.map((item, i) => {
                const key = `${c.id}-${i}`;
                const on = open === key;
                return (
                  <div
                    key={key}
                    style={
                      i === c.items.length - 1
                        ? undefined
                        : { borderBottom: "1px solid var(--border)" }
                    }
                  >
                    <button
                      type="button"
                      onClick={() => {
                        haptic.select();
                        setOpen(on ? null : key);
                      }}
                      aria-expanded={on}
                      className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
                    >
                      <span className="min-w-0 flex-1 text-[15px] font-medium leading-5 heading">
                        {item.q}
                      </span>
                      <span
                        className="shrink-0 subtle transition-transform"
                        style={{ transform: on ? "rotate(180deg)" : undefined }}
                      >
                        <ChevronDownIcon size={18} />
                      </span>
                    </button>
                    {on && (
                      <p className="px-4 pb-4 text-[14px] leading-relaxed muted animate-fade-in">
                        {item.a}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}

      <button
        type="button"
        onClick={() => {
          haptic.tap();
          openTelegramLink(`https://t.me/${SUPPORT}`);
        }}
        className="btn-primary w-full"
      >
        <MessageIcon size={16} />
        Javob topilmadimi? Bizga yozing
      </button>
    </div>
  );
}
