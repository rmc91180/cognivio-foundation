import React from "react";
import { render, screen } from "@testing-library/react";
import { LeadershipInsightsCard } from "../LeadershipInsightsCard";
import { DomainTrendsChart } from "../DomainTrendsChart";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key) => {
      const translations = {
        "dashboard.leadershipInsightsTitle": "Leadership insights",
        "dashboard.leadershipInsightsDescription": "Top school-level trends and next moves.",
        "dashboard.leadershipFocusLabel": "Leadership focus:",
        "dashboard.leadershipBulletFallbackAction":
          "Decide the next principal-led action and review progress in the next leadership meeting.",
        "dashboard.leadershipFallback1Insight": "Review where progress has slowed across departments.",
        "dashboard.leadershipFallback1Action":
          "Choose one schoolwide move and align team leads on evidence to monitor.",
        "dashboard.leadershipFallback2Insight": "Clarify ownership for the highest-leverage growth area.",
        "dashboard.leadershipFallback2Action":
          "Assign one owner, one milestone, and one check-in date.",
        "dashboard.leadershipFallback3Insight": "Strengthen cross-team consistency in instructional routines.",
        "dashboard.leadershipFallback3Action":
          "Use a short look-for list during walkthroughs and calibrate next steps.",
        "dashboard.leadershipFallback4Insight": "Protect momentum by tracking one visible weekly indicator.",
        "dashboard.leadershipFallback4Action":
          "Share trend snapshots with leaders and decide one adjustment each week.",
        "dashboard.noTrendDataForFilters": "No trend data for the selected filters.",
      };
      return translations[key] || key;
    },
    i18n: { language: "en" },
  }),
}));

describe("dashboard v2 components", () => {
  it("renders 4 principal-focused leadership insights and excludes teacher-specific items", () => {
    const insights = {
      generated_by: "ai",
      items: [
        {
          insight: "School-wide momentum is improving (+0.4).",
          action: "Scale the current coaching protocol to all grade teams this month.",
          priority: "low",
          owner: "principal",
          due_window_days: 21,
        },
        {
          insight: "Domain 2 is declining (-0.6).",
          action: "Launch a targeted intervention cycle for Domain 2 with weekly walkthroughs.",
          priority: "high",
          owner: "coach",
          due_window_days: 7,
          target_teacher_name: "Ms. Carter",
        },
        {
          insight: "Teacher variance increased in Grade 7.",
          action: "Pair strongest and weakest teachers for observation debriefs.",
          priority: "medium",
          owner: "principal",
          due_window_days: 14,
        },
        {
          insight: "Assessment coverage dipped in January.",
          action: "Require one additional evidence point per teacher this month.",
          priority: "medium",
          owner: "principal",
          due_window_days: 14,
        },
        {
          insight: "Positive trend in classroom culture is consistent.",
          action: "Document exemplar routines and share in PLC.",
          priority: "low",
          owner: "coach",
          due_window_days: 21,
        },
        {
          insight: "Ms. Rivera is underperforming on questioning quality.",
          action: "Set one measurable questioning goal and re-observe next week.",
          priority: "high",
          owner: "coach",
          due_window_days: 7,
          target_teacher_name: "Ms. Rivera",
        },
        {
          insight: "Cross-subject trend divergence is widening.",
          action: "Audit subject-specific support plans and reset ownership.",
          priority: "medium",
          owner: "principal",
          due_window_days: 14,
        },
      ],
    };

    render(<LeadershipInsightsCard insights={insights} isLoading={false} />);

    expect(screen.getByText("Leadership insights")).toBeTruthy();
    expect(screen.getByText(/1\. School-wide momentum is improving/)).toBeTruthy();
    expect(screen.getByText(/4\. Positive trend in classroom culture is consistent/)).toBeTruthy();
    expect(screen.getByText("Scale the current coaching protocol to all grade teams this month.")).toBeTruthy();
    expect(screen.queryByText(/Ms\. Carter/)).toBeNull();
    expect(screen.queryByText(/Ms\. Rivera/)).toBeNull();
    expect(screen.queryByText(/5\. Cross-subject trend divergence is widening/)).toBeNull();
  });

  it("falls back to bullets when items are not provided", () => {
    const insights = {
      generated_by: "rules",
      bullets: ["School trend is flat.", "Domain 1 improved.", "Teacher support needed."],
    };

    render(<LeadershipInsightsCard insights={insights} isLoading={false} />);

    expect(screen.getByText(/1\. School trend is flat\./)).toBeTruthy();
    expect(
      screen.getAllByText(
        "Decide the next principal-led action and review progress in the next leadership meeting."
      ).length
    ).toBe(3);
    expect(screen.getByText(/4\. Review where progress has slowed across departments\./)).toBeTruthy();
  });

  it("shows empty-state message when chart has no data", () => {
    render(
      <DomainTrendsChart
        chartData={[]}
        domains={[]}
        selectedTeacherId=""
        selectedTeacherName=""
        isLoading={false}
      />
    );

    expect(screen.getByText("No trend data for the selected filters.")).toBeTruthy();
  });
});
