import React from "react";
import { useTranslation } from "react-i18next";

export function LanguageSwitcher({ compact = false }) {
  const { t, i18n } = useTranslation();
  const currentLanguage = i18n.language === "he" ? "he" : "en";

  return (
    <div
      className={`flex items-center rounded-xl border border-slate-200 bg-white ${
        compact ? "gap-2 px-2 py-1.5" : "gap-3 px-3 py-2"
      }`}
    >
      {!compact && (
        <label
          htmlFor="language-switcher"
          className="text-[11px] font-medium uppercase tracking-wide text-slate-500"
        >
          {t("language.label")}
        </label>
      )}
      <select
        id="language-switcher"
        value={currentLanguage}
        onChange={(event) => i18n.changeLanguage(event.target.value)}
        className={`rounded-lg border border-slate-200 bg-slate-50 text-slate-700 outline-none transition-colors focus:border-primary/40 focus:bg-white ${
          compact ? "min-w-[7rem] px-2.5 py-1.5 text-xs" : "min-w-[8.5rem] px-3 py-2 text-sm"
        }`}
      >
        <option value="en">{t("language.english")}</option>
        <option value="he">{t("language.hebrew")}</option>
      </select>
    </div>
  );
}
