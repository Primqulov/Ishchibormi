/**
 * Nom belgisi (wordmark) — "Ishchi" ko'k, "Bormi" sariq.
 *
 * Maketdagi tepa panelning chap tomonida turadi va butun ilova bo'ylab
 * bir xil. Rasm emas, matn: shrift allaqachon yuklangan (Inter), ya'ni
 * qo'shimcha so'rov ham, o'lchamlarni moslash muammosi ham yo'q — va
 * ekran o'quvchi uni o'qiy oladi.
 */

export function Logo({ size = 20 }: { size?: number }) {
  return (
    <span
      className="font-black tracking-[-0.2px] whitespace-nowrap"
      style={{ fontSize: size, lineHeight: `${Math.round(size * 1.4)}px`, color: "var(--brand)" }}
    >
      Ishchi<span style={{ color: "var(--accent)" }}> Bormi</span>
    </span>
  );
}
