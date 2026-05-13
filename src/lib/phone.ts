export type CountryCode = {
  code: string; // numeric prefix without "+", e.g. "507"
  iso: string; // ISO 3166-1 alpha-2, e.g. "PA"
  name: string;
  flag: string;
};

export const COUNTRY_CODES: CountryCode[] = [
  { code: "507", iso: "PA", name: "Panamá", flag: "🇵🇦" },
  { code: "506", iso: "CR", name: "Costa Rica", flag: "🇨🇷" },
  { code: "57", iso: "CO", name: "Colombia", flag: "🇨🇴" },
  { code: "52", iso: "MX", name: "México", flag: "🇲🇽" },
  { code: "503", iso: "SV", name: "El Salvador", flag: "🇸🇻" },
  { code: "502", iso: "GT", name: "Guatemala", flag: "🇬🇹" },
  { code: "504", iso: "HN", name: "Honduras", flag: "🇭🇳" },
  { code: "505", iso: "NI", name: "Nicaragua", flag: "🇳🇮" },
  { code: "1", iso: "US", name: "USA / Canadá", flag: "🇺🇸" },
  { code: "34", iso: "ES", name: "España", flag: "🇪🇸" },
  { code: "58", iso: "VE", name: "Venezuela", flag: "🇻🇪" },
  { code: "51", iso: "PE", name: "Perú", flag: "🇵🇪" },
  { code: "54", iso: "AR", name: "Argentina", flag: "🇦🇷" },
  { code: "56", iso: "CL", name: "Chile", flag: "🇨🇱" },
  { code: "55", iso: "BR", name: "Brasil", flag: "🇧🇷" },
  { code: "593", iso: "EC", name: "Ecuador", flag: "🇪🇨" },
  { code: "591", iso: "BO", name: "Bolivia", flag: "🇧🇴" },
  { code: "598", iso: "UY", name: "Uruguay", flag: "🇺🇾" },
  { code: "595", iso: "PY", name: "Paraguay", flag: "🇵🇾" },
  { code: "53", iso: "CU", name: "Cuba", flag: "🇨🇺" },
  { code: "1809", iso: "DO", name: "Rep. Dominicana", flag: "🇩🇴" },
  { code: "1787", iso: "PR", name: "Puerto Rico", flag: "🇵🇷" },
];

export const DEFAULT_COUNTRY_CODE = "507"; // Panamá

export function parsePhone(stored: string | null, fallback: string = DEFAULT_COUNTRY_CODE): {
  code: string;
  digits: string;
} {
  if (!stored) return { code: fallback, digits: "" };
  const cleaned = stored.replace(/\D/g, "");
  if (!cleaned) return { code: fallback, digits: "" };

  // Sort by code length desc so 1809/1787 win over 1
  const codes = [...COUNTRY_CODES].sort((a, b) => b.code.length - a.code.length);
  for (const { code } of codes) {
    if (cleaned.startsWith(code)) {
      return { code, digits: cleaned.slice(code.length) };
    }
  }
  return { code: fallback, digits: cleaned };
}

export function formatPhoneE164(code: string, digits: string): string | null {
  const d = digits.replace(/\D/g, "");
  if (!d) return null;
  return `+${code}${d}`;
}

export function whatsappLink(stored: string | null): string | null {
  if (!stored) return null;
  const digits = stored.replace(/\D/g, "");
  if (digits.length < 6) return null;
  return `https://wa.me/${digits}`;
}

export function displayPhone(stored: string | null): string {
  if (!stored) return "";
  const { code, digits } = parsePhone(stored);
  if (!digits) return "";
  return `+${code} ${digits}`;
}
