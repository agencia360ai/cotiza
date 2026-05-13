import { MessageCircle } from "lucide-react";
import { displayPhone, whatsappLink } from "@/lib/phone";
import { cn } from "@/lib/utils";

export function WhatsAppLink({
  phone,
  variant = "inline",
  className = "",
  message,
}: {
  phone: string | null;
  variant?: "inline" | "button" | "icon";
  className?: string;
  message?: string;
}) {
  const href = whatsappLink(phone);
  if (!href) return null;
  const url = message ? `${href}?text=${encodeURIComponent(message)}` : href;
  const label = displayPhone(phone);

  if (variant === "icon") {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Enviar WhatsApp a ${label}`}
        className={cn(
          "inline-flex size-7 items-center justify-center rounded-lg text-emerald-600 hover:bg-emerald-50",
          className,
        )}
      >
        <MessageCircle className="size-4" />
      </a>
    );
  }

  if (variant === "button") {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20 transition-colors hover:bg-emerald-100",
          className,
        )}
      >
        <MessageCircle className="size-3.5" />
        WhatsApp
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-center gap-1.5 text-sm text-emerald-700 hover:underline",
        className,
      )}
    >
      <MessageCircle className="size-3.5" />
      <span className="tabular-nums">{label}</span>
    </a>
  );
}
