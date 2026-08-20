import type { SVGProps } from "react";

/** Telegram'ning rasmiy qog'oz samolyot belgisi. */
export function TelegramIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M23.91 3.79 20.3 20.68c-.27 1.19-.98 1.48-1.98.92l-5.47-4.03-2.64 2.54c-.29.29-.54.54-1.1.54l.39-5.57L19.64 5.9c.44-.39-.1-.6-.68-.2L6.43 13.59l-5.39-1.68c-1.17-.37-1.19-1.17.24-1.73L22.36 2.05c.98-.36 1.83.24 1.55 1.74Z" />
    </svg>
  );
}
