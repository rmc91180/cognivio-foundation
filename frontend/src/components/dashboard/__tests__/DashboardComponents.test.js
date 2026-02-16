import React from "react";
import { render, screen } from "@testing-library/react";
import { LeadershipInsightsCard } from "../LeadershipInsightsCard";
import { DomainTrendsChart } from "../DomainTrendsChart";

describe("dashboard v2 components", () => {
  it("renders leadership bullets from AI payload", () => {
    const insights = {
      generated_by: "ai",
      bullets: ["School trend is up.", "Instruction domain improved.", "One teacher needs coaching."],
    };

    render(<LeadershipInsightsCard insights={insights} isLoading={false} />);

    expect(screen.getByText("Leadership insights")).toBeTruthy();
    expect(screen.getByText("AI generated")).toBeTruthy();
    expect(screen.getByText("School trend is up.")).toBeTruthy();
    expect(screen.getByText("Instruction domain improved.")).toBeTruthy();
    expect(screen.getByText("One teacher needs coaching.")).toBeTruthy();
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
