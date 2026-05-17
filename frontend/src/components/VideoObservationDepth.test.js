import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { VideoCommentThread } from "@/components/VideoCommentThread";
import { VideoTimelineMarkers } from "@/components/VideoTimelineMarkers";
import { TalkTimeChart } from "@/components/TalkTimeChart";
import { AudioTimeline } from "@/components/AudioTimeline";
import { findBannedCoachVoicePhrases } from "@/lib/coachVoice";

describe("video observation depth components", () => {
  it("renders comment empty state in coach voice", () => {
    render(<VideoCommentThread comments={[]} currentUser={{ id: "admin-1" }} isAdminView />);

    expect(screen.getByText(/Add a note at the moment you want to revisit/i)).toBeInTheDocument();
    expect(findBannedCoachVoicePhrases(document.body.textContent)).toEqual([]);
  });

  it("sorts comments, formats timestamps, and hides private notes from teacher view", () => {
    render(
      <VideoCommentThread
        currentUser={{ id: "teacher-1", tenant_role: "teacher" }}
        comments={[
          {
            id: "private",
            timestamp_seconds: 8,
            body: "Private note",
            visibility: "observer_private",
            author_name: "Admin",
          },
          {
            id: "late",
            timestamp_seconds: 65,
            body: "Later shared note",
            visibility: "shared_with_teacher",
            author_name: "Admin",
          },
          {
            id: "early",
            timestamp_seconds: 5,
            body: "Earlier shared note",
            visibility: "shared_with_teacher",
            author_name: "Admin",
          },
        ]}
      />
    );

    expect(screen.queryByText("Private note")).not.toBeInTheDocument();
    expect(screen.getByText("00:05")).toBeInTheDocument();
    expect(screen.getByText("01:05")).toBeInTheDocument();
    const visibleText = document.body.textContent;
    expect(visibleText.indexOf("Earlier shared note")).toBeLessThan(visibleText.indexOf("Later shared note"));
  });

  it("lets timeline markers seek to a comment timestamp", () => {
    const onSeekTo = jest.fn();
    render(
      <VideoTimelineMarkers
        duration={100}
        comments={[{ id: "comment-1", timestamp_seconds: 25, body: "Moment to revisit" }]}
        onSeekTo={onSeekTo}
      />
    );

    fireEvent.click(screen.getByLabelText(/Jump to note at 00:25/i));
    expect(onSeekTo).toHaveBeenCalledWith(25);
  });

  it("renders talk-time percentages and audio timeline seeking", () => {
    const onSeek = jest.fn();
    render(
      <>
        <TalkTimeChart
          analysis={{
            features_available: true,
            teacher_talk_pct: 58,
            student_talk_pct: 27,
            silence_pct: 15,
          }}
          isTeacherView
        />
        <AudioTimeline
          duration={20}
          segments={[{ start_sec: 4, end_sec: 8, speaker: "teacher" }]}
          onSeek={onSeek}
        />
      </>
    );

    expect(screen.getByText("58%")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Jump to Teacher at 00:04/i));
    expect(onSeek).toHaveBeenCalledWith(4);
    expect(findBannedCoachVoicePhrases(document.body.textContent)).toEqual([]);
  });
});
