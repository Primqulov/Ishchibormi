/**
 * Profilni tahrirlash.
 *
 * Telefon raqami bu yerda YO'Q: u Telegram kontakti orqali tasdiqlanadi va
 * o'zgartirish qayta tasdiqlashni talab qiladi (OTP oqimi). Uni oddiy matn
 * maydoni qilib qo'yish tasdiqlangan raqam degan kafolatni yo'q qilardi.
 *
 * Avatar tanlangan zahoti yuklanadi va darhol ko'rinadi — "Saqlash"ni
 * kutmaydi, chunki rasm to'g'ri tushganini foydalanuvchi ko'rishi kerak.
 */

import { useEffect, useRef, useState } from "react";
import { EditIcon, XIcon, PlusIcon } from "@/components/icons";
import { Avatar } from "@/components/ui";
import { alertUser, haptic, showMainButton } from "@/lib/telegram";
import { updateMe, uploadFile, type APIError, type User } from "@/lib/api";

/** apps/web/lib/regions.ts dagi ro'yxat bilan bir xil bo'lishi kerak. */
const REGIONS = [
  "Toshkent", "Samarqand", "Buxoro", "Farg'ona", "Namangan", "Andijon",
  "Qashqadaryo", "Surxondaryo", "Xorazm", "Navoiy", "Jizzax", "Sirdaryo",
];

const MAX_SKILLS = 10;

export function ProfileEdit({
  me,
  onSaved,
  onClose,
}: {
  me: User;
  onSaved: (u: User) => void;
  onClose: () => void;
}) {
  const [firstName, setFirstName] = useState(me.firstName || "");
  const [lastName, setLastName] = useState(me.lastName || "");
  const [bio, setBio] = useState(me.bio || "");
  const [region, setRegion] = useState(me.region || "");
  const [district, setDistrict] = useState(me.district || "");
  const [skills, setSkills] = useState<string[]>(me.skills || []);
  const [skillDraft, setSkillDraft] = useState("");
  const [avatarUrl, setAvatarUrl] = useState(me.avatarUrl || "");

  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const valid = firstName.trim().length >= 2;

  useEffect(() => {
    return showMainButton(
      saving ? "Saqlanmoqda..." : "Saqlash",
      () => void save(),
      { disabled: !valid || saving || uploading, loading: saving },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid, saving, uploading, firstName, lastName, bio, region, district, skills, avatarUrl]);

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const updated = await updateMe({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        bio: bio.trim(),
        region: region || undefined,
        district: district.trim() || undefined,
        skills,
        avatarUrl: avatarUrl || undefined,
      });
      haptic.success();
      onSaved(updated);
    } catch (e) {
      haptic.error();
      alertUser((e as APIError).message || "Saqlanmadi. Qayta urinib ko'ring.");
    } finally {
      setSaving(false);
    }
  }

  async function pickAvatar(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      const { url } = await uploadFile(f, "avatar");
      setAvatarUrl(url);
      haptic.success();
    } catch (e) {
      haptic.error();
      alertUser((e as APIError).message || "Rasm yuklanmadi.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function addSkill() {
    const s = skillDraft.trim();
    if (!s) return;
    if (skills.length >= MAX_SKILLS) {
      alertUser(`Eng ko'pi ${MAX_SKILLS} ta ko'nikma.`);
      return;
    }
    // Takrorni katta-kichik harfga qaramasdan tekshiramiz.
    if (skills.some((x) => x.toLowerCase() === s.toLowerCase())) {
      setSkillDraft("");
      return;
    }
    haptic.tap();
    setSkills((prev) => [...prev, s]);
    setSkillDraft("");
  }

  return (
    <div className="flex flex-col gap-5 px-4 pb-6 pt-4 animate-fade-in">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-[22px] font-black leading-tight tracking-[-0.4px] heading">
          Profilni tahrirlash
        </h1>
        <button
          type="button"
          onClick={() => {
            haptic.tap();
            onClose();
          }}
          aria-label="Yopish"
          className="btn-ghost !min-h-[36px] shrink-0 !px-2"
        >
          <XIcon size={20} />
        </button>
      </div>

      {/* Avatar */}
      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={() => {
            haptic.tap();
            fileInput.current?.click();
          }}
          disabled={uploading}
          className="relative transition active:scale-95"
          aria-label="Profil rasmini o'zgartirish"
        >
          <Avatar src={avatarUrl} firstName={firstName} lastName={lastName} size={96} />
          <span
            className="absolute bottom-0 right-0 grid h-8 w-8 place-items-center rounded-full text-white"
            style={{ background: "var(--brand)", border: "2.5px solid var(--card)" }}
          >
            <EditIcon size={14} />
          </span>
        </button>
        <p className="text-[12px] subtle">
          {uploading ? "Yuklanmoqda..." : "Rasmni o'zgartirish uchun bosing"}
        </p>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(e) => void pickAvatar(e.target.files)}
        />
      </div>

      <Field label="Ism">
        <input
          className="input"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          maxLength={60}
          placeholder="Ismingiz"
        />
      </Field>

      <Field label="Familiya">
        <input
          className="input"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          maxLength={60}
          placeholder="Familiyangiz"
        />
      </Field>

      <Field label="Viloyat">
        <div className="flex flex-wrap gap-2">
          {REGIONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                haptic.select();
                setRegion((prev) => (prev === r ? "" : r));
              }}
              className={`chip ${region === r ? "chip-active" : ""}`}
            >
              {r}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Tuman">
        <input
          className="input"
          value={district}
          onChange={(e) => setDistrict(e.target.value)}
          maxLength={80}
          placeholder="Tuman yoki shahar"
        />
      </Field>

      <Field label="Men haqimda" hint="ixtiyoriy">
        <textarea
          className="input min-h-[90px] resize-none"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={500}
          placeholder="Tajribangiz, qanday ishlarni qilasiz..."
        />
      </Field>

      <Field label="Ko'nikmalar" hint={`${skills.length}/${MAX_SKILLS}`}>
        {skills.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {skills.map((s) => (
              <span key={s} className="chip !pr-1.5">
                {s}
                <button
                  type="button"
                  onClick={() => {
                    haptic.tap();
                    setSkills((prev) => prev.filter((x) => x !== s));
                  }}
                  aria-label={`${s} ni o'chirish`}
                  className="grid h-5 w-5 place-items-center rounded-full"
                  style={{ background: "var(--bg-subtle)" }}
                >
                  <XIcon size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            className="input flex-1"
            value={skillDraft}
            onChange={(e) => setSkillDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addSkill();
              }
            }}
            maxLength={40}
            placeholder="Masalan: bo'yoqchi"
            enterKeyHint="done"
          />
          <button
            type="button"
            onClick={addSkill}
            disabled={!skillDraft.trim()}
            className="btn-soft shrink-0 !px-4"
            aria-label="Ko'nikma qo'shish"
          >
            <PlusIcon size={16} />
          </button>
        </div>
      </Field>

      {/* Brauzerda (Telegram'siz) MainButton yo'q — zaxira tugma. */}
      {!window.Telegram?.WebApp && (
        <button
          type="button"
          onClick={() => void save()}
          disabled={!valid || saving || uploading}
          className="btn-primary w-full"
        >
          {saving ? "Saqlanmoqda..." : "Saqlash"}
        </button>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[13px] font-bold uppercase tracking-[0.4px] subtle">{label}</h2>
        {hint && <span className="text-[11.5px] subtle">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
