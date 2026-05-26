import React, { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api, { assessmentApi, exemplarApi, observationApi, recognitionApi, shareAssetApi, videoApi } from "@/lib/api";
import { LayoutShell } from "@/components/LayoutShell";
import { AssessmentFeedbackWidget } from "@/components/assessment/AssessmentFeedbackWidget";
import { ObservationFocusPanel } from "@/components/assessment/ObservationFocusPanel";
import { VideoTimeline } from "@/components/VideoTimeline";
import { VideoCommentThread } from "@/components/VideoCommentThread";
import { VideoTimelineMarkers } from "@/components/VideoTimelineMarkers";
import { TalkTimeChart } from "@/components/TalkTimeChart";
import { AudioTimeline } from "@/components/AudioTimeline";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Badge, Button, EmptyState, Field, PageContextHeader, Panel, Textarea } from "@/components/ui";
import { useTranslation } from "react-i18next";
import { runtimeConfig } from "@/lib/runtimeConfig";
import { resolveCoachingLink } from "@/lib/coachingRoutes";

export function VideoPlayerPage() {
  const { t, i18n } = useTranslation();
  const { videoId } = useParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const role = user?.tenant_role || user?.role;
  const isTeacher = role === "teacher";
  const isAdmin = ["admin", "principal", "school_admin", "training_admin", "super_admin", "master_admin"].includes(role);
  const [searchParams] = useSearchParams();
  const videoRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const hasSeenkedFromUrl = useRef(false);
  const [videoStatus, setVideoStatus] = useState("processing");
  const [wsConnected, setWsConnected] = useState(false);
  const [highlightedCommentId, setHighlightedCommentId] = useState(null);
  const [isAddingComment, setIsAddingComment] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [commentVisibility, setCommentVisibility] = useState("observer_private");
  const [commentFocusArea, setCommentFocusArea] = useState("");
  const [audioTab, setAudioTab] = useState("talk");
  const isRtl = i18n.dir() === "rtl";
  const dateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language === "he" ? "he-IL" : "en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [i18n.language]
  );
  const scoreFormatter = new Intl.NumberFormat(i18n.language === "he" ? "he-IL" : "en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const formatAnalysisStatus = useCallback(
    (value) => {
      const map = {
        queued: t("videoPlayer.analysisQueued"),
        processing: t("videoPlayer.analysisProcessing"),
        completed: t("videoPlayer.analysisReady"),
        failed: t("videoPlayer.analysisFailed"),
        error: t("videoPlayer.analysisFailed"),
      };
      return map[value] || value || t("videosPage.unknown");
    },
    [t]
  );
  const formatPrivacyStatus = useCallback(
    (value) => {
      const map = {
        queued: t("videoPlayer.privacyQueued"),
        processing: t("videoPlayer.privacyProcessing"),
        completed: t("videoPlayer.privacyReadyLabel"),
        failed: t("videoPlayer.privacyFailedLabel"),
        error: t("videoPlayer.privacyFailedLabel"),
        review_required: t("videoPlayer.privacyNeedsReview"),
        pending_admin_review: t("videoPlayer.privacyNeedsReview"),
      };
      return map[value] || value || t("videosPage.unknown");
    },
    [t]
  );
  const formatGeneralStatus = useCallback(
    (value) => {
      const map = {
        queued: t("labels.queued"),
        processing: t("labels.processing"),
        completed: t("labels.completed"),
        failed: t("labels.failed"),
        error: t("labels.error"),
        review_required: t("labels.reviewRequired"),
        pending_admin_review: t("labels.pendingAdminReview"),
        not_submitted: t("labels.notSubmitted"),
        awarded: t("labels.awarded"),
        not_evaluated: t("labels.notEvaluated"),
      };
      return map[value] || value || t("videosPage.unknown");
    },
    [t]
  );
  const formatMomentPhase = useCallback(
    (value) => {
      const map = {
        lesson_launch: t("videoPlayer.momentPhases.lesson_launch"),
        modeling: t("videoPlayer.momentPhases.modeling"),
        guided_practice: t("videoPlayer.momentPhases.guided_practice"),
        student_work: t("videoPlayer.momentPhases.student_work"),
        check_for_understanding: t("videoPlayer.momentPhases.check_for_understanding"),
        closure: t("videoPlayer.momentPhases.closure"),
      };
      return map[value] || String(value || "").replace(/_/g, " ");
    },
    [t]
  );
  const formatMomentReason = useCallback(
    (value) => {
      const map = {
        participant_density_change: t("videoPlayer.momentReasons.participant_density_change"),
        board_content_change: t("videoPlayer.momentReasons.board_content_change"),
        teacher_prominence: t("videoPlayer.momentReasons.teacher_prominence"),
        visual_novelty: t("videoPlayer.momentReasons.visual_novelty"),
        high_activity_window: t("videoPlayer.momentReasons.high_activity_window"),
        scene_transition: t("videoPlayer.momentReasons.scene_transition"),
        timeline_coverage: t("videoPlayer.momentReasons.timeline_coverage"),
      };
      return map[value] || String(value || "").replace(/_/g, " ");
    },
    [t]
  );
  const formatClock = useCallback((seconds) => {
    const safeSeconds = Math.max(0, Math.round(Number(seconds) || 0));
    const minutes = Math.floor(safeSeconds / 60);
    const remainder = safeSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }, []);
  const formatAnalyzedAt = useCallback(
    (value) => {
      if (!value) return "";
      const parsed = Date.parse(value);
      if (Number.isNaN(parsed)) return value;
      return dateTimeFormatter.format(new Date(parsed));
    },
    [dateTimeFormatter]
  );

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
      toast.success(t("videoPlayer.linkCopied"));
    }).catch(() => {
      toast.error(t("videoPlayer.linkCopyFailed"));
    });
  }, [currentTime, t]);

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

  const privacyStatus = statusRes?.privacy_status || videoRes?.privacy_status || "queued";

  useEffect(() => {
    const token = localStorage.getItem("cognivio_token");
    if (!videoId || !token || !runtimeConfig.backendUrl) return;
    const base = runtimeConfig.backendUrl;
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
  const { data: commentsRes } = useQuery({
    queryKey: ["video-comments", videoId],
    enabled: Boolean(videoId),
    queryFn: () => videoApi.comments(videoId).then((r) => r.data),
  });
  const { data: audioAnalysisRes } = useQuery({
    queryKey: ["video-audio-analysis", videoId],
    enabled: Boolean(videoId),
    retry: false,
    queryFn: () => videoApi.audioAnalysis(videoId).then((r) => r.data),
  });
  const observationSessionId = videoRes?.observation_session_id || videoRes?.session_id;
  const { data: observationSessionRes } = useQuery({
    queryKey: ["observation-session", observationSessionId],
    enabled: Boolean(observationSessionId),
    retry: false,
    queryFn: () => api.get(`/api/observation-sessions/${observationSessionId}`).then((r) => r.data),
  });

  const assessmentId = videoRes?.assessment_id;
  const { data: assessmentRes } = useQuery({
    queryKey: ["assessment", assessmentId],
    enabled: !!assessmentId,
    queryFn: () => assessmentApi.get(assessmentId).then((r) => r.data),
  });
  const assessmentFeedbackEnabled = runtimeConfig.assessmentFeedbackEnabled;
  const { data: assessmentFeedbackRes } = useQuery({
    queryKey: ["assessment-feedback", assessmentId],
    enabled: Boolean(assessmentId) && assessmentFeedbackEnabled,
    queryFn: () => assessmentApi.listFeedback(assessmentId).then((r) => r.data),
  });
  const experimentalMomentRankingEnabled = runtimeConfig.experimentalMomentRankingEnabled;
  const analysisMomentsEnabled =
    Boolean(videoId) &&
    isAdmin &&
    experimentalMomentRankingEnabled &&
    videoStatus === "completed";
  const { data: analysisMomentsRes, isLoading: analysisMomentsLoading } = useQuery({
    queryKey: ["analysis-moments", videoId],
    enabled: analysisMomentsEnabled,
    retry: false,
    queryFn: () => videoApi.analysisMoments(videoId).then((r) => r.data),
  });
  const { data: recognitionRes } = useQuery({
    queryKey: ["video-recognition", videoId],
    enabled: Boolean(videoId),
    queryFn: () => recognitionApi.video(videoId).then((r) => r.data),
    refetchInterval: (query) => {
      const status = query.state.data?.recognition?.status;
      return status === "pending_admin_review" ? 10000 : false;
    },
  });

  const [summaryNotes, setSummaryNotes] = useState("");
  const [actionItems, setActionItems] = useState("");
  const [teacherOptIn, setTeacherOptIn] = useState(false);
  const [sharingScope, setSharingScope] = useState("private");
  const [allowSocialShare, setAllowSocialShare] = useState(false);
  const [allowEmailSignature, setAllowEmailSignature] = useState(false);
  const [exemplarTitle, setExemplarTitle] = useState("");
  const [exemplarSummary, setExemplarSummary] = useState("");
  const [exemplarTags, setExemplarTags] = useState("");
  const [socialCardResult, setSocialCardResult] = useState(null);
  const [emailSignatureResult, setEmailSignatureResult] = useState(null);
  const retryMutation = useMutation({
    mutationFn: () => videoApi.retry(videoId),
    onSuccess: () => {
      toast.success(t("videoPlayer.analysisRequeued"));
      queryClient.invalidateQueries({ queryKey: ["video", videoId] });
      queryClient.invalidateQueries({ queryKey: ["video-status", videoId] });
    },
    onError: (error) => {
      toast.error(error?.response?.data?.detail || t("videoPlayer.analysisRetryFailed"));
    },
  });
  const retryPrivacyMutation = useMutation({
    mutationFn: () => videoApi.retryPrivacy(videoId),
    onSuccess: () => {
      toast.success(t("videoPlayer.privacyRequeued"));
      queryClient.invalidateQueries({ queryKey: ["video", videoId] });
      queryClient.invalidateQueries({ queryKey: ["video-status", videoId] });
    },
    onError: (error) => {
      const detail = error?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : detail?.message || t("videoPlayer.privacyRetryFailed"));
    },
  });
  const createCommentMutation = useMutation({
    mutationFn: (payload) => videoApi.createComment(videoId, payload),
    onSuccess: (response) => {
      toast.success("Note saved.");
      setCommentBody("");
      setIsAddingComment(false);
      setHighlightedCommentId(response?.data?.id || null);
      queryClient.invalidateQueries({ queryKey: ["video-comments", videoId] });
    },
    onError: (error) => {
      const detail = error?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "That note could not be saved right now.");
    },
  });
  const updateCommentMutation = useMutation({
    mutationFn: ({ commentId, payload }) => videoApi.updateComment(videoId, commentId, payload),
    onSuccess: () => {
      toast.success("Note updated.");
      queryClient.invalidateQueries({ queryKey: ["video-comments", videoId] });
    },
    onError: (error) => {
      const detail = error?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "That note could not be updated right now.");
    },
  });
  const deleteCommentMutation = useMutation({
    mutationFn: (commentId) => videoApi.deleteComment(videoId, commentId),
    onSuccess: () => {
      toast.success("Note deleted.");
      queryClient.invalidateQueries({ queryKey: ["video-comments", videoId] });
    },
    onError: (error) => {
      const detail = error?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "That note could not be deleted right now.");
    },
  });
  const saveRecognitionOptInMutation = useMutation({
    mutationFn: (payload) => recognitionApi.updateOptIn(videoId, payload),
    onSuccess: () => {
      toast.success(t("videoPlayer.preferencesSaved"));
      queryClient.invalidateQueries({ queryKey: ["video-recognition", videoId] });
      if (videoRes?.teacher_id) {
        queryClient.invalidateQueries({ queryKey: ["teacher-recognition-summary", videoRes.teacher_id] });
      }
    },
    onError: (error) => {
      const detail = error?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : detail?.message || t("videoPlayer.preferencesSaveFailed"));
    },
  });
  const submitExemplarMutation = useMutation({
    mutationFn: (payload) => exemplarApi.submit(videoId, payload),
    onSuccess: () => {
      toast.success(t("videoPlayer.exemplarQueued"));
      queryClient.invalidateQueries({ queryKey: ["video-recognition", videoId] });
    },
    onError: (error) => {
      const detail = error?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : detail?.message || t("videoPlayer.exemplarFailed"));
    },
  });
  const generateSocialCardMutation = useMutation({
    mutationFn: () =>
      shareAssetApi.createSocialCard(videoId, {
        platform: "linkedin",
        include_subject: true,
        include_grade: false,
        include_summary: true,
      }),
    onSuccess: (response) => {
      setSocialCardResult(response.data);
      toast.success(t("videoPlayer.socialCardGenerated"));
    },
    onError: (error) => {
      const detail = error?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : detail?.message || t("videoPlayer.socialCardFailed"));
    },
  });
  const generateEmailSignatureMutation = useMutation({
    mutationFn: () =>
      shareAssetApi.createEmailSignature(videoId, {
        format: "html",
        badge_style: "compact",
      }),
    onSuccess: (response) => {
      setEmailSignatureResult(response.data);
      toast.success(t("videoPlayer.emailSignatureGenerated"));
    },
    onError: (error) => {
      const detail = error?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : detail?.message || t("videoPlayer.emailSignatureFailed"));
    },
  });

  useEffect(() => {
    const publication = recognitionRes?.publication;
    if (!publication) return;
    setTeacherOptIn(Boolean(publication.teacher_opt_in));
    setSharingScope(publication.sharing_scope || "private");
    setAllowSocialShare(Boolean(publication.teacher_opt_in && publication.allow_social_share));
    setAllowEmailSignature(Boolean(publication.teacher_opt_in && publication.allow_email_signature));
  }, [recognitionRes]);

  useEffect(() => {
    if (!videoRes?.filename || exemplarTitle) return;
    setExemplarTitle(`5-Star Lesson: ${videoRes.filename.replace(/\.[^.]+$/, "")}`);
  }, [videoRes, exemplarTitle]);

  useEffect(() => {
    if (!assessmentRes?.summary || exemplarSummary) return;
    setExemplarSummary(assessmentRes.summary);
  }, [assessmentRes, exemplarSummary]);

  const handleSeek = (seconds) => {
    if (!videoRef.current || typeof seconds !== "number") return;
    videoRef.current.currentTime = seconds;
    videoRef.current.focus();
  };
  const openCommentForm = useCallback(() => {
    if (!isAdmin) return;
    if (videoRef.current) {
      videoRef.current.pause();
      setCurrentTime(Math.floor(videoRef.current.currentTime || 0));
    }
    setIsAddingComment(true);
  }, [isAdmin]);
  const submitComment = useCallback(
    ({ body, timestamp, visibility, focusArea, threadParentId } = {}) => {
      const cleanedBody = (body ?? commentBody).trim();
      if (!cleanedBody) {
        toast.error("Add a note before saving.");
        return;
      }
      const selectedFocus = (observationSessionRes?.focus_elements || []).find(
        (item) => String(item) === String(focusArea ?? commentFocusArea)
      );
      createCommentMutation.mutate({
        timestamp_seconds: Number(timestamp ?? currentTime) || 0,
        body: cleanedBody,
        visibility: visibility || commentVisibility,
        focus_area_id: selectedFocus || focusArea || commentFocusArea || null,
        focus_area_label: selectedFocus || focusArea || commentFocusArea || null,
        thread_parent_id: threadParentId || null,
      });
    },
    [
      commentBody,
      commentFocusArea,
      commentVisibility,
      createCommentMutation,
      currentTime,
      observationSessionRes,
    ]
  );

  useEffect(() => {
    const handleKeyDown = (event) => {
      const target = event.target;
      const tagName = target?.tagName?.toLowerCase();
      const isTyping = tagName === "input" || tagName === "textarea" || target?.isContentEditable;
      if (isTyping || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key?.toLowerCase() === "c") {
        event.preventDefault();
        openCommentForm();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openCommentForm]);

  const handleGenerateReport = () => {
    const win = window.open("", "_blank");
    if (!win) return;
    const observations = observationsRes ?? [];
    const assessment = assessmentRes;
    const reportSummary = observationSummary?.executive_summary || assessment?.summary || "";
    const recommendedMomentsSection = recommendedMomentNoteLines.length
      ? `
          <div class="section">
            <h2>${t("videoPlayer.recommendedMoments")}</h2>
            <ul>
              ${recommendedMomentNoteLines.map((item) => `<li>${item}</li>`).join("")}
            </ul>
          </div>
        `
      : "";
    const html = `
      <html lang="${i18n.language}" dir="${i18n.dir()}">
        <head>
          <title>${t("videoPlayer.reportTitle")}</title>
          <style>
            body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 24px; color: #020617; }
            h1, h2, h3 { margin: 0 0 8px; }
            h1 { font-size: 20px; }
            h2 { font-size: 16px; margin-top: 16px; }
            h3 { font-size: 14px; margin-top: 12px; }
            .section { margin-bottom: 16px; }
            .chip { display:inline-block; padding:2px 8px; border-radius:999px; background:#e5e7eb; font-size:11px; }
            ul { padding-inline-start: 18px; }
          </style>
        </head>
        <body>
          <h1>${t("videoPlayer.reportTitle")}</h1>
          <div class="section">
            <div><strong>${t("videoPlayer.reportVideo")}:</strong> ${videoRes?.filename || ""}</div>
            <div><strong>${t("videoPlayer.reportDate")}:</strong> ${formatAnalyzedAt(assessment?.analyzed_at) || ""}</div>
          </div>
          <div class="section">
            <h2>${t("videoPlayer.reportSummary")}</h2>
            <p>${reportSummary}</p>
            <p>${summaryNotes || ""}</p>
          </div>
          <div class="section">
            <h2>${t("videoPlayer.reportObservations")}</h2>
            <ul>
              ${observations
                .map(
                  (o) =>
                    `<li>${o.admin_comment || ""} ${
                      typeof o.timestamp_seconds === "number"
                        ? `(${formatClock(o.timestamp_seconds)})`
                        : ""
                    }</li>`
                )
                .join("")}
            </ul>
          </div>
          ${recommendedMomentsSection}
          <div class="section">
            <h2>${t("videoPlayer.reportActionItems")}</h2>
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
  const handleAddRecommendedMomentsToActionItems = () => {
    if (!recommendedMomentNoteLines.length) return;
    setActionItems((prev) => {
      const existing = prev?.trim() ? prev.trim().split("\n").filter(Boolean) : [];
      const merged = [...existing];
      recommendedMomentNoteLines.forEach((line) => {
        if (!merged.includes(line)) {
          merged.push(line);
        }
      });
      return merged.join("\n");
    });
  };

  const observations = observationsRes ?? [];
  const videoComments = Array.isArray(commentsRes)
    ? commentsRes
    : Array.isArray(commentsRes?.comments)
      ? commentsRes.comments
      : [];
  const sharedVideoComments = videoComments.filter(
    (comment) => isAdmin || (comment.visibility || (comment.is_private ? "observer_private" : "shared_with_teacher")) === "shared_with_teacher"
  );
  const observationFocusAreas = observationSessionRes?.focus_elements || [];
  const recognitionStatus = recognitionRes?.recognition?.status || "not_evaluated";
  const recognitionEligible = Boolean(recognitionRes?.eligibility?.is_eligible);
  const recognitionReasons = recognitionRes?.eligibility?.reasons || [];
  const publicationStatus = recognitionRes?.publication?.submission_status || "not_submitted";
  const observationSummary = assessmentRes?.observation_summary;
  const teacherFeedback = assessmentRes?.teacher_feedback || null;
  const teacherSummary = teacherFeedback?.latest_summary || {};
  const teacherDeepDiveMoments = teacherFeedback?.deep_dive?.moments || [];
  const visibleSummary = isTeacher && teacherFeedback
    ? [teacherSummary.opening, teacherSummary.strength, teacherSummary.growth_focus, teacherSummary.next_step].filter(Boolean).join(" ")
    : observationSummary?.executive_summary || assessmentRes?.summary || t("videoPlayer.noSummaryAvailable");
  const recommendedMoments = analysisMomentsRes?.moments || [];
  const recommendedMomentNoteLines = recommendedMoments.slice(0, 3).map((moment) => {
    const jumpTime =
      typeof moment.representative_frame_sec === "number"
        ? moment.representative_frame_sec
        : moment.start_sec;
    return `${formatClock(moment.start_sec)}-${formatClock(moment.end_sec)} • ${formatMomentPhase(
      moment.phase
    )} • ${formatMomentReason(moment.selection_reason)} • ${t(
      "videoPlayer.representativeMoment",
      { time: formatClock(jumpTime) }
    )}`;
  });
  const feedbackByTarget = {};
  (assessmentFeedbackRes?.feedback || []).forEach((item) => {
    feedbackByTarget[`${item.target_type}:${item.target_id || ""}`] = item;
  });
  const canSubmitExemplar = recognitionStatus === "awarded" && teacherOptIn;
  const recognitionBadgeLabel =
    recognitionStatus === "awarded"
      ? t("videoPlayer.recognitionAwarded")
      : recognitionStatus === "pending_admin_review"
        ? t("videoPlayer.recognitionPending")
        : recognitionEligible
          ? t("videoPlayer.recognitionEligible")
          : t("videoPlayer.recognitionNotAwarded");
  const recognitionBadgeVariant =
    recognitionStatus === "awarded"
      ? "success"
      : recognitionStatus === "pending_admin_review"
        ? "warning"
        : "neutral";

  const videoUrl =
    privacyStatus === "completed" && videoRes?.playback_url
      ? (videoRes.playback_url.startsWith("http")
          ? videoRes.playback_url
          : `${runtimeConfig.backendUrl}${videoRes.playback_url}`)
      : null;
  const thumbnailUrl =
    videoRes?.thumbnail_url &&
    (videoRes.thumbnail_url.startsWith("http")
      ? videoRes.thumbnail_url
      : `${runtimeConfig.backendUrl}${videoRes.thumbnail_url}`);
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
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-6">
        <PageContextHeader
          breadcrumbs={[
            { label: t("nav.videos"), to: "/videos" },
            { label: videoRes?.filename || t("videoPlayer.lessonRecording") },
          ]}
          title={videoRes?.filename || t("videoPlayer.lessonRecording")}
          description={t("videoPlayer.lessonRecording")}
          quickLinks={[
            videoRes?.teacher_id && isAdmin
              ? {
                  label: t("nav.teachers"),
                  to: `/teachers/${videoRes.teacher_id}`,
                }
              : null,
            assessmentRes?.video_id && videoRes?.teacher_id
              ? {
                  label: t("teacherWorkspace.goalsTitle"),
                  to: isAdmin
                    ? `/teachers/${videoRes.teacher_id}/action-plan`
                    : "/my-workspace/goals",
                }
              : null,
          ]}
          className="mb-4"
        />
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <Badge variant={statusVariant}>
            {t("videoPlayer.status", { status: formatAnalysisStatus(videoStatus) })}
          </Badge>
          <Badge variant={privacyStatus === "completed" ? "success" : privacyStatus === "failed" ? "danger" : "warning"}>
            {t("videoPlayer.privacy", { status: formatPrivacyStatus(privacyStatus) })}
          </Badge>
          <Badge variant={recognitionBadgeVariant}>
            {recognitionBadgeLabel}
          </Badge>
          {privacyStatus === "review_required" && (
            <Link
              to="/privacy-review"
              className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700 hover:bg-amber-100"
            >
              {t("videoPlayer.openPrivacyReview")}
            </Link>
          )}
          {privacyStatus === "failed" && (
            <Button size="sm" variant="danger" onClick={() => retryPrivacyMutation.mutate()} disabled={retryPrivacyMutation.isPending}>
              {retryPrivacyMutation.isPending ? t("videoPlayer.retryingPrivacy") : t("videoPlayer.retryPrivacy")}
            </Button>
          )}
          {(videoStatus === "failed" || videoStatus === "error") && (
            <Button size="sm" variant="danger" onClick={() => retryMutation.mutate()} disabled={retryMutation.isPending}>
              {retryMutation.isPending ? t("videoPlayer.retrying") : t("videoPlayer.retryAnalysis")}
            </Button>
          )}
          {isAdmin && recognitionStatus === "pending_admin_review" && (
            <Link
              to="/recognition-review"
              className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700 hover:bg-amber-100"
            >
              {t("videoPlayer.openRecognitionReview")}
            </Link>
          )}
          <span className="text-[11px] text-slate-400">
            {wsConnected ? t("videoPlayer.liveUpdatesConnected") : t("videoPlayer.liveUpdatesOffline")}
          </span>
          {statusRes?.error_message && (
            <span className="text-[11px] text-rose-600">{statusRes.error_message}</span>
          )}
        </div>
        {observationSessionRes?.focus_elements?.length || observationSessionRes?.focus_note ? (
          <div className="mb-4 rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
            {observationSessionRes?.focus_elements?.length ? (
              <div>
                <span className="font-semibold">You were watching for: </span>
                {observationSessionRes.focus_elements.join(", ")}
              </div>
            ) : null}
            {observationSessionRes?.focus_note ? (
              <div className="mt-1 text-sky-800">
                <span className="font-semibold">Focus note: </span>
                {observationSessionRes.focus_note}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
          <section className="md:col-span-7 space-y-3">
            <Panel padded={false} className="overflow-hidden">
              {videoUrl ? (
                <>
                  <video
                    ref={videoRef}
                    controls
                    className="aspect-video w-full bg-black object-contain"
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
                          showTechnicalDetails={isAdmin}
                        />
                      </div>
                    )}
                    {duration > 0 && sharedVideoComments.length > 0 && (
                      <div className="mb-3">
                        <VideoTimelineMarkers
                          duration={duration}
                          currentTime={currentTime}
                          comments={sharedVideoComments}
                          highlightedCommentId={highlightedCommentId}
                          onSeekTo={handleSeek}
                          onSelectComment={setHighlightedCommentId}
                        />
                      </div>
                    )}
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <span className="text-[11px] text-slate-500">
                        {t("videoPlayer.currentTime", {
                          time: formatClock(currentTime),
                        })}
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {isAdmin ? (
                          <Button variant="secondary" size="sm" onClick={openCommentForm}>
                            Add note at current time
                          </Button>
                        ) : null}
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
                          {t("videoPlayer.copyTimestampLink")}
                        </Button>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <EmptyState
                  className="m-4"
                  title={
                    videoStatus === "queued" || videoStatus === "processing"
                      ? t("videoPlayer.videoProcessing")
                      : t("videoPlayer.videoUnavailable")
                  }
                  message={
                    videoStatus === "queued" || videoStatus === "processing"
                      ? t("videoPlayer.videoProcessingMessage")
                      : t("videoPlayer.videoUnavailableMessage")
                  }
                />
              )}
            </Panel>

            <Panel className="p-4 text-xs text-slate-700">
              <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">
                      {t("videoPlayer.observationSummary")}
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                      {t("videoPlayer.observationSummaryDescription")}
                    </p>
                  </div>
                  {isAdmin && assessmentRes?.overall_score != null && (
                    <Badge variant="success">
                      {t("videoPlayer.scoreSummary", { score: scoreFormatter.format(assessmentRes.overall_score) })}
                    </Badge>
                  )}
                </div>
                <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-slate-700">
                  {visibleSummary}
                </div>
                {assessmentFeedbackEnabled && assessmentId && (
                  <AssessmentFeedbackWidget
                    assessmentId={assessmentId}
                    targetType="summary"
                    targetId="video-summary"
                    surface="video_player"
                    metadata={{ section: "observation_summary" }}
                    existingFeedback={feedbackByTarget["summary:video-summary"]}
                  />
                )}
                {isAdmin ? <ObservationFocusPanel
                  className="mt-3"
                  frameworkType={assessmentRes?.framework_type}
                  priorityElements={assessmentRes?.priority_elements}
                  focusNote={observationSummary?.focus_note || assessmentRes?.focus_note}
                  title={t("videoPlayer.focusContextTitle")}
                  description={t("videoPlayer.focusContextDescription")}
                /> : null}
                {isAdmin && observationSummary?.confidence_note && (
                  <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-[11px] text-amber-800">
                    {observationSummary.confidence_note}
                  </div>
                )}
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {t("videoPlayer.topStrengths")}
                    </div>
                    {isTeacher && teacherFeedback?.highlights?.length ? (
                      <ul className="mt-2 list-disc space-y-1 ps-4 text-xs text-slate-700">
                        {teacherFeedback.highlights.slice(0, 3).map((item) => (
                          <li key={item.id}>{item.body}</li>
                        ))}
                      </ul>
                    ) : observationSummary?.top_strengths?.length ? (
                      <ul className="mt-2 list-disc space-y-1 ps-4 text-xs text-slate-700">
                        {observationSummary.top_strengths.map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <div className="mt-2 text-xs text-slate-500">{t("videoPlayer.noStrengthsAvailable")}</div>
                    )}
                  </div>
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {t("videoPlayer.growthAreas")}
                    </div>
                    {observationSummary?.growth_areas?.length ? (
                      <ul className="mt-2 list-disc space-y-1 ps-4 text-xs text-slate-700">
                        {observationSummary.growth_areas.map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <div className="mt-2 text-xs text-slate-500">{t("videoPlayer.noGrowthAreasAvailable")}</div>
                    )}
                  </div>
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {t("videoPlayer.coachingMoves")}
                    </div>
                    {observationSummary?.coaching_actions?.length ? (
                      <ul className="mt-2 space-y-2 text-xs text-slate-700">
                        {observationSummary.coaching_actions.map((item, idx) => (
                          <li
                            key={idx}
                            className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3"
                          >
                            <div>{item}</div>
                            {assessmentFeedbackEnabled && assessmentId && (
                              <AssessmentFeedbackWidget
                                assessmentId={assessmentId}
                                targetType="recommendation"
                                targetId={`video-coaching-action-${idx}`}
                                surface="video_player"
                                metadata={{
                                  section: "coaching_actions",
                                  recommendation_index: idx,
                                }}
                                existingFeedback={
                                  feedbackByTarget[
                                    `recommendation:video-coaching-action-${idx}`
                                  ]
                                }
                                compact
                              />
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="mt-2 text-xs text-slate-500">{t("videoPlayer.noCoachingMovesAvailable")}</div>
                    )}
                  </div>
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {t("videoPlayer.priorityAlignment")}
                    </div>
                    {observationSummary?.priority_alignment?.length ? (
                      <ul className="mt-2 list-disc space-y-1 ps-4 text-xs text-slate-700">
                        {observationSummary.priority_alignment.map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <div className="mt-2 text-xs text-slate-500">{t("videoPlayer.noPriorityAlignment")}</div>
                    )}
                  </div>
                </div>
              </div>

              <details
                className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4"
                open={recognitionStatus === "awarded" || recognitionStatus === "pending_admin_review"}
              >
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-slate-900">
                        {t("videoPlayer.recognitionSharing")}
                      </h2>
                      <p className="mt-1 text-xs text-slate-600">
                        {t("videoPlayer.recognitionSharingDescription")}
                      </p>
                    </div>
                    <Badge variant={recognitionBadgeVariant}>{formatGeneralStatus(recognitionStatus)}</Badge>
                  </div>
                </summary>
                <div className="mt-3 text-xs text-slate-700">
                  {recognitionEligible ? (
                    <div className="rounded-md border border-emerald-200 bg-white px-3 py-2 text-emerald-700">
                      {t("videoPlayer.lessonQualifies")}
                    </div>
                  ) : (
                    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-600">
                      {recognitionReasons.length
                        ? t("videoPlayer.notYetEligible", { reasons: recognitionReasons.join(", ") })
                        : t("videoPlayer.recognitionWhenComplete")}
                    </div>
                  )}
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <label className="rounded-md border border-slate-200 bg-white px-3 py-3 text-xs text-slate-700">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={teacherOptIn}
                        onChange={(e) => setTeacherOptIn(e.target.checked)}
                      />
                      <span className="font-medium">{t("videoPlayer.optInLesson")}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      {t("videoPlayer.optInLessonDescription")}
                    </div>
                  </label>
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-3 text-xs text-slate-700">
                    <label className="mb-1 block text-[11px] font-medium text-slate-600">
                      {t("videoPlayer.sharingScope")}
                    </label>
                    <select
                      value={sharingScope}
                      onChange={(e) => setSharingScope(e.target.value)}
                      disabled={!teacherOptIn}
                      className="w-full rounded-md border border-slate-200 bg-white px-2 py-2 text-xs text-slate-700 disabled:bg-slate-100"
                    >
                      <option value="private">{t("videoPlayer.privateOnly")}</option>
                      <option value="school_only">{t("videoPlayer.schoolOnly")}</option>
                      <option value="cognivio_library">{t("videoPlayer.cognivioWide")}</option>
                    </select>
                    <div className="mt-2 text-[11px] text-slate-500">
                      {t("videoPlayer.publicationRequiresReview")}
                    </div>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <label className="rounded-md border border-slate-200 bg-white px-3 py-3 text-xs text-slate-700">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={allowSocialShare}
                        disabled={!teacherOptIn}
                        onChange={(e) => setAllowSocialShare(e.target.checked)}
                      />
                      <span className="font-medium">{t("videoPlayer.allowSocialCard")}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      {t("videoPlayer.allowSocialCardDescription")}
                    </div>
                  </label>
                  <label className="rounded-md border border-slate-200 bg-white px-3 py-3 text-xs text-slate-700">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={allowEmailSignature}
                        disabled={!teacherOptIn}
                        onChange={(e) => setAllowEmailSignature(e.target.checked)}
                      />
                      <span className="font-medium">{t("videoPlayer.allowEmailSignature")}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      {t("videoPlayer.allowEmailSignatureDescription")}
                    </div>
                  </label>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      saveRecognitionOptInMutation.mutate({
                        teacher_opt_in: teacherOptIn,
                        sharing_scope: teacherOptIn ? sharingScope : null,
                        allow_social_share: teacherOptIn && allowSocialShare,
                        allow_email_signature: teacherOptIn && allowEmailSignature,
                      })
                    }
                    disabled={saveRecognitionOptInMutation.isPending}
                  >
                    {saveRecognitionOptInMutation.isPending ? t("teachersPage.saving") : t("videoPlayer.saveRecognitionPreferences")}
                  </Button>
                  {recognitionStatus === "awarded" && (
                    <span className="text-[11px] text-emerald-700">
                      {t("videoPlayer.recognitionAwardedNextSteps")}
                    </span>
                  )}
                </div>
                {recognitionStatus === "awarded" && (
                  <>
                    <div className="mt-5 rounded-md border border-slate-200 bg-white px-3 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-semibold text-slate-800">
                            {t("videoPlayer.allStarSubmission")}
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            {t("videoPlayer.currentStatus", { status: formatGeneralStatus(publicationStatus) })}
                          </div>
                        </div>
                        {publicationStatus === "published" && (
                          <Link
                            to="/all-star-library"
                            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
                          >
                            {t("videoPlayer.openLibrary")}
                          </Link>
                        )}
                      </div>
                      <div className="mt-3 grid gap-3">
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-600">
                            {t("videoPlayer.exemplarTitle")}
                          </label>
                          <input
                            type="text"
                            value={exemplarTitle}
                            onChange={(e) => setExemplarTitle(e.target.value)}
                            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-600">
                            {t("videoPlayer.exemplarSummary")}
                          </label>
                          <Textarea
                            rows={3}
                            value={exemplarSummary}
                            onChange={(e) => setExemplarSummary(e.target.value)}
                            size="sm"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-600">
                            {t("videoPlayer.tags")}
                          </label>
                          <input
                            type="text"
                            value={exemplarTags}
                            onChange={(e) => setExemplarTags(e.target.value)}
                            placeholder={t("videoPlayer.tagsPlaceholder")}
                            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
                          />
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          disabled={!canSubmitExemplar || submitExemplarMutation.isPending}
                          onClick={() =>
                            submitExemplarMutation.mutate({
                              title: exemplarTitle,
                              summary: exemplarSummary,
                              sharing_scope: sharingScope,
                              tags: exemplarTags
                                .split(",")
                                .map((item) => item.trim())
                                .filter(Boolean),
                            })
                          }
                        >
                          {submitExemplarMutation.isPending ? t("videoPlayer.submitting") : t("videoPlayer.submitToLibrary")}
                        </Button>
                        {!teacherOptIn && (
                          <span className="text-[11px] text-amber-700">
                            {t("videoPlayer.savePreferencesFirst")}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 rounded-md border border-slate-200 bg-white px-3 py-3">
                      <div className="text-xs font-semibold text-slate-800">
                        {t("videoPlayer.shareAssets")}
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">
                        {t("videoPlayer.shareAssetsDescription")}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={!allowSocialShare || generateSocialCardMutation.isPending}
                          onClick={() => generateSocialCardMutation.mutate()}
                        >
                          {generateSocialCardMutation.isPending ? t("videoPlayer.generating") : t("videoPlayer.generateSocialCard")}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={!allowEmailSignature || generateEmailSignatureMutation.isPending}
                          onClick={() => generateEmailSignatureMutation.mutate()}
                        >
                          {generateEmailSignatureMutation.isPending ? t("videoPlayer.generating") : t("videoPlayer.generateEmailSignature")}
                        </Button>
                      </div>
                      {socialCardResult && (
                        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-[11px] text-slate-600">
                          <div className="font-medium text-slate-800">{t("videoPlayer.socialCardReady")}</div>
                          <a
                            href={socialCardResult.file_url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-flex text-primary hover:underline"
                          >
                            {t("videoPlayer.openSocialCard")}
                          </a>
                          <div className="mt-2 text-slate-500">{socialCardResult.caption}</div>
                        </div>
                      )}
                      {emailSignatureResult && (
                        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-[11px] text-slate-600">
                          <div className="font-medium text-slate-800">{t("videoPlayer.emailSignatureReady")}</div>
                          <a
                            href={emailSignatureResult.image_url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-flex text-primary hover:underline"
                          >
                            {t("videoPlayer.openSignatureBadge")}
                          </a>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(emailSignatureResult.html);
                              toast.success(t("videoPlayer.emailSignatureCopied"));
                            }}
                            className={`${isRtl ? "mr-3" : "ml-3"} inline-flex text-primary hover:underline`}
                          >
                            {t("videoPlayer.copyHtml")}
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </details>
            </Panel>
          </section>

          <section className="md:col-span-5 space-y-3">
            <Panel className="p-4 text-xs">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Timestamped notes</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Capture the exact moments you want to revisit in coaching.
                  </p>
                </div>
                {isAdmin ? (
                  <Button size="sm" variant="secondary" onClick={openCommentForm}>
                    Add note
                  </Button>
                ) : null}
              </div>
              {isAddingComment && isAdmin ? (
                <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="mb-2 text-xs font-semibold text-slate-700">
                    Note at {formatClock(currentTime)}
                  </div>
                  {observationFocusAreas.length ? (
                    <label className="mb-2 block text-xs text-slate-600">
                      Focus area
                      <select
                        value={commentFocusArea}
                        onChange={(event) => setCommentFocusArea(event.target.value)}
                        className="mt-1 min-h-[40px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
                      >
                        <option value="">Choose a focus area</option>
                        {observationFocusAreas.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <label className="mb-2 block text-xs text-slate-600">
                    Visibility
                    <select
                      value={commentVisibility}
                      onChange={(event) => setCommentVisibility(event.target.value)}
                      className="mt-1 min-h-[40px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
                    >
                      <option value="observer_private">Private note</option>
                      <option value="shared_with_teacher">Share with teacher</option>
                      <option value="admin_only">Admin only</option>
                    </select>
                  </label>
                  <Textarea
                    rows={4}
                    value={commentBody}
                    onChange={(event) => setCommentBody(event.target.value)}
                    placeholder="Name what happened here and what you want to follow up on."
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => submitComment()}
                      disabled={createCommentMutation.isPending || !commentBody.trim()}
                    >
                      Save note
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setIsAddingComment(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
              <VideoCommentThread
                comments={sharedVideoComments}
                currentUser={user}
                highlightedCommentId={highlightedCommentId}
                isAdminView={isAdmin}
                onSeekTo={(seconds) => {
                  handleSeek(seconds);
                  setHighlightedCommentId(null);
                }}
                onReply={(comment, body) =>
                  submitComment({
                    body,
                    timestamp: comment.timestamp_seconds,
                    visibility: comment.visibility,
                    focusArea: comment.focus_area_label || comment.focus_area_id,
                    threadParentId: comment.id,
                  })
                }
                onEdit={(comment, body) =>
                  updateCommentMutation.mutate({ commentId: comment.id, payload: { body } })
                }
                onDelete={(comment) => deleteCommentMutation.mutate(comment.id)}
              />
              {!isAdmin && isTeacher ? (
                <p className="mt-3 text-xs leading-5 text-slate-500">
                  Shared notes are moments to revisit, not a scorecard. Start with what you want to keep using.
                </p>
              ) : null}
            </Panel>

            <Panel className="p-4 text-xs">
              <h2 className="mb-2 text-sm font-semibold text-slate-900">Talk-time and transcript</h2>
              <div className="mb-3 flex flex-wrap gap-2">
                {[
                  ["talk", "Talk time"],
                  ["timeline", "Audio timeline"],
                  ["transcript", "Transcript"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setAudioTab(key)}
                    className={`min-h-[36px] rounded-md px-3 text-xs font-medium ${
                      audioTab === key
                        ? "bg-primary text-white"
                        : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {audioTab === "talk" ? (
                <TalkTimeChart analysis={audioAnalysisRes} isTeacherView={isTeacher} />
              ) : null}
              {audioTab === "timeline" ? (
                <AudioTimeline
                  segments={audioAnalysisRes?.segments || []}
                  keyMoments={audioAnalysisRes?.key_moments || []}
                  duration={audioAnalysisRes?.total_duration_seconds || duration}
                  onSeek={handleSeek}
                />
              ) : null}
              {audioTab === "transcript" ? (
                <div className="space-y-2">
                  {audioAnalysisRes?.student_transcript_suppressed ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                      Student transcript is hidden based on the workspace privacy setting.
                    </div>
                  ) : null}
                  {audioAnalysisRes?.transcript_segments?.length ? (
                    audioAnalysisRes.transcript_segments.map((segment, index) => (
                      <button
                        key={`${segment.start_sec}-${index}`}
                        type="button"
                        onClick={() => handleSeek(Number(segment.start_sec) || 0)}
                        className="block w-full rounded-md border border-slate-200 bg-white px-3 py-3 text-left text-sm leading-6 text-slate-700 hover:bg-slate-50"
                      >
                        <span className="mr-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                          {formatClock(segment.start_sec)}
                        </span>
                        {segment.text}
                      </button>
                    ))
                  ) : (
                    <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                      Transcript will appear here when audio review is available.
                    </div>
                  )}
                </div>
              ) : null}
            </Panel>

            {analysisMomentsEnabled && (
              <Panel className="p-4 text-xs">
                <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">
                      {t("videoPlayer.recommendedMoments")}
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                      {t("videoPlayer.recommendedMomentsDescription")}
                    </p>
                  </div>
                  {analysisMomentsRes?.strategy_version ? (
                    <Badge variant="neutral">{analysisMomentsRes.strategy_version}</Badge>
                  ) : null}
                </div>
                {analysisMomentsLoading ? (
                  <div className="text-xs text-slate-500">
                    {t("videoPlayer.loadingRecommendedMoments")}
                  </div>
                ) : recommendedMoments.length ? (
                  <ul className="space-y-2">
                    {recommendedMoments.slice(0, 5).map((moment) => (
                      <li key={moment.moment_id}>
                        <button
                          type="button"
                          onClick={() =>
                            handleSeek(
                              typeof moment.representative_frame_sec === "number"
                                ? moment.representative_frame_sec
                                : moment.start_sec
                            )
                          }
                          className={`w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 hover:border-slate-300 hover:bg-slate-100 ${isRtl ? "text-right" : "text-left"}`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-semibold text-slate-900">
                              {formatClock(moment.start_sec)}-{formatClock(moment.end_sec)}
                            </span>
                            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600">
                              {formatMomentPhase(moment.phase)}
                            </span>
                          </div>
                          <div className="mt-1 text-[11px] text-slate-600">
                            {formatMomentReason(moment.selection_reason)}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                            <span className="text-slate-500">
                              {t("videoPlayer.representativeMoment", {
                                time: formatClock(moment.representative_frame_sec || moment.start_sec),
                              })}
                            </span>
                            <span className="font-medium text-primary">
                              {t("videoPlayer.jumpToMoment")}
                            </span>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-xs text-slate-500">
                    {t("videoPlayer.noRecommendedMoments")}
                  </div>
                )}
              </Panel>
            )}

            {isAdmin ? (
            <Panel className="p-4 text-xs">
              <h2 className="mb-2 text-sm font-semibold text-slate-900">
                {t("videoPlayer.timestampedObservations")}
              </h2>
              {observations.length === 0 ? (
                <div className="text-xs text-slate-500">
                  {t("videoPlayer.noObservations")}
                </div>
              ) : (
                <ul className="space-y-1">
                  {observations.map((o) => (
                    <li key={o.id}>
                      <button
                        type="button"
                        onClick={() => handleSeek(o.timestamp_seconds)}
                        className={`w-full rounded-md px-2 py-1 ${isRtl ? "text-right" : "text-left"} text-xs text-slate-700 hover:bg-slate-100`}
                      >
                        <span className={`${isRtl ? "ml-2" : "mr-2"} inline-flex min-w-[46px] items-center justify-center rounded-full bg-slate-200 px-2 py-0.5 text-[10px] text-slate-700`}>
                          {typeof o.timestamp_seconds === "number"
                            ? formatClock(o.timestamp_seconds)
                            : "--"}
                        </span>
                        {o.admin_comment || t("videoPlayer.observationFallback")}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            ) : null}

            <Panel className="p-4 text-xs">
              {videoRes?.teacher_id ? (
                <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("videoPlayer.continueCoachingThreadTitle")}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      to={resolveCoachingLink(user, videoRes.teacher_id, null)}
                      className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                    >
                      {t("videoPlayer.openTeacherThread")}
                    </Link>
                    <Link
                      to={resolveCoachingLink(user, videoRes.teacher_id, "action_plan")}
                      className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                    >
                      {t("videoPlayer.openActionPlan")}
                    </Link>
                    <Link
                      to={resolveCoachingLink(user, videoRes.teacher_id, "reflection")}
                      className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                    >
                      {t("videoPlayer.openReflectionRecord")}
                    </Link>
                  </div>
                </div>
              ) : null}
              <h2 className="mb-2 text-sm font-semibold text-slate-900">
                {t("videoPlayer.summaryActionItems")}
              </h2>
              <div className="mb-2 text-xs text-slate-600">
                {visibleSummary}
              </div>
              {isTeacher && teacherDeepDiveMoments.length ? (
                <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Moments to revisit</div>
                  <ul className="mt-2 space-y-2 text-xs text-slate-700">
                    {teacherDeepDiveMoments.slice(0, 4).map((moment) => (
                      <li key={moment.id}>
                        <span className="font-semibold">{moment.start_sec != null ? `${formatClock(moment.start_sec)} ` : ""}</span>
                        {moment.what_happened} {moment.why_it_matters}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {recommendedMomentNoteLines.length ? (
                <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {t("videoPlayer.recommendedMomentsForConference")}
                      </div>
                      <ul className="mt-2 space-y-1 text-xs text-slate-700">
                        {recommendedMomentNoteLines.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={handleAddRecommendedMomentsToActionItems}
                    >
                      {t("videoPlayer.addMomentsToActionItems")}
                    </Button>
                  </div>
                </div>
              ) : null}
              <Field label={t("videoPlayer.additionalSummaryNotes")} className="mb-2">
                <Textarea
                  rows={2}
                  value={summaryNotes}
                  onChange={(e) => setSummaryNotes(e.target.value)}
                  size="sm"
                />
              </Field>
              <Field label={t("videoPlayer.actionItemsNextLesson")} className="mb-3">
                <Textarea
                  rows={2}
                  value={actionItems}
                  onChange={(e) => setActionItems(e.target.value)}
                  size="sm"
                />
              </Field>
              <Button size="sm" onClick={handleGenerateReport}>
                {t("videoPlayer.generateReport")}
              </Button>
            </Panel>

            {isAdmin ? (
            <Panel className="p-4 text-xs">
              <h2 className="mb-2 text-sm font-semibold text-slate-900">
                {t("videoPlayer.detailedRubricView")}
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
                          {scoreFormatter.format(es.score)}/10
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
                  {t("videoPlayer.noAiInsights")}
                </div>
              )}
            </Panel>
            ) : null}
          </section>
        </div>
      </div>
    </LayoutShell>
  );
}

