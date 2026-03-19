import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/locales/en/common";
import he from "@/locales/he/common";

const STORAGE_KEY = "cognivio_language";
const RTL_LANGUAGES = new Set(["he"]);

function detectInitialLanguage() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && ["en", "he"].includes(stored)) {
    return stored;
  }
  const browserLanguage = (navigator.language || "en").toLowerCase();
  return browserLanguage.startsWith("he") ? "he" : "en";
}

function applyDocumentLanguage(language) {
  const lang = language || "en";
  const isRtl = RTL_LANGUAGES.has(lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = isRtl ? "rtl" : "ltr";
  document.body.dataset.locale = lang;
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    he: { translation: he },
  },
  lng: detectInitialLanguage(),
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

applyDocumentLanguage(i18n.language);

i18n.on("languageChanged", (language) => {
  localStorage.setItem(STORAGE_KEY, language);
  applyDocumentLanguage(language);
});

export function isRtlLanguage(language = i18n.language) {
  return RTL_LANGUAGES.has(language);
}

export default i18n;
