import React from "react";
import { useTranslation } from "react-i18next";

export function LanguageSwitcher({ compact = false }) {
  const { t, i18n } = useTranslation();

  return (
    <div className={`flex items-center gap-1 rounded-xl border border-slate-200 bg-white ${compact ? "px-1 py-1" : "px-2 py-1.5"}`}>
      {!compact && (
        <span className="text-[11px] font-medium text-slate-500">
          {t("language.label")}
        </span>
      )}
      <button
        type="button"
        onClick={() => i18n.changeLanguage("en")}
        className={`rounded-lg px-2 py-1 text-[11px] font-medium transition-colors ${
          i18n.language === "en"
            ? "bg-primary text-white"
            : "text-slate-600 hover:bg-slate-100"
        }`}
      >
        {t("language.english")}
      </button>
      <button
        type="button"
        onClick={() => i18n.changeLanguage("he")}
        className={`rounded-lg px-2 py-1 text-[11px] font-medium transition-colors ${
          i18n.language === "he"
            ? "bg-primary text-white"
            : "text-slate-600 hover:bg-slate-100"
        }`}
      >
        {t("language.hebrew")}
      </button>
    </div>
  );
}
