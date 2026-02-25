import React, { useRef, useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assessmentApi, observationApi, videoApi } from "@/lib/api";
import { LayoutShell } from "@/components/LayoutShell";
import { VideoTimeline } from "@/components/VideoTimeline";
import { toast } from "sonner";
import { Badge, Button, EmptyState, Field, PageHeader, Panel, Textarea } from "@/components/ui";

export function VideoPlayerPage() {
  const { videoId } = useParams();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const videoRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const hasSeenkedFromUrl = useRef(false);
  const [videoStatus, setVideoStatus] = useState("processing");
  const [wsConnected, setWsConnected] = useState(false);

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
  const { data: statusRes } = useQuery({
    queryKey: ["video-status", videoId],
    enabled: Boolean(videoId),
    queryFn: () => videoApi.status(videoId).then((r) => r.data),
    refetchInterval: 5000,
  });

  useEffect(() => {
    const nextStatus = statusRes?.status || videoRes?.status;
    if (nextStatus) {
      setVideoStatus(nextStatus);
    }
  }, [statusRes, videoRes]);

  useEffect(() => {
    const token = localStorage.getItem("cognivio_token");
    if (!videoId || !token || !process.env.REACT_APP_BACKEND_URL) return;
    const base = process.env.REACT_APP_BACKEND_URL;
    const wsBase = base.replace("https://", "wss://").replace("http://", "ws://");
    const ws = new WebSocket(`${wsBase}/ws/videos/${videoId}?token=${token}`);
    setWsConnected(true);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.status) setVideoStatus(data.status);
      } catch (err) {
        // ignore parse errors
      }
    };
    ws.onclose = () => {
      setWsConnected(false);
    };
    ws.onerror = () => {
      setWsConnected(false);
    };
    return () => ws.close();
  }, [videoId]);

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
  const retryMutation = useMutation({
    mutationFn: () => videoApi.retry(videoId),
    onSuccess: () => {
      toast.success("Video re-queued for analysis");
      queryClient.invalidateQueries({ queryKey: ["video", videoId] });
      queryClient.invalidateQueries({ queryKey: ["video-status", videoId] });
    },
    onError: (error) => {
      toast.error(error?.response?.data?.detail || "Failed to retry processing");
    },
  });

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

  const videoUrl = videoRes?.playback_url
    ? videoRes.playback_url.startsWith("http")
      ? videoRes.playback_url
      : `${process.env.REACT_APP_BACKEND_URL}${videoRes.playback_url}`
    : videoRes?.file_url
      ? videoRes.file_url
      : videoRes?.file_path
        ? `${process.env.REACT_APP_BACKEND_URL}/uploads/${videoRes.file_path}`
        : videoRes?.stored_filename
          ? `${process.env.REACT_APP_BACKEND_URL}/uploads/${videoRes.stored_filename}`
          : null;
  const thumbnailUrl =
    videoRes?.thumbnail_url &&
    (videoRes.thumbnail_url.startsWith("http")
      ? videoRes.thumbnail_url
      : `${process.env.REACT_APP_BACKEND_URL}${videoRes.thumbnail_url}`);
  const statusVariant =
    videoStatus === "completed"
      ? "success"
      : videoStatus === "failed" || videoStatus === "error"
        ? "danger"
        : videoStatus === "processing" || videoStatus === "queued"
          ? "warning"
          : "neutral";

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-6 py-6">
        <PageHeader title="Lesson recording" compact className="mb-4" />
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <Badge variant={statusVariant}>
            Status: {videoStatus || "unknown"}
          </Badge>
          {(videoStatus === "failed" || videoStatus === "error") && (
            <Button size="sm" variant="danger" onClick={() => retryMutation.mutate()} disabled={retryMutation.isPending}>
              {retryMutation.isPending ? "Retrying..." : "Retry analysis"}
            </Button>
          )}
          <span className="text-[11px] text-slate-400">
            {wsConnected ? "Live updates connected" : "Live updates offline"}
          </span>
          {statusRes?.error_message && (
            <span className="text-[11px] text-rose-600">{statusRes.error_message}</span>
          )}
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
          <section className="md:col-span-7 space-y-3">
            <Panel padded={false} className="overflow-hidden">
              {videoUrl ? (
                <>
                  <video
                    ref={videoRef}
                    controls
                    className="h-full w-full bg-black"
                    src={videoUrl}
                    poster={thumbnailUrl || undefined}
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
                      <Button variant="secondary" size="sm" onClick={copyTimestampLink}>
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
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <EmptyState
                  className="m-4"
                  title={
                    videoStatus === "queued" || videoStatus === "processing"
                      ? "Video is processing"
                      : "Video file unavailable"
                  }
                  message={
                    videoStatus === "queued" || videoStatus === "processing"
                      ? "Analysis is in progress. Playback will appear once processing is complete."
                      : "This recording cannot be loaded right now."
                  }
                />
              )}
            </Panel>

            <Panel className="p-4 text-xs text-slate-700">
              <h2 className="mb-2 text-sm font-semibold text-slate-900">
                Summary & action items
              </h2>
              <div className="mb-2 text-xs text-slate-600">
                {assessmentRes?.summary}
              </div>
              <Field label="Additional summary notes" className="mb-2">
                <Textarea
                  rows={2}
                  value={summaryNotes}
                  onChange={(e) => setSummaryNotes(e.target.value)}
                  size="sm"
                />
              </Field>
              <Field label="Action items for next lesson" className="mb-3">
                <Textarea
                  rows={2}
                  value={actionItems}
                  onChange={(e) => setActionItems(e.target.value)}
                  size="sm"
                />
              </Field>
              <Button size="sm" onClick={handleGenerateReport}>
                Generate report
              </Button>
            </Panel>
          </section>

          <section className="md:col-span-5 space-y-3">
            <Panel className="p-4 text-xs">
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
            </Panel>

            <Panel className="p-4 text-xs">
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
            </Panel>
          </section>
        </div>
      </div>
    </LayoutShell>
  );
}

