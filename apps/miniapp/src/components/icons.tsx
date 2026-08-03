/**
 * Kerakli ikonkalar — inline SVG.
 *
 * Nega kutubxona emas: saytda `lucide-react` ishlatiladi, lekin Mini App'ga
 * undan atigi o'n chog'li ikonka kerak. Shu o'ntasini qo'lda yozish butun
 * paketni (va uning tree-shaking'iga bog'liq bo'lishni) yuklamaslikni
 * anglatadi — mobil internetda bu sezilarli farq.
 *
 * Chiziq qalinligi va o'lchamlar lucide bilan bir xil (24×24, stroke 2),
 * shuning uchun sayt bilan ko'rinish farq qilmaydi.
 */

type IconProps = {
  size?: number;
  className?: string;
  strokeWidth?: number;
};

function svg(path: React.ReactNode) {
  return function Icon({ size = 20, className, strokeWidth = 2 }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
      >
        {path}
      </svg>
    );
  };
}

export const MapPinIcon = svg(
  <>
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
    <circle cx="12" cy="10" r="3" />
  </>,
);

export const ClockIcon = svg(
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </>,
);

export const SearchIcon = svg(
  <>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </>,
);

export const HomeIcon = svg(
  <>
    <path d="M3 10.2 12 3l9 7.2V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.8Z" />
  </>,
);

export const BriefcaseIcon = svg(
  <>
    <rect width="20" height="14" x="2" y="7" rx="2" />
    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
  </>,
);

export const FileTextIcon = svg(
  <>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="M10 9H8M16 13H8M16 17H8" />
  </>,
);

export const UserIcon = svg(
  <>
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </>,
);

export const UsersIcon = svg(
  <>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </>,
);

export const PhoneIcon = svg(
  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.68 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.32 1.85.55 2.81.68A2 2 0 0 1 22 16.92Z" />,
);

export const AlertIcon = svg(
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 8v4M12 16h.01" />
  </>,
);

export const InboxIcon = svg(
  <>
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </>,
);

export const StarIcon = svg(
  <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />,
);

export const CheckIcon = svg(<path d="M20 6 9 17l-5-5" />);

export const XIcon = svg(<path d="M18 6 6 18M6 6l12 12" />);

export const RefreshIcon = svg(
  <>
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M3 21v-5h5" />
  </>,
);

export const BellIcon = svg(
  <>
    <path d="M10.27 21a2 2 0 0 0 3.46 0" />
    <path d="M3.26 15.33A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.4 13.92 18 12.5 18 8a6 6 0 0 0-12 0c0 4.5-1.4 5.92-2.74 7.33" />
  </>,
);

export const PlusIcon = svg(<path d="M12 5v14M5 12h14" />);

export const ImageIcon = svg(
  <>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21" />
  </>,
);

export const TrashIcon = svg(
  <>
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
  </>,
);

export const CalendarIcon = svg(
  <>
    <rect width="18" height="18" x="3" y="4" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </>,
);

export const MapIcon = svg(
  <>
    <path d="M14.1 4.1 9.9 2 2 6v16l7.9-4 4.2 2.1L22 16V0l-7.9 4.1Z" />
    <path d="M9.9 2v16M14.1 4v16" />
  </>,
);

export const ListIcon = svg(<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />);

export const EditIcon = svg(
  <>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5Z" />
  </>,
);

export const ChevronRightIcon = svg(<path d="m9 18 6-6-6-6" />);

export const HistoryIcon = svg(
  <>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5M12 7v5l3.5 2" />
  </>,
);

/** GPS — "joriy joylashuvim". */
export const CrosshairIcon = svg(
  <>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M12 1v3M12 20v3M1 12h3M20 12h3" />
  </>,
);

/** Qidiruv maydonidagi filtr tugmasi (maketda dumaloq ko'k fonda). */
export const SlidersIcon = svg(
  <>
    <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
    <path d="M1 14h6M9 8h6M17 16h6" />
  </>,
);

export const ShareIcon = svg(
  <>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
  </>,
);

export const MessageIcon = svg(
  <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.1A8.4 8.4 0 0 1 4 11.5a8.4 8.4 0 0 1 8.5-8.4 8.4 8.4 0 0 1 8.5 8.4Z" />,
);

// ── Kategoriya glifi ─────────────────────────────────────────────────
// Maketda har turkum o'z ikonkasi bilan plitkada turadi. Kutubxona
// o'rniga yana qo'lda — bu yerda kerak bo'lgani atigi bir nechtasi.

/** Tozalash — supurgi. */
export const BroomIcon = svg(
  <>
    <path d="M19 3 12 10" />
    <path d="M8.5 10.5h7l1.5 5c.2.7-.3 1.5-1.1 1.5H8.1c-.8 0-1.3-.8-1.1-1.5l1.5-5Z" />
    <path d="M9 17v4M12 17v4M15 17v4" />
  </>,
);

/** Yuk tashish — yuk mashinasi. */
export const TruckIcon = svg(
  <>
    <path d="M2 7h11v9H2zM13 10h4l3 3v3h-7z" />
    <circle cx="6" cy="18" r="2" />
    <circle cx="17" cy="18" r="2" />
  </>,
);

/** Qurilish — asboblar. */
export const ToolsIcon = svg(
  <>
    <path d="M14.7 6.3a4 4 0 0 0 5 5L15 16l-2-2 1.7-7.7Z" />
    <path d="m9 11-6 6a2 2 0 0 0 3 3l6-6" />
  </>,
);

/** Yetkazish — quti. */
export const PackageIcon = svg(
  <>
    <path d="m21 8-9-5-9 5v8l9 5 9-5V8Z" />
    <path d="m3 8 9 5 9-5M12 13v8" />
  </>,
);

/** Santexnika — kalit. */
export const WrenchIcon = svg(
  <path d="M14.7 6.3a4 4 0 1 0-5.4 5.4l-6 6a2 2 0 1 0 3 3l6-6a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-2.4 2.6-2.2Z" />,
);

/** Ish beruvchi reytingi — kubok (maketda ishchi reytingidan farqlanadi). */
export const TrophyIcon = svg(
  <>
    <path d="M6 4h12v4a6 6 0 0 1-12 0V4Z" />
    <path d="M6 6H4a2 2 0 0 0 0 4h2M18 6h2a2 2 0 0 1 0 4h-2" />
    <path d="M12 14v4M9 21h6" />
  </>,
);

export const CheckCircleIcon = svg(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12 2.5 2.5 4.5-5" />
  </>,
);

export const SettingsIcon = svg(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
  </>,
);

export const HelpIcon = svg(
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" />
  </>,
);

export const InfoIcon = svg(
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4M12 8h.01" />
  </>,
);

export const ShieldIcon = svg(
  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />,
);

/** "Hammasini o'qilgan qilish" — ikki belgi. */
export const DoubleCheckIcon = svg(
  <>
    <path d="m1.5 13 4 4L15 7" />
    <path d="m9 13 2 2 8.5-9.5" />
  </>,
);

export const MoneyIcon = svg(
  <>
    <rect width="20" height="13" x="2" y="6" rx="2" />
    <circle cx="12" cy="12.5" r="2.5" />
    <path d="M6 10v5M18 10v5" />
  </>,
);
