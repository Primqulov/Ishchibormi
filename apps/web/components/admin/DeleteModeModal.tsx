"use client";
import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";

export type DeleteMode = "hidden" | "purge";

/** Bazadan o'chirishni tasdiqlash uchun yoziladigan so'z. */
const CONFIRM_WORD = "O'CHIRISH";

/**
 * O'chirish oynasi — ikki xil o'chirishni ANIQ ajratib ko'rsatadi.
 *
 * # NEGA ALOHIDA KOMPONENT
 *
 * Foydalanuvchilar va e'lonlar sahifalarida bir xil qaror qabul qilinadi.
 * Ikki joyda ikki xil matn yoki ikki xil ogohlantirish bo'lsa, adminning
 * "bu tugma nima qiladi?" degan tasavvuri joyiga qarab o'zgarardi — bu esa
 * qaytarib bo'lmaydigan amalda xavfli.
 *
 * # NEGA YOZIB TASDIQLASH
 *
 * "Bazadan butunlay o'chirish" qaytarilmaydi va zaxira nusxa ham yo'q.
 * Oddiy "Ha" tugmasi tasodifiy bosishdan himoya qilmaydi: admin ro'yxatni
 * tozalayotganda bir xil harakatni o'nlab marta takrorlaydi va qo'l
 * avtomatik ravishda tasdiqlab yuboradi. So'zni yozish esa harakatni
 * to'xtatib, diqqatni qaratadi.
 *
 * Bu server tomonidagi himoyaning O'RNINI BOSMAYDI — u yerda rol tekshiruvi
 * alohida turadi (deletemode.go). Bu shunchaki tasodifga qarshi to'siq.
 */
export function DeleteModeModal({
  open,
  title,
  what,
  canPurge,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  /** Oyna sarlavhasi, masalan "Foydalanuvchini o'chirish". */
  title: string;
  /** Nima o'chirilayotgani — matn ichida ishlatiladi ("e'lon", "foydalanuvchi"). */
  what: string;
  /** Faqat superadmin bazadan o'chira oladi. */
  canPurge: boolean;
  busy?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: (mode: DeleteMode) => void;
}) {
  const [mode, setMode] = useState<DeleteMode>("hidden");
  const [typed, setTyped] = useState("");

  // Oyna har ochilganda boshlang'ich holatga qaytadi. Aks holda oldingi
  // safar "purge" tanlangani va yozilgan tasdiq saqlanib qolib, keyingi
  // o'chirish bir bosishda bazadan o'chib ketardi.
  useEffect(() => {
    if (open) {
      setMode("hidden");
      setTyped("");
    }
  }, [open]);

  const purgeReady = mode !== "purge" || typed.trim().toUpperCase() === CONFIRM_WORD;

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      maxWidth="max-w-lg"
      footer={
        <>
          <button onClick={onCancel} className="btn-secondary" disabled={busy}>
            Bekor qilish
          </button>
          <button
            onClick={() => onConfirm(mode)}
            className="btn-danger"
            disabled={busy || !purgeReady}
          >
            {busy
              ? "Bajarilmoqda…"
              : mode === "purge"
                ? "Bazadan butunlay o'chirish"
                : "Foydalanuvchilardan olib tashlash"}
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        <label
          className={`rounded-xl border p-3 cursor-pointer ${
            mode === "hidden" ? "border-brand-navy bg-black/5" : "border-black/10"
          }`}
        >
          <div className="flex items-start gap-2">
            <input
              type="radio"
              className="mt-1"
              checked={mode === "hidden"}
              onChange={() => setMode("hidden")}
            />
            <div>
              <div className="font-semibold text-sm">Foydalanuvchilardan olib tashlash</div>
              <p className="text-sm muted mt-1">
                Bu {what} foydalanuvchilarga umuman ko&apos;rinmaydi — na qidiruvda, na
                ro&apos;yxatda, na to&apos;g&apos;ridan-to&apos;g&apos;ri havola orqali. Admin panelida esa
                &laquo;o&apos;chirilgan&raquo; belgisi bilan ko&apos;rinib turadi va bazada saqlanadi.
              </p>
              <p className="text-sm mt-1 text-[color:var(--text-muted)]">
                Rasmlar o&apos;chiriladi: ular ommaviy manzilda yotadi va qoldirilsa,
                havolani bilgan odam ularni baribir ocha olardi.
              </p>
              <p className="text-sm mt-1 text-danger">
                Qaytarib bo&apos;lmaydi — bu e&apos;lonlar ro&apos;yxatidagi &laquo;Yashirish&raquo;
                tugmasi emas, u qaytariladi.
              </p>
            </div>
          </div>
        </label>

        {canPurge && (
          <label
            className={`rounded-xl border p-3 cursor-pointer ${
              mode === "purge" ? "border-danger bg-danger/5" : "border-black/10"
            }`}
          >
            <div className="flex items-start gap-2">
              <input
                type="radio"
                className="mt-1"
                checked={mode === "purge"}
                onChange={() => setMode("purge")}
              />
              <div>
                <div className="font-semibold text-sm text-danger">
                  Bazadan butunlay o&apos;chirish
                </div>
                <p className="text-sm muted mt-1">
                  Yozuv bazadan yo&apos;q qilinadi. Adminga ham ko&apos;rinmaydi, bog&apos;liq
                  arizalar va bildirishnomalar ham o&apos;chadi.
                </p>
                <p className="text-sm mt-1 text-danger">
                  Qaytarib bo&apos;lmaydi va zaxira nusxa yo&apos;q.
                </p>
              </div>
            </div>
          </label>
        )}

        {mode === "purge" && (
          <div className="grid gap-1">
            <label className="text-sm">
              Tasdiqlash uchun <span className="font-mono font-semibold">{CONFIRM_WORD}</span> deb
              yozing:
            </label>
            <input
              className="input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={CONFIRM_WORD}
              autoFocus
            />
          </div>
        )}

        {!canPurge && (
          <p className="text-sm muted">
            Bazadan butunlay o&apos;chirishni faqat superadmin bajara oladi.
          </p>
        )}

        {error && <div className="text-sm text-danger">{error}</div>}
      </div>
    </Modal>
  );
}
