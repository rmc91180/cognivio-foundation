import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Award,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ExternalLink,
  MessageSquareText,
  PlayCircle,
  Share2,
  Sparkles,
} from "lucide-react";
import api from "@/lib/apiClient";
import { actionPlanApi, assessmentApi, recognitionApi, teacherApi } from "@/lib/api";
import { LayoutShell } from "@/components/LayoutShell";
import { Button, Field, Input, PageContextHeader, Panel, SectionHeader } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { buildInstitutionContextTags } from "@/lib/institutionContext";

const COPY = {
  en: {
    pageTitle: "My Workspace",
    pageDescription: "A calm place to see your latest feedback, choose a next move, and keep track of growth.",
    roleMeta: "Teacher-owned workspace",
    roleBadge: "Teacher workspace",
    latestLessonTitle: "Your latest lesson",
    latestLessonDescription: "Start with the newest reviewed class and one small move to try next.",
    latestLessonEmpty:
      "Your first lesson summary will appear here once a recording has been reviewed. You'll get specific, helpful feedback.",
    lessonDate: "Lesson date",
    subject: "Subject",
    coachingSummary: "Coaching summary",
    actionCardsTitle: "Try next",
    markAsTried: "Mark as tried",
    tried: "Tried",
    watchLesson: "Watch the lesson",
    talkTimeTitle: "Talk time",
    teacherVoice: "Teacher voice",
    studentVoice: "Student voice",
    goalsTitle: "What you're working on",
    goalsDescription: "Open goals from recent coaching conversations.",
    goalsEmpty: "Your goals will appear here after your first reviewed lesson.",
    fromLesson: "From",
    lessonFallback: "Recent lesson",
    openLesson: "Open lesson",
    iTriedThis: "I tried this",
    reflectionPrompt: "Write two sentences about what you tried and what you noticed.",
    reflectionPlaceholder: "I tried... I noticed...",
    saveReflection: "Save reflection",
    cancel: "Cancel",
    recognitionTitle: "Your recognition",
    recognitionDescription: "Recent badges and moments worth celebrating.",
    recognitionEmpty: "Complete more observations to earn recognition",
    awardedFor: "Awarded for",
    earned: "Earned",
    share: "Share",
    linkCopied: "Link copied!",
    viewAll: "View all",
    reflectionsTitle: "Your reflections",
    reflectionsDescription: "Past notes you have saved after trying something new.",
    reflectionsEmpty: "Your reflections will gather here as you try ideas and notice what changes.",
    showReflections: "Show reflections",
    hideReflections: "Hide reflections",
    goalAddressed: "Goal addressed",
    addReflection: "Add a reflection",
    reflectionFreePlaceholder: "Write a short note about something you tried, noticed, or want to remember.",
    saveFailed: "Could not save that yet. Please try again.",
    saved: "Saved",
    preparing: "Preparing your workspace...",
    noLinkedTeacherTitle: "Let’s set up your teacher workspace",
    noLinkedTeacherDescription:
      "Add a few teaching details so Cognivio can connect this account to your workspace.",
    profileCreateSyncNote: "This creates your private teacher profile for lesson reviews and coaching notes.",
    profileSubjectLabel: "Subject",
    profileSubjectPlaceholder: "Math, science, history...",
    profileGradeLevelLabel: "Grade level",
    profileGradeLevelPlaceholder: "Grade 6, high school...",
    profileDepartmentLabel: "Department",
    profileDepartmentPlaceholder: "Optional",
    profileCreateCta: "Create my workspace",
    profileCreatePending: "Creating...",
    profileCreateSuccess: "Your workspace is ready.",
    profileCreateFailed: "Could not create your workspace yet.",
    linkedOrganizationLabel: "Organization",
    linkedSchoolLabel: "School",
    linkedAdminNameLabel: "Coach",
    linkedAdminNotAssigned: "Not assigned yet",
    fallbackName: "Teacher",
    recognizedLesson: "Recognized lesson",
    shiningLesson: "A lesson where your classroom practice stood out.",
  },
  he: {
    pageTitle: "מרחב העבודה שלי",
    pageDescription: "מקום שקט לראות משוב חדש, לבחור צעד קטן קדימה ולעקוב אחרי צמיחה.",
    roleMeta: "מרחב בבעלות המורה",
    roleBadge: "מרחב מורה",
    latestLessonTitle: "השיעור האחרון שלך",
    latestLessonDescription: "מתחילים מהשיעור האחרון שנבדק ומצעד קטן שכדאי לנסות.",
    latestLessonEmpty: "סיכום השיעור הראשון שלך יופיע כאן לאחר שהקלטה תיבדק. תקבל/י משוב ממוקד ומועיל.",
    lessonDate: "תאריך השיעור",
    subject: "מקצוע",
    coachingSummary: "סיכום אימוני",
    actionCardsTitle: "מה לנסות עכשיו",
    markAsTried: "סימנתי שניסיתי",
    tried: "נוסה",
    watchLesson: "צפייה בשיעור",
    talkTimeTitle: "זמן דיבור",
    teacherVoice: "קול המורה",
    studentVoice: "קול התלמידים",
    goalsTitle: "על מה עובדים עכשיו",
    goalsDescription: "יעדים פתוחים מתוך שיחות האימון האחרונות.",
    goalsEmpty: "היעדים שלך יופיעו כאן אחרי השיעור הראשון שייבדק.",
    fromLesson: "מתוך",
    lessonFallback: "שיעור אחרון",
    openLesson: "פתיחת שיעור",
    iTriedThis: "ניסיתי את זה",
    reflectionPrompt: "כתבו שני משפטים על מה ניסיתם ומה שמתם לב שקרה.",
    reflectionPlaceholder: "ניסיתי... שמתי לב ש...",
    saveReflection: "שמירת רפלקציה",
    cancel: "ביטול",
    recognitionTitle: "ההוקרה שלך",
    recognitionDescription: "תגים ורגעים אחרונים שכדאי לחגוג.",
    recognitionEmpty: "השלימו עוד תצפיות כדי לקבל הוקרה.",
    awardedFor: "הוענק עבור",
    earned: "התקבל בתאריך",
    share: "שיתוף",
    linkCopied: "הקישור הועתק!",
    viewAll: "הצגת הכל",
    reflectionsTitle: "הרפלקציות שלך",
    reflectionsDescription: "רשימות עבר ששמרת לאחר שניסית משהו חדש.",
    reflectionsEmpty: "הרפלקציות שלך ייאספו כאן כשתנסו רעיונות ותשימו לב מה משתנה.",
    showReflections: "הצגת רפלקציות",
    hideReflections: "הסתרת רפלקציות",
    goalAddressed: "יעד שהתייחסתי אליו",
    addReflection: "הוספת רפלקציה",
    reflectionFreePlaceholder: "כתבו הערה קצרה על משהו שניסיתם, שמתם לב אליו או תרצו לזכור.",
    saveFailed: "לא הצלחנו לשמור כרגע. נסו שוב.",
    saved: "נשמר",
    preparing: "מכינים את מרחב העבודה שלך...",
    noLinkedTeacherTitle: "בואו נגדיר את מרחב העבודה שלך",
    noLinkedTeacherDescription: "הוסיפו כמה פרטי הוראה כדי ש-Cognivio יחבר את החשבון למרחב שלך.",
    profileCreateSyncNote: "כך נוצר פרופיל מורה פרטי לסיכומי שיעור והערות אימון.",
    profileSubjectLabel: "מקצוע",
    profileSubjectPlaceholder: "מתמטיקה, מדעים, היסטוריה...",
    profileGradeLevelLabel: "שכבת גיל",
    profileGradeLevelPlaceholder: "כיתה ו, תיכון...",
    profileDepartmentLabel: "מחלקה",
    profileDepartmentPlaceholder: "אופציונלי",
    profileCreateCta: "יצירת המרחב שלי",
    profileCreatePending: "יוצר...",
    profileCreateSuccess: "מרחב העבודה מוכן.",
    profileCreateFailed: "לא הצלחנו ליצור את המרחב כרגע.",
    linkedOrganizationLabel: "ארגון",
    linkedSchoolLabel: "בית ספר",
    linkedAdminNameLabel: "מלווה",
    linkedAdminNotAssigned: "עדיין לא שובץ",
    fallbackName: "מורה",
    recognizedLesson: "שיעור שזכה להוקרה",
    shiningLesson: "שיעור שבו הפרקטיקה הכיתתית שלך בלטה לטובה.",
  },
};

function isNotFound(error) {
  return error?.response?.status === 404;
}

function getArrayPayload(payload, keys = ["items", "goals", "tasks", "badges", "history"]) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

function stripRubricAndScores(value) {
  if (!value) return "";
  return String(value)
    .replace(/(^|\n)\s*\d+\.\s*/g, "$1")
    .replace(/\b[1-4][a-z]\b[:.)-]?\s*/gi, "")
    .replace(/\bEvidence-Based Observation Highlights\b/gi, "")
    .replace(/\bInstructional Snapshot\b/gi, "")
    .replace(/\bStrengths to Keep and Build On\b/gi, "")
    .replace(/\bPrimary Growth Focus\b/gi, "")
    .replace(/\bActionable Next Steps\b/gi, "")
    .replace(/\bLongitudinal Insight\b/gi, "")
    .replace(/\bReflection Prompts\b/gi, "")
    .replace(/\b5[-\s]?star\b/gi, "star")
    .replace(/\bscore(?:d)?\s*(?:of|:)?\s*\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?/gi, "")
    .replace(/\b\d+(?:\.\d+)?\s*\/\s*(?:10|4)\b/g, "")
    .replace(/\boverall\s+performance\s*:\s*/gi, "")
    .replace(/\brubric[-\s]?aligned\b/gi, "")
    .replace(/\brubric\b/gi, "")
    .replace(/\bassessments?\b/gi, "lesson review")
    .replace(/\banalysis\b/gi, "review")
    .replace(/\banalyses\b/gi, "reviews")
    .replace(/\bevidence\b/gi, "lesson notes")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function getCoachText(value, fallback = "", maxSentences = 3) {
  const cleaned = stripRubricAndScores(value || fallback);
  if (!cleaned) return "";
  const sentences = cleaned.match(/[^.!?。؟]+[.!?。؟]*/g);
  if (!sentences?.length) return cleaned;
  return sentences.slice(0, maxSentences).join(" ").trim();
}

function formatDate(value, locale, fallback = "") {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(parsed));
}

function getTeacherId(user) {
  return user?.teacher_id || user?.teacher?.id || user?.teacher_ids?.[0] || null;
}

function getLessonSourceFromEvidence(records = []) {
  const record = records.find((item) => item?.video_id || item?.title);
  if (!record) return null;
  return {
    label: stripRubricAndScores(record.title) || null,
    videoId: record.video_id || null,
    date: record.created_at || null,
  };
}

function normalizeRecommendation(item, index, latestLesson) {
  const text =
    typeof item === "string"
      ? item
      : item?.what_to_try ||
        item?.text ||
        item?.title ||
        item?.summary ||
        item?.description ||
        item?.action;

  return {
    id: item?.id || item?.task_id || item?.goal_id || `recommendation-${index}`,
    taskId: item?.task_id || item?.coaching_task_id || item?.id || null,
    text: getCoachText(text, "", 2),
    videoId: item?.video_id || latestLesson?.videoId || null,
  };
}

function normalizeLatestLesson(endpointPayload, dashboardPayload, copy) {
  const direct = endpointPayload?.lesson || endpointPayload?.latest_lesson || endpointPayload;
  const dashboardAssessments = dashboardPayload?.assessments || [];
  const latestAssessment = [...dashboardAssessments].sort(
    (a, b) => Date.parse(b?.analyzed_at || b?.created_at || 0) - Date.parse(a?.analyzed_at || a?.created_at || 0)
  )[0];
  const dashboardVideos = dashboardPayload?.videos || [];
  const matchedVideo =
    dashboardVideos.find((video) => video.id && video.id === latestAssessment?.video_id) || dashboardVideos[0] || null;

  const lesson = direct?.id || direct?.video_id || direct?.assessment_id ? direct : latestAssessment;
  if (!lesson) return null;

  const observationSummary = lesson.observation_summary || direct?.observation_summary || {};
  const summary =
    direct?.coaching_summary ||
    direct?.coach_summary ||
    observationSummary.executive_summary ||
    lesson.summary ||
    "";
  const recommendations =
    direct?.recommendations ||
    direct?.action_cards ||
    direct?.actions ||
    observationSummary.actionable_next_steps_structured ||
    observationSummary.coaching_actions ||
    lesson.recommendations ||
    [];

  const normalizedRecommendations = getArrayPayload(recommendations, ["items", "recommendations", "actions"])
    .map((item, index) => normalizeRecommendation(item, index, lesson))
    .filter((item) => item.text)
    .slice(0, 2);

  return {
    assessmentId: lesson.assessment_id || lesson.id || null,
    videoId: direct?.video_id || lesson.video_id || matchedVideo?.id || null,
    date:
      direct?.lesson_date ||
      direct?.recorded_at ||
      lesson.recorded_at ||
      matchedVideo?.recorded_at ||
      lesson.analyzed_at ||
      lesson.created_at ||
      matchedVideo?.upload_date ||
      null,
    subject: direct?.subject || lesson.subject || matchedVideo?.subject || dashboardPayload?.teacher?.subject || "",
    summary: getCoachText(summary, "", 3),
    recommendations: normalizedRecommendations,
    audio: direct?.audio_data || direct?.audio_features || direct?.talk_time || direct?.talkTime || null,
    title: direct?.title || matchedVideo?.filename || copy.lessonFallback,
  };
}

function normalizeGoal(item, index, latestLesson, copy) {
  const source =
    item?.lesson ||
    getLessonSourceFromEvidence(item?.evidence_records || item?.linked_evidence_records || []) ||
    null;
  const title =
    item?.goal_text ||
    item?.title ||
    item?.summary ||
    item?.description ||
    item?.context_label ||
    item?.support_prompt;
  const videoId = item?.video_id || source?.videoId || latestLesson?.videoId || null;

  return {
    id: item?.goal_id || item?.id || `goal-${index}`,
    taskId: item?.task_id || item?.coaching_task_id || (String(item?.id || "").startsWith("goal-") ? item.id : null),
    isActionPlanGoal: Boolean(item?.goal_text || item?.recommended_action || item?.teacher_notes),
    text: getCoachText(title, "", 2),
    recommendedAction: getCoachText(item?.recommended_action || item?.suggested_action || "", "", 2),
    teacherNotes: item?.teacher_notes || "",
    triedAt: item?.teacher_marked_tried_at || null,
    sourceLabel: stripRubricAndScores(source?.label || item?.lesson_title || item?.source_lesson_title || copy.lessonFallback),
    sourceDate: source?.date || item?.lesson_date || item?.due_at || latestLesson?.date || null,
    videoId,
    assessmentId: item?.assessment_id || null,
  };
}

function normalizeActiveGoals(payload, latestLesson, copy) {
  const directGoals = getArrayPayload(payload?.activeGoals, ["items", "goals", "tasks"]);
  const actionPlanGoals = (payload?.actionPlan?.goals || []).filter(
    (goal) => !["complete", "completed", "implemented"].includes(String(goal?.status || "").toLowerCase())
  );
  const coachingTasks = (payload?.coachingTasks?.tasks || []).filter((task) =>
    ["goal_checkpoint_due", "new_evidence_ready", "awaiting_teacher_response"].includes(task?.state)
  );

  const source = directGoals.length ? directGoals : actionPlanGoals.length ? actionPlanGoals : coachingTasks;
  const seen = new Set();
  return source
    .map((item, index) => normalizeGoal(item, index, latestLesson, copy))
    .filter((goal) => {
      if (!goal.text || seen.has(goal.id)) return false;
      seen.add(goal.id);
      return true;
    })
    .slice(0, 3);
}

function normalizeBadge(item, index, copy) {
  const assetUrl =
    item?.icon_url ||
    item?.badge_url ||
    item?.share_asset_url ||
    item?.asset_url ||
    item?.social_card_url ||
    item?.share_card_url ||
    item?.share_asset?.file_url ||
    item?.latest_share_asset?.file_url ||
    "";
  const badgeType = String(item?.badge_type || item?.type || "").replace(/[_-]+/g, " ");
  const awardedFor =
    item?.awarded_for ||
    item?.reason ||
    item?.title ||
    item?.criteria_snapshot?.title ||
    (badgeType ? copy.recognizedLesson : copy.shiningLesson);

  return {
    id: item?.id || `badge-${index}`,
    videoId: item?.video_id || null,
    assetUrl,
    title: getCoachText(badgeType || copy.recognizedLesson, copy.recognizedLesson, 1).replace(/\b5[-\s]?star\b/gi, "Star"),
    awardedFor: getCoachText(awardedFor, copy.shiningLesson, 2),
    earnedAt: item?.awarded_at || item?.earned_at || item?.created_at || null,
    shareUrl: item?.share_url || item?.public_url || assetUrl || "",
  };
}

function normalizeBadges(payload, copy) {
  const badges = getArrayPayload(payload, ["items", "badges"]);
  return badges
    .filter((badge) => !badge?.status || badge.status === "awarded")
    .map((badge, index) => normalizeBadge(badge, index, copy))
    .sort((a, b) => Date.parse(b.earnedAt || 0) - Date.parse(a.earnedAt || 0))
    .slice(0, 3);
}

function normalizeReflection(entry, index, copy) {
  const source = getLessonSourceFromEvidence(entry?.linked_evidence_records || []);
  const goalTitle = entry?.linked_goal_titles?.[0] || entry?.goal_title || "";
  return {
    id: entry?.id || `reflection-${index}`,
    date: source?.date || entry?.lesson_date || entry?.saved_at || entry?.created_at || "",
    text: getCoachText(entry?.self_reflection || entry?.reflection_text || entry?.text, "", 3),
    goalTitle: getCoachText(goalTitle, copy.lessonFallback, 1),
  };
}

function normalizeReflections(payload, copy) {
  const entries = [...(payload?.current_entries || []), ...(payload?.history || getArrayPayload(payload))];
  return entries
    .filter((entry) => !entry?.author_role || entry.author_role === "teacher")
    .map((entry, index) => normalizeReflection(entry, index, copy))
    .filter((entry) => entry.text)
    .sort((a, b) => Date.parse(b.date || 0) - Date.parse(a.date || 0));
}

async function fetchLatestLesson(teacherId) {
  try {
    const response = await api.get(`/api/teachers/${teacherId}/latest-lesson`);
    return response.data;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function fetchActiveGoalPayload(teacherId) {
  const [activeGoalsRes, coachingTasksRes, actionPlanRes] = await Promise.allSettled([
    api.get(`/api/teachers/${teacherId}/active-goals`),
    teacherApi.coachingTasks({ teacher_id: teacherId }),
    actionPlanApi.get(teacherId),
  ]);

  return {
    activeGoals: activeGoalsRes.status === "fulfilled" ? activeGoalsRes.value.data : null,
    coachingTasks: coachingTasksRes.status === "fulfilled" ? coachingTasksRes.value.data : null,
    actionPlan: actionPlanRes.status === "fulfilled" ? actionPlanRes.value.data : null,
  };
}

async function fetchMyBadges(teacherId) {
  try {
    const response = await api.get("/api/recognition/my-badges");
    return response.data;
  } catch (error) {
    if (!isNotFound(error)) throw error;
    const response = await recognitionApi.teacherSummary(teacherId);
    return response.data;
  }
}

async function fetchReflectionHistory(teacherId) {
  try {
    const response = await api.get(`/api/assessments/teacher-reflection-history/${teacherId}`);
    return response.data;
  } catch (error) {
    if (!isNotFound(error)) throw error;
    const response = await assessmentApi.teacherReflectionHistory(teacherId);
    return response.data;
  }
}

function WorkspacePanel({ title, description, icon: Icon, children }) {
  return (
    <Panel as="section" className="space-y-5 border border-slate-200 bg-white p-5">
      <div className="flex items-start gap-3">
        {Icon ? (
          <div className="mt-0.5 rounded-md border border-slate-200 bg-slate-50 p-2 text-primary">
            <Icon className="h-4 w-4" />
          </div>
        ) : null}
        <SectionHeader title={title} description={description} />
      </div>
      {children}
    </Panel>
  );
}

function EncouragingEmpty({ children }) {
  return (
    <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm leading-6 text-slate-600">
      {children}
    </div>
  );
}

function TalkTimeChart({ audio, copy }) {
  const rawRatio =
    audio?.teacher_talk_ratio ??
    audio?.teacherTalkRatio ??
    audio?.teacher_ratio ??
    audio?.teacher ??
    null;
  const teacherRatio = Number.isFinite(Number(rawRatio))
    ? Math.max(0.08, Math.min(0.92, Number(rawRatio)))
    : 0.5;
  const studentRatio = 1 - teacherRatio;

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-4">
      <div className="mb-3 text-sm font-semibold text-slate-900">{copy.talkTimeTitle}</div>
      <div className="flex h-3 overflow-hidden rounded-full bg-white">
        <div className="bg-primary" style={{ flex: teacherRatio }} />
        <div className="bg-emerald-400" style={{ flex: studentRatio }} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-slate-600">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-primary" />
          <span>{copy.teacherVoice}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          <span>{copy.studentVoice}</span>
        </div>
      </div>
    </div>
  );
}

export function TeacherWorkspacePage() {
  const { i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { user, refreshUser } = useAuth();
  const copy = i18n.language?.startsWith("he") ? COPY.he : COPY.en;
  const locale = i18n.language?.startsWith("he") ? "he-IL" : "en-US";
  const isRtl = i18n.dir() === "rtl";
  const teacherId = getTeacherId(user);

  const [profileSubject, setProfileSubject] = useState("");
  const [profileGradeLevel, setProfileGradeLevel] = useState("");
  const [profileDepartment, setProfileDepartment] = useState("");
  const [triedActionIds, setTriedActionIds] = useState(() => new Set());
  const [activeGoalReflectionId, setActiveGoalReflectionId] = useState(null);
  const [goalReflectionText, setGoalReflectionText] = useState("");
  const [reflectionsOpen, setReflectionsOpen] = useState(false);
  const [addingReflection, setAddingReflection] = useState(false);
  const [freeReflectionText, setFreeReflectionText] = useState("");
  const [teacherReflectionText, setTeacherReflectionText] = useState("");
  const [adminEmail, setAdminEmail] = useState("");

  const linkedSchoolName = user?.school_name || null;
  const linkedOrganizationName = user?.organization_name || null;
  const linkedAdminName = user?.manager_name || user?.manager_email || null;
  const institutionTags = buildInstitutionContextTags({
    subject: user,
    schoolLabel: copy.linkedSchoolLabel,
    organizationLabel: copy.linkedOrganizationLabel,
    managerLabel: copy.linkedAdminNameLabel,
    unknownLabel: copy.linkedAdminNotAssigned,
  });

  const { data: teacherRes } = useQuery({
    queryKey: ["teacher", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => teacherApi.get(teacherId).then((response) => response.data),
  });

  const { data: linkedAdmin } = useQuery({
    queryKey: ["teacher-my-admin"],
    queryFn: () => teacherApi.myAdmin().then((response) => response.data),
  });

  const { data: latestLessonPayload, isLoading: latestLessonLoading } = useQuery({
    queryKey: ["teacher-latest-lesson", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => fetchLatestLesson(teacherId),
  });

  const { data: dashboardPayload } = useQuery({
    queryKey: ["teacher-dashboard-latest-workspace", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => {
      const end = new Date();
      const start = new Date();
      start.setMonth(end.getMonth() - 6);
      return assessmentApi
        .teacherDashboard(teacherId, {
          start_date: start.toISOString(),
          end_date: end.toISOString(),
        })
        .then((response) => response.data);
    },
  });

  const latestLesson = useMemo(
    () => normalizeLatestLesson(latestLessonPayload, dashboardPayload, copy),
    [latestLessonPayload, dashboardPayload, copy]
  );

  const { data: activeGoalPayload } = useQuery({
    queryKey: ["teacher-active-goals", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => fetchActiveGoalPayload(teacherId),
  });

  const activeGoals = useMemo(
    () => normalizeActiveGoals(activeGoalPayload, latestLesson, copy),
    [activeGoalPayload, latestLesson, copy]
  );

  const { data: badgePayload } = useQuery({
    queryKey: ["teacher-my-badges", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => fetchMyBadges(teacherId),
  });

  const badges = useMemo(() => normalizeBadges(badgePayload, copy), [badgePayload, copy]);

  const { data: reflectionPayload } = useQuery({
    queryKey: ["teacher-reflection-history", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => fetchReflectionHistory(teacherId),
  });

  const reflections = useMemo(
    () => normalizeReflections(reflectionPayload, copy),
    [reflectionPayload, copy]
  );
  const actionPlanReflection = activeGoalPayload?.actionPlan?.teacher_reflection || "";

  const markActionTriedMutation = useMutation({
    mutationFn: async (action) => {
      if (action.isActionPlanGoal) {
        await actionPlanApi.markTried(teacherId, action.id);
        return action;
      }
      if (!action.taskId) return action;
      await api.post(`/api/coaching/tasks/${action.taskId}/reflection`, {
        teacher_id: teacherId,
        status: "tried",
        reflection: "",
        video_id: action.videoId || null,
      });
      return action;
    },
    onMutate: (action) => {
      const previous = triedActionIds;
      setTriedActionIds((current) => new Set([...current, action.id]));
      return { previous };
    },
    onError: (_error, _action, context) => {
      setTriedActionIds(context?.previous || new Set());
      toast.error(copy.saveFailed);
    },
    onSuccess: () => {
      toast.success(copy.saved);
      queryClient.invalidateQueries({ queryKey: ["teacher-active-goals", teacherId] });
    },
  });

  const goalReflectionMutation = useMutation({
    mutationFn: async ({ goal, reflection }) => {
      if (goal.isActionPlanGoal) {
        return actionPlanApi.addTeacherNote(teacherId, goal.id, { teacher_notes: reflection });
      }
      if (goal.taskId) {
        return api.post(`/api/coaching/tasks/${goal.taskId}/reflection`, {
          teacher_id: teacherId,
          goal_id: goal.id,
          status: "tried",
          reflection,
          video_id: goal.videoId || null,
          assessment_id: goal.assessmentId || null,
        });
      }
      return assessmentApi.saveTeacherSummaryReflection(teacherId, {
        self_reflection: reflection,
        actions_taken: reflection,
        linked_goal_ids: [goal.id],
        linked_video_id: goal.videoId || null,
        linked_assessment_id: goal.assessmentId || null,
      });
    },
    onSuccess: () => {
      toast.success(copy.saved);
      setActiveGoalReflectionId(null);
      setGoalReflectionText("");
      queryClient.invalidateQueries({ queryKey: ["teacher-active-goals", teacherId] });
      queryClient.invalidateQueries({ queryKey: ["teacher-reflection-history", teacherId] });
      queryClient.invalidateQueries({ queryKey: ["teacher-summary-reflection", teacherId] });
    },
    onError: () => toast.error(copy.saveFailed),
  });

  const requestLinkageMutation = useMutation({
    mutationFn: (email) => teacherApi.requestLinkage({ admin_email: email }).then((response) => response.data),
    onSuccess: () => {
      toast.success("Linkage request sent");
      setAdminEmail("");
    },
    onError: () => toast.error(copy.saveFailed),
  });

  const addReflectionMutation = useMutation({
    mutationFn: (reflection) =>
      assessmentApi.saveTeacherSummaryReflection(teacherId, {
        self_reflection: reflection,
        actions_taken: "",
        linked_goal_ids: [],
      }),
    onSuccess: () => {
      toast.success(copy.saved);
      setAddingReflection(false);
      setFreeReflectionText("");
      queryClient.invalidateQueries({ queryKey: ["teacher-reflection-history", teacherId] });
      queryClient.invalidateQueries({ queryKey: ["teacher-summary-reflection", teacherId] });
    },
    onError: () => toast.error(copy.saveFailed),
  });

  const saveActionPlanReflectionMutation = useMutation({
    mutationFn: (reflection) =>
      actionPlanApi.reflection(teacherId, { teacher_reflection: reflection }).then((response) => response.data),
    onSuccess: () => {
      toast.success(copy.saved);
      queryClient.invalidateQueries({ queryKey: ["teacher-active-goals", teacherId] });
    },
    onError: () => toast.error(copy.saveFailed),
  });

  const createSelfProfileMutation = useMutation({
    mutationFn: (payload) => teacherApi.createSelfProfile(payload).then((response) => response.data),
    onSuccess: async () => {
      await refreshUser();
      toast.success(copy.profileCreateSuccess);
    },
    onError: (error) => {
      const detail = error?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : copy.profileCreateFailed);
    },
  });

  const copyBadgeLink = async (badge) => {
    const shareUrl =
      badge.shareUrl ||
      (badge.videoId && typeof window !== "undefined"
        ? `${window.location.origin}/videos/${badge.videoId}`
        : "");
    if (!shareUrl) return;

    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success(copy.linkCopied);
    } catch {
      toast.error(copy.saveFailed);
    }
  };

  if (!teacherId) {
    return (
      <LayoutShell>
        <div className="mx-auto max-w-5xl px-6 py-6" dir={isRtl ? "rtl" : "ltr"}>
          <PageContextHeader
            breadcrumbs={[{ label: copy.pageTitle }]}
            title={copy.pageTitle}
            description={copy.pageDescription}
            meta={copy.roleMeta}
            badge={copy.roleBadge}
            tags={institutionTags}
          />
          <Panel className="space-y-5 border border-slate-200 bg-white">
            <div className="space-y-2">
              <h2 className="text-base font-semibold text-slate-900">{copy.noLinkedTeacherTitle}</h2>
              <p className="text-sm text-slate-500">{copy.noLinkedTeacherDescription}</p>
              <p className="text-xs text-slate-500">{copy.profileCreateSyncNote}</p>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <ContextTile label={copy.linkedOrganizationLabel} value={linkedOrganizationName || copy.linkedAdminNotAssigned} />
              <ContextTile label={copy.linkedSchoolLabel} value={linkedSchoolName || copy.linkedAdminNotAssigned} />
              <ContextTile label={copy.linkedAdminNameLabel} value={linkedAdminName || copy.linkedAdminNotAssigned} />
            </div>

            <form
              className="grid gap-4 md:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                createSelfProfileMutation.mutate({
                  subject: profileSubject,
                  grade_level: profileGradeLevel,
                  department: profileDepartment || undefined,
                });
              }}
            >
              <Field label={copy.profileSubjectLabel}>
                <Input
                  value={profileSubject}
                  onChange={(event) => setProfileSubject(event.target.value)}
                  placeholder={copy.profileSubjectPlaceholder}
                />
              </Field>
              <Field label={copy.profileGradeLevelLabel}>
                <Input
                  value={profileGradeLevel}
                  onChange={(event) => setProfileGradeLevel(event.target.value)}
                  placeholder={copy.profileGradeLevelPlaceholder}
                />
              </Field>
              <Field label={copy.profileDepartmentLabel}>
                <Input
                  value={profileDepartment}
                  onChange={(event) => setProfileDepartment(event.target.value)}
                  placeholder={copy.profileDepartmentPlaceholder}
                />
              </Field>
              <div className="md:col-span-2">
                <Button
                  type="submit"
                  disabled={
                    createSelfProfileMutation.isPending ||
                    !profileSubject.trim() ||
                    !profileGradeLevel.trim()
                  }
                >
                  {createSelfProfileMutation.isPending ? copy.profileCreatePending : copy.profileCreateCta}
                </Button>
              </div>
            </form>
          </Panel>
        </div>
      </LayoutShell>
    );
  }

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-6 py-6" dir={isRtl ? "rtl" : "ltr"}>
        <PageContextHeader
          breadcrumbs={[{ label: copy.pageTitle, to: "/my-workspace" }]}
          title={copy.pageTitle}
          description={copy.pageDescription}
          meta={copy.roleMeta}
          badge={copy.roleBadge}
          tags={institutionTags}
        />

        <div className="space-y-6">
          {linkedAdmin ? (
            <Panel className="border-teal-200 bg-teal-50/60">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-teal-500 bg-white text-sm font-bold text-teal-700">
                  {(linkedAdmin.admin_name || linkedAdmin.admin_email || "A").slice(0, 1)}
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    Your school: {linkedAdmin.school_name || copy.linkedAdminNotAssigned}
                  </div>
                  <div className="text-sm text-slate-600">
                    Your administrator: {linkedAdmin.admin_name || linkedAdmin.admin_email}
                  </div>
                </div>
              </div>
            </Panel>
          ) : (
            <Panel className="border-amber-200 bg-amber-50/70">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Your account isn't linked to a school yet.</div>
                  <div className="text-sm text-slate-600">Enter your administrator's email to request linkage.</div>
                </div>
                <form
                  className="flex flex-col gap-2 sm:flex-row"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (adminEmail.trim()) requestLinkageMutation.mutate(adminEmail.trim());
                  }}
                >
                  <input
                    type="email"
                    value={adminEmail}
                    onChange={(event) => setAdminEmail(event.target.value)}
                    placeholder="administrator@school.edu"
                    className="rounded-md border border-amber-200 bg-white px-3 py-2 text-sm"
                  />
                  <Button type="submit" disabled={!adminEmail.trim() || requestLinkageMutation.isPending}>
                    Send request
                  </Button>
                </form>
              </div>
            </Panel>
          )}

          <WorkspacePanel
            title={copy.latestLessonTitle}
            description={copy.latestLessonDescription}
            icon={PlayCircle}
          >
            {latestLesson ? (
              <div className="space-y-5">
                <div className="grid gap-3 md:grid-cols-2">
                  <ContextTile
                    label={copy.lessonDate}
                    value={formatDate(latestLesson.date, locale, copy.lessonFallback)}
                  />
                  <ContextTile
                    label={copy.subject}
                    value={stripRubricAndScores(latestLesson.subject || teacherRes?.subject || copy.lessonFallback)}
                  />
                </div>

                <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="text-sm font-semibold text-slate-900">{copy.coachingSummary}</div>
                  <p className="mt-2 text-sm leading-6 text-slate-700">
                    {latestLesson.summary || copy.latestLessonEmpty}
                  </p>
                </div>

                {latestLesson.recommendations.length ? (
                  <div>
                    <div className="mb-3 text-sm font-semibold text-slate-900">{copy.actionCardsTitle}</div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {latestLesson.recommendations.map((action) => {
                        const isTried = triedActionIds.has(action.id);
                        return (
                          <div key={action.id} className="rounded-md border border-slate-200 bg-white px-4 py-4 shadow-sm">
                            <p className="text-sm leading-6 text-slate-700">{action.text}</p>
                            <button
                              type="button"
                              aria-pressed={isTried}
                              onClick={() => markActionTriedMutation.mutate(action)}
                              disabled={isTried || markActionTriedMutation.isPending}
                              className={[
                                "mt-4 inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                                isTried
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-white",
                              ].join(" ")}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              {isTried ? copy.tried : copy.markAsTried}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {latestLesson.audio ? <TalkTimeChart audio={latestLesson.audio} copy={copy} /> : null}

                {latestLesson.videoId ? (
                  <Link
                    to={`/videos/${latestLesson.videoId}`}
                    className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <PlayCircle className="h-4 w-4" />
                    {copy.watchLesson}
                  </Link>
                ) : null}
              </div>
            ) : latestLessonLoading ? (
              <EncouragingEmpty>{copy.preparing}</EncouragingEmpty>
            ) : (
              <EncouragingEmpty>{copy.latestLessonEmpty}</EncouragingEmpty>
            )}
          </WorkspacePanel>

          <WorkspacePanel title={copy.goalsTitle} description={copy.goalsDescription} icon={ClipboardCheck}>
            {activeGoals.length ? (
              <div className="grid gap-4 lg:grid-cols-3">
                {activeGoals.map((goal) => (
                  <div key={goal.id} className="rounded-md border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold leading-6 text-slate-900">{goal.text}</p>
                      {goal.triedAt ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                          Tried
                        </span>
                      ) : null}
                    </div>
                    {goal.recommendedAction ? (
                      <p className="mt-2 text-sm leading-6 text-slate-700">{goal.recommendedAction}</p>
                    ) : null}
                    {goal.teacherNotes ? (
                      <div className="mt-3 rounded-md border border-teal-100 bg-white px-3 py-2 text-xs text-slate-600">
                        <span className="font-semibold text-slate-800">Your note: </span>
                        {goal.teacherNotes}
                      </div>
                    ) : null}
                    <div className="mt-3 text-xs text-slate-500">
                      {copy.fromLesson}{" "}
                      {goal.videoId ? (
                        <Link to={`/videos/${goal.videoId}`} className="font-medium text-primary hover:text-primary/80">
                          {goal.sourceLabel || copy.lessonFallback}
                        </Link>
                      ) : (
                        <span className="font-medium text-slate-700">{goal.sourceLabel || copy.lessonFallback}</span>
                      )}
                      {goal.sourceDate ? <span> · {formatDate(goal.sourceDate, locale)}</span> : null}
                    </div>

                    <div className="mt-4">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setActiveGoalReflectionId(goal.id);
                          setGoalReflectionText("");
                        }}
                      >
                        {copy.iTriedThis}
                      </Button>
                    </div>

                    {activeGoalReflectionId === goal.id ? (
                      <form
                        className="mt-4 space-y-3"
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (!goalReflectionText.trim()) return;
                          goalReflectionMutation.mutate({
                            goal,
                            reflection: getCoachText(goalReflectionText, goalReflectionText, 3),
                          });
                        }}
                      >
                        <label className="block text-xs font-medium text-slate-600">
                          {copy.reflectionPrompt}
                        </label>
                        <textarea
                          rows={4}
                          value={goalReflectionText}
                          onChange={(event) => setGoalReflectionText(event.target.value)}
                          placeholder={copy.reflectionPlaceholder}
                          className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none ring-primary/40 focus:ring"
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="submit"
                            size="sm"
                            disabled={!goalReflectionText.trim() || goalReflectionMutation.isPending}
                          >
                            {copy.saveReflection}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setActiveGoalReflectionId(null)}
                          >
                            {copy.cancel}
                          </Button>
                        </div>
                      </form>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <EncouragingEmpty>{copy.goalsEmpty}</EncouragingEmpty>
            )}
          </WorkspacePanel>

          <WorkspacePanel title={copy.recognitionTitle} description={copy.recognitionDescription} icon={Award}>
            {badges.length ? (
              <div className="space-y-4">
                <div className="grid gap-4 lg:grid-cols-3">
                  {badges.map((badge) => (
                    <div key={badge.id} className="rounded-md border border-slate-200 bg-slate-50 px-4 py-4">
                      <div className="flex items-start gap-3">
                        {badge.assetUrl ? (
                          <img
                            src={badge.assetUrl}
                            alt=""
                            className="h-12 w-12 rounded-md border border-slate-200 bg-white object-cover"
                          />
                        ) : (
                          <div className="flex h-12 w-12 items-center justify-center rounded-md border border-amber-200 bg-amber-50 text-amber-600">
                            <Sparkles className="h-5 w-5" />
                          </div>
                        )}
                        <div>
                          <div className="text-sm font-semibold text-slate-900">{badge.title}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {copy.earned} {formatDate(badge.earnedAt, locale, "")}
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {copy.awardedFor}
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-700">{badge.awardedFor}</p>
                      <button
                        type="button"
                        onClick={() => copyBadgeLink(badge)}
                        className="mt-4 inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <Share2 className="h-3.5 w-3.5" />
                        {copy.share}
                      </button>
                    </div>
                  ))}
                </div>
                <Link
                  to="/my-badges"
                  className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/80"
                >
                  {copy.viewAll}
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </div>
            ) : (
              <EncouragingEmpty>{copy.recognitionEmpty}</EncouragingEmpty>
            )}
          </WorkspacePanel>

          <WorkspacePanel title={copy.reflectionsTitle} description={copy.reflectionsDescription} icon={MessageSquareText}>
            <form
              className="rounded-md border border-teal-100 bg-teal-50/60 px-4 py-4"
              onSubmit={(event) => {
                event.preventDefault();
                saveActionPlanReflectionMutation.mutate(teacherReflectionText || actionPlanReflection);
              }}
            >
              <label className="text-sm font-semibold text-slate-900">Your action plan reflection</label>
              <textarea
                rows={4}
                value={teacherReflectionText || actionPlanReflection}
                onChange={(event) => setTeacherReflectionText(event.target.value)}
                placeholder="What are you noticing about your progress?"
                className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none ring-primary/40 focus:ring"
              />
              <Button
                type="submit"
                size="sm"
                disabled={saveActionPlanReflectionMutation.isPending || !(teacherReflectionText || actionPlanReflection).trim()}
                className="mt-3"
              >
                {copy.saveReflection}
              </Button>
            </form>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setReflectionsOpen((current) => !current)}
                className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                aria-expanded={reflectionsOpen}
              >
                {reflectionsOpen ? (
                  <ChevronDown className="h-4 w-4" />
                ) : isRtl ? (
                  <ChevronLeft className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                {reflectionsOpen ? copy.hideReflections : copy.showReflections}
              </button>
              <Button type="button" variant="secondary" onClick={() => setAddingReflection(true)}>
                {copy.addReflection}
              </Button>
            </div>

            {addingReflection ? (
              <form
                className="rounded-md border border-slate-200 bg-slate-50 px-4 py-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!freeReflectionText.trim()) return;
                  addReflectionMutation.mutate(getCoachText(freeReflectionText, freeReflectionText, 3));
                }}
              >
                <textarea
                  rows={4}
                  value={freeReflectionText}
                  onChange={(event) => setFreeReflectionText(event.target.value)}
                  placeholder={copy.reflectionFreePlaceholder}
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none ring-primary/40 focus:ring"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!freeReflectionText.trim() || addReflectionMutation.isPending}
                  >
                    {copy.saveReflection}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setAddingReflection(false);
                      setFreeReflectionText("");
                    }}
                  >
                    {copy.cancel}
                  </Button>
                </div>
              </form>
            ) : null}

            {reflectionsOpen ? (
              reflections.length ? (
                <div className="space-y-3">
                  {reflections.map((entry) => (
                    <div key={entry.id} className="rounded-md border border-slate-200 bg-slate-50 px-4 py-4">
                      <div className="text-xs font-medium text-slate-500">
                        {formatDate(entry.date, locale, copy.lessonFallback)}
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-700">{entry.text}</p>
                      {entry.goalTitle ? (
                        <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                          <span className="font-semibold text-slate-700">{copy.goalAddressed}: </span>
                          {entry.goalTitle}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <EncouragingEmpty>{copy.reflectionsEmpty}</EncouragingEmpty>
              )
            ) : null}
          </WorkspacePanel>
        </div>
      </div>
    </LayoutShell>
  );
}

function ContextTile({ label, value }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-sm font-semibold text-slate-900">{value || "—"}</div>
    </div>
  );
}
