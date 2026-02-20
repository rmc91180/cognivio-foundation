import React from "react";
import { render, screen } from "@testing-library/react";
import { LeadershipInsightsCard } from "../LeadershipInsightsCard";
import { DomainTrendsChart } from "../DomainTrendsChart";

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
