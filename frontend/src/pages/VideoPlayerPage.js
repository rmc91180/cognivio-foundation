import React, { useRef, useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { assessmentApi, observationApi, videoApi } from "@/lib/api";
import { LayoutShell } from "@/components/LayoutShell";
import { VideoTimeline } from "@/components/VideoTimeline";
import { toast } from "sonner";

export function VideoPlayerPage() {
  const { videoId } = useParams();
  const [searchParams] = useSearchParams();
  const videoRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const hasSeenkedFromUrl = useRef(false);

  // Parse timestamp from URL and seek to it when video loads
  useEffect(() => {
    const timeParam = searchParams.get("t");
    if (timeParam && videoRef.current && !hasSeenkedFromUrl.current) {
      const time = parseFloat(timeParam);
      if (!isNaN(time) && time >= 0) {
        const handleCanPlay = () => {
          videoRef.current.currentTime = time;
          hasSeenkedFromUrl.current = true;
        };
        const video = videoRef.current;
        if (video.readyState >= 2) {
          video.currentTime = time;
          hasSeenkedFromUrl.current = true;
        } else {
          video.addEventListener("canplay", handleCanPlay, { once: true });
          return () => video.removeEventListener("canplay", handleCanPlay);
        }
      }
    }
  }, [searchParams]);

  // Track current video time
  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      setCurrentTime(Math.floor(videoRef.current.currentTime));
    }
  }, []);

  // Get video duration when metadata loads
  const handleLoadedMetadata = useCallback(() => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  }, []);

  // Copy link with current timestamp
  const copyTimestampLink = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("t", currentTime.toString());
    navigator.clipboard.writeText(url.toString()).then(() => {
      toast.success("Link copied to clipboard");
    }).catch(() => {
      toast.error("Failed to copy link");
    });
  }, [currentTime]);

  const { data: videoRes } = useQuery({
    queryKey: ["video", videoId],
    queryFn: () => videoApi.detail(videoId).then((r) => r.data),
  });

  const { data: observationsRes } = useQuery({
    queryKey: ["video-observations", videoId],
    queryFn: () =>
      observationApi.listForVideo(videoId).then((r) => r.data),
  });

  const assessmentId = videoRes?.assessment_id;
  const { data: assessmentRes } = useQuery({
    queryKey: ["assessment", assessmentId],
    enabled: !!assessmentId,
    queryFn: () => assessmentApi.get(assessmentId).then((r) => r.data),
  });

  const [summaryNotes, setSummaryNotes] = useState("");
  const [actionItems, setActionItems] = useState("");

  const handleSeek = (seconds) => {
    if (!videoRef.current || typeof seconds !== "number") return;
    videoRef.current.currentTime = seconds;
    videoRef.current.focus();
  };

  const handleGenerateReport = () => {
    const win = window.open("", "_blank");
    if (!win) return;
    const observations = observationsRes ?? [];
    const assessment = assessmentRes;
    const html = `
      <html>
        <head>
          <title>Cognivio Observation Report</title>
          <style>
            body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 24px; color: #020617; }
            h1, h2, h3 { margin: 0 0 8px; }
            h1 { font-size: 20px; }
            h2 { font-size: 16px; margin-top: 16px; }
            h3 { font-size: 14px; margin-top: 12px; }
            .section { margin-bottom: 16px; }
            .chip { display:inline-block; padding:2px 8px; border-radius:999px; background:#e5e7eb; font-size:11px; }
            ul { padding-left: 18px; }
          </style>
        </head>
        <body>
          <h1>Lesson Observation Report</h1>
          <div class="section">
            <div><strong>Video:</strong> ${videoRes?.filename || ""}</div>
            <div><strong>Date:</strong> ${assessment?.analyzed_at || ""}</div>
          </div>
          <div class="section">
            <h2>Summary</h2>
            <p>${assessment?.summary || ""}</p>
            <p>${summaryNotes || ""}</p>
          </div>
          <div class="section">
            <h2>Key observations</h2>
            <ul>
              ${observations
                .map(
                  (o) =>
                    `<li>${o.admin_comment || ""} ${
                      typeof o.timestamp_seconds === "number"
                        ? `(t=${Math.round(o.timestamp_seconds)}s)`
                        : ""
                    }</li>`
                )
                .join("")}
            </ul>
          </div>
          <div class="section">
            <h2>Action items for next lesson</h2>
            <p>${actionItems || ""}</p>
          </div>
        </body>
      </html>
    `;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  };

  const observations = observationsRes ?? [];

  const videoUrl =
    videoRes && videoRes.stored_filename
      ? `${process.env.REACT_APP_BACKEND_URL}/uploads/${videoRes.stored_filename}`
      : null;

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-6 py-6">
        <h1 className="mb-4 font-heading text-2xl font-semibold text-slate-900">
          Lesson recording
        </h1>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
          <section className="md:col-span-7 space-y-3">
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              {videoUrl ? (
                <>
                  <video
                    ref={videoRef}
                    controls
                    className="h-full w-full bg-black"
                    src={videoUrl}
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleLoadedMetadata}
                  />
                  <div className="border-t border-slate-200 bg-slate-50 px-3 py-3">
                    {/* Visual timeline with observation markers */}
                    {duration > 0 && observations.length > 0 && (
                      <div className="mb-3">
                        <VideoTimeline
                          duration={duration}
                          currentTime={currentTime}
                          observations={observations}
                          onSeek={handleSeek}
                        />
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-slate-500">
                        Current time: {Math.floor(currentTime / 60)}:
                        {String(currentTime % 60).padStart(2, "0")}
                      </span>
                      <button
                        type="button"
                        onClick={copyTimestampLink}
                        className="inline-flex items-center gap-1.5 rounded bg-slate-200 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-300"
                      >
                        <svg
                          className="h-3.5 w-3.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                          />
                        </svg>
                        Copy link at timestamp
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="p-6 text-sm text-slate-500">
                  Video file unavailable.
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-700">
              <h2 className="mb-2 text-sm font-semibold text-slate-900">
                Summary & action items
              </h2>
              <div className="mb-2 text-xs text-slate-600">
                {assessmentRes?.summary}
              </div>
              <div className="mb-2">
                <label className="mb-1 block text-[11px] font-medium text-slate-600">
                  Additional summary notes
                </label>
                <textarea
                  rows={2}
                  value={summaryNotes}
                  onChange={(e) => setSummaryNotes(e.target.value)}
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none ring-primary/40 focus:ring"
                />
              </div>
              <div className="mb-3">
                <label className="mb-1 block text-[11px] font-medium text-slate-600">
                  Action items for next lesson
                </label>
                <textarea
                  rows={2}
                  value={actionItems}
                  onChange={(e) => setActionItems(e.target.value)}
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none ring-primary/40 focus:ring"
                />
              </div>
              <button
                type="button"
                onClick={handleGenerateReport}
                className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-white hover:bg-primary/90"
              >
                Generate report
              </button>
            </div>
          </section>

          <section className="md:col-span-5 space-y-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs">
              <h2 className="mb-2 text-sm font-semibold text-slate-900">
                Timestamped observations
              </h2>
              {observations.length === 0 ? (
                <div className="text-xs text-slate-500">
                  No observations yet for this recording.
                </div>
              ) : (
                <ul className="space-y-1">
                  {observations.map((o) => (
                    <li key={o.id}>
                      <button
                        type="button"
                        onClick={() => handleSeek(o.timestamp_seconds)}
                        className="w-full rounded-md px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-100"
                      >
                        <span className="mr-2 inline-flex min-w-[46px] items-center justify-center rounded-full bg-slate-200 px-2 py-0.5 text-[10px] text-slate-700">
                          {typeof o.timestamp_seconds === "number"
                            ? `${Math.round(o.timestamp_seconds)}s`
                            : "--"}
                        </span>
                        {o.admin_comment || "Observation"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs">
              <h2 className="mb-2 text-sm font-semibold text-slate-900">
                Linked AI insights
              </h2>
              {assessmentRes?.element_scores?.length ? (
                <ul className="space-y-1">
                  {assessmentRes.element_scores.slice(0, 6).map((es) => (
                    <li
                      key={es.element_id}
                      className="rounded-md bg-slate-50 px-2 py-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-medium text-slate-900">
                          {es.element_name}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          {es.score.toFixed(1)}/10
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {es.observations?.[0]}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-xs text-slate-500">
                  No AI insights associated with this video yet.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </LayoutShell>
  );
}

