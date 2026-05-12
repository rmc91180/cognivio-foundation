import "@testing-library/jest-dom";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key, options) => {
      const translations = {
        "dashboard.leadershipInsightsTitle": "Leadership insights",
        "dashboard.leadershipInsightsDescription":
          "Principal-facing patterns and next leadership moves.",
        "dashboard.leadershipFocusLabel": "Leadership focus:",
        "dashboard.leadershipBulletFallbackAction":
          "Decide the next principal-led action and review progress in the next leadership meeting.",
        "dashboard.leadershipFallback1Insight":
          "Review where progress has slowed across departments.",
        "dashboard.leadershipFallback1Action":
          "Compare department-level evidence and choose one leadership follow-up.",
        "dashboard.noTrendDataForFilters":
          "No trend data for the selected filters.",
      };

      if (Object.prototype.hasOwnProperty.call(translations, key)) {
        return translations[key];
      }

      if (options && typeof options.defaultValue === "string") {
        return options.defaultValue;
      }

      return key;
    },
    i18n: {
      language: "en",
      changeLanguage: jest.fn(),
    },
  }),
  Trans: ({ children }) => children,
  initReactI18next: {
    type: "3rdParty",
    init: jest.fn(),
  },
}));