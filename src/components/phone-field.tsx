"use client";

import { useMemo } from "react";
import { COUNTRY_CODES, DEFAULT_COUNTRY_CODE, formatPhoneE164, parsePhone } from "@/lib/phone";

export function PhoneField({
  value,
  onChange,
  defaultCode = DEFAULT_COUNTRY_CODE,
  placeholder = "6000-0000",
  className = "",
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  defaultCode?: string;
  placeholder?: string;
  className?: string;
}) {
  const parsed = useMemo(() => parsePhone(value, defaultCode), [value, defaultCode]);

  function handleCode(nextCode: string) {
    onChange(formatPhoneE164(nextCode, parsed.digits));
  }
  function handleDigits(nextDigits: string) {
    onChange(formatPhoneE164(parsed.code, nextDigits));
  }

  return (
    <div className={`flex items-stretch overflow-hidden rounded-lg border border-border bg-white ${className}`}>
      <select
        value={parsed.code}
        onChange={(e) => handleCode(e.target.value)}
        className="border-r border-border bg-white px-2 py-2 text-sm focus:outline-none"
        aria-label="Código de país"
      >
        {COUNTRY_CODES.map((c) => (
          <option key={c.iso} value={c.code}>
            {c.flag} +{c.code} {c.name}
          </option>
        ))}
      </select>
      <input
        type="tel"
        inputMode="tel"
        value={parsed.digits}
        onChange={(e) => handleDigits(e.target.value.replace(/[^\d]/g, ""))}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-white px-3 py-2 text-sm focus:outline-none"
      />
    </div>
  );
}
