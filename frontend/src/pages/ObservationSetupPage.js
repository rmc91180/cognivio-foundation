import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Target,
  Upload,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { LayoutShell } from "@/components/LayoutShell";
import { useAuth } from "@/hooks/useAuth";
import {
  Button,
  Field,
  Input,
  Panel,
  SectionHeader,
  Select,
  SkeletonCard,
  Textarea,
} from "@/components/ui";
import {
  assessmentApi,
  frameworkApi,
  observationSessionApi,
  observerApi,
  traineeApi,
  teacherApi,
} from "@/lib/api";
import { getUserTenantRole } from "@/lib/userRoutes";
import { HEBREW_FRAMEWORK_LABELS } from "@/features/school-setup/constants";

const COPY = {
  en: {
    title: "Plan an observation",
    description: "Set the intent before recording so the lesson review can stay focused and useful.",
    stepTeacher: "Teacher",
    stepFocus: "Focus",
    stepNote: "Intent",
    stepSchedule: "Schedule",
    selectTeacherTitle: "Select teacher",
    selectTeacherDescription: "Choose the teacher or trainee you are planning to observe.",
    teacherLabel: "Teacher",
    chooseTeacher: "Choose a teacher",
    focusTitle: "Select 1-3 focus elements",
    focusDescription: "Use the most recent lesson pattern to choose a small, practical observation lens.",
    lastScore: "Last score",
    firstLook: "First look",
    declining: "Declining",
    maxFocus: "Choose up to three focus elements.",
    noteTitle: "Write the observation intent",
    noteDescription: "Keep this short and coach-facing. The note will guide the review.",
    focusNoteLabel: "Observation note",
    focusNotePlaceholder: "Example: Watch for how students get time to think before answering.",
    personalGoalLabel: "Personal goal",
    personalGoalHint: "Use one line per goal if there is more than one.",
    personalGoalPlaceholder: "Example: Look for one concrete next step we can practice this week.",
    scheduleTitle: "Schedule or start now",
    scheduleDescription: "Create the planned session, then come back later or record right away.",
    scheduledDate: "Scheduled date",
    placementLabel: "Placement",
    choosePlacement: "Choose placement",
    scheduleLater: "Schedule for later",
    uploadNow: "Upload video now",
    continue: "Continue",
    back: "Back",
    planned: "Observation planned.",
    createdForUpload: "Observation created. You can upload the recording now.",
    createFailed: "Could not create the observation session.",
    selectTeacherFirst: "Select a teacher first.",
    selectFocusFirst: "Choose at least one focus element.",
    writeIntentFirst: "Add an observation note and personal goal.",
    invalidDate: "Choose a valid scheduled date.",
    loadingFocus: "Loading focus options...",
    noFocusYet: "Focus choices will appear after this teacher has lesson history. Use a general focus for now.",
    generalFocus: "General lesson focus",
    selectedTeacher: "Selected teacher",
    observerGoalsTitle: "Your active goals",
    observerGoalsDescription: "Keep your own observer growth targets visible while you plan this session.",
    goalAlignment: "This aligns with your goal:",
    noObserverGoals: "No active observer goals yet.",
  },
  he: {
    title: "תכנון תצפית",
    description: "מגדירים כוונה לפני ההקלטה כדי שהמשוב יהיה ממוקד ומועיל.",
    stepTeacher: "מורה",
    stepFocus: "מוקד",
    stepNote: "כוונה",
    stepSchedule: "תזמון",
    selectTeacherTitle: "בחירת מורה",
    selectTeacherDescription: "בחרו את המורה או המתמחה שלגביו מתכננים תצפית.",
    teacherLabel: "מורה",
    chooseTeacher: "בחרו מורה",
    focusTitle: "בחירת 1-3 מוקדי תצפית",
    focusDescription: "בחרו עדשה קטנה ומעשית על בסיס הדפוס האחרון מהשיעורים.",
    lastScore: "ציון אחרון",
    firstLook: "מבט ראשון",
    declining: "בירידה",
    maxFocus: "אפשר לבחור עד שלושה מוקדי תצפית.",
    noteTitle: "כתיבת כוונת התצפית",
    noteDescription: "כתבו בקצרה ובקול של אימון. ההערה תנחה את הסקירה.",
    focusNoteLabel: "הערת תצפית",
    focusNotePlaceholder: "לדוגמה: לשים לב לזמן החשיבה שניתן לתלמידים לפני תשובה.",
    personalGoalLabel: "מטרה אישית",
    personalGoalHint: "אפשר לכתוב כל מטרה בשורה נפרדת.",
    personalGoalPlaceholder: "לדוגמה: לזהות צעד אחד מעשי לתרגול השבוע.",
    scheduleTitle: "תזמון או התחלה עכשיו",
    scheduleDescription: "צרו תצפית מתוכננת וחזרו אליה מאוחר יותר או העלו הקלטה עכשיו.",
    scheduledDate: "מועד מתוכנן",
    placementLabel: "שיבוץ",
    choosePlacement: "בחרו שיבוץ",
    scheduleLater: "תזמון להמשך",
    uploadNow: "העלאת וידאו עכשיו",
    continue: "המשך",
    back: "חזרה",
    planned: "התצפית תוכננה.",
    createdForUpload: "התצפית נוצרה. אפשר להעלות את ההקלטה עכשיו.",
    createFailed: "לא ניתן ליצור את התצפית.",
    selectTeacherFirst: "בחרו מורה תחילה.",
    selectFocusFirst: "בחרו לפחות מוקד תצפית אחד.",
    writeIntentFirst: "הוסיפו הערת תצפית ומטרה אישית.",
    invalidDate: "בחרו מועד תקין לתצפית.",
    loadingFocus: "טוען מוקדי תצפית...",
    noFocusYet: "מוקדי תצפית יופיעו לאחר שתצטבר היסטוריית שיעורים. בינתיים אפשר לבחור מוקד כללי.",
    generalFocus: "מוקד שיעור כללי",
    selectedTeacher: "המורה שנבחר",
    observerGoalsTitle: "המטרות הפעילות שלך",
    observerGoalsDescription: "שמרו את יעדי ההתפתחות שלכם כצופים מול העיניים בזמן תכנון התצפית.",
    goalAlignment: "זה תואם למטרה שלך:",
    noObserverGoals: "אין עדיין מטרות פעילות לצופה.",
  },
};

const STEPS = ["teacher", "focus", "intent", "schedule"];

function getCopy(language) {
  return language?.startsWith("he") ? COPY.he : COPY.en;
}

function toDateTimeLocalValue(date) {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return adjusted.toISOString().slice(0, 16);
}

function defaultScheduleValue() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return toDateTimeLocalValue(date);
}

function splitGoals(value) {
  return String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function scoreText(value, copy) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${copy.lastScore}: ${numeric.toFixed(1)}` : copy.firstLook;
}

export function ObservationSetupPage() {
  const { i18n } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const initialTeacherId = searchParams.get("teacher_id") || "";
  const copy = getCopy(i18n.language);
  const isRtl = i18n.dir() === "rtl";
  const [stepIndex, setStepIndex] = useState(0);
  const [selectedTeacherId, setSelectedTeacherId] = useState(initialTeacherId);
  const [focusElements, setFocusElements] = useState([]);
  const [focusNote, setFocusNote] = useState("");
  const [personalGoalsText, setPersonalGoalsText] = useState("");
  const [scheduledDate, setScheduledDate] = useState(defaultScheduleValue);
  const [placementId, setPlacementId] = useState("");
  const isTrainingAdmin = getUserTenantRole(user) === "training_admin";

  useEffect(() => {
    if (initialTeacherId) {
      setSelectedTeacherId(initialTeacherId);
    }
  }, [initialTeacherId]);

  const { data: teachers = [], isLoading: teachersLoading } = useQuery({
    queryKey: ["teachers"],
    queryFn: () => teacherApi.list().then((res) => res.data),
  });

  const { data: selectionRes } = useQuery({
    queryKey: ["framework-selection"],
    queryFn: () => frameworkApi.currentSelection().then((res) => res.data),
  });

  const frameworkType = selectionRes?.framework_type || "danielson";

  const { data: frameworkDetailRes } = useQuery({
    queryKey: ["framework-detail", frameworkType],
    enabled: Boolean(frameworkType),
    queryFn: () => frameworkApi.get(frameworkType).then((res) => res.data),
  });

  const { data: dashboardRes, isLoading: dashboardLoading } = useQuery({
    queryKey: ["teacher-dashboard", selectedTeacherId, "observation-setup"],
    enabled: Boolean(selectedTeacherId),
    queryFn: () => {
      const end = new Date();
      const start = new Date();
      start.setMonth(end.getMonth() - 6);
      return assessmentApi
        .teacherDashboard(selectedTeacherId, {
          start_date: start.toISOString(),
          end_date: end.toISOString(),
        })
        .then((res) => res.data);
    },
  });

  const { data: observerGoalsRes } = useQuery({
    queryKey: ["observer-goals"],
    queryFn: () => observerApi.goals().then((res) => res.data),
  });

  const { data: placementsRes } = useQuery({
    queryKey: ["trainee-placements", selectedTeacherId, "observation-setup"],
    enabled: Boolean(selectedTeacherId) && isTrainingAdmin,
    queryFn: () => traineeApi.placements(selectedTeacherId).then((res) => res.data),
  });

  const selectedTeacher = useMemo(
    () => teachers.find((teacher) => teacher.id === selectedTeacherId) || null,
    [selectedTeacherId, teachers]
  );

  const focusOptions = useMemo(() => {
    const isHebrew = i18n.resolvedLanguage === "he";
    const labelMap = {};
    const frameworkElements = [];
    (frameworkDetailRes?.domains || []).forEach((domain) => {
      (domain.elements || []).forEach((element) => {
        const label =
          isHebrew && frameworkType !== "custom"
            ? HEBREW_FRAMEWORK_LABELS[frameworkType]?.[element.id] || element.name
            : element.name;
        labelMap[element.id] = label;
        frameworkElements.push(element.id);
      });
    });

    const summariesById = {};
    (dashboardRes?.element_summary || []).forEach((item) => {
      if (item?.element_id) {
        summariesById[item.element_id] = item;
      }
    });

    const latestAssessment = (dashboardRes?.assessments || []).slice(-1)[0] || null;
    const latestScoresById = {};
    (latestAssessment?.element_scores || []).forEach((score) => {
      if (score?.element_id) {
        latestScoresById[score.element_id] = score;
      }
    });

    const selectedFrameworkElements = selectionRes?.selected_elements?.length
      ? selectionRes.selected_elements
      : frameworkElements;
    const ids = Array.from(
      new Set([
        ...selectedFrameworkElements,
        ...Object.keys(summariesById),
      ])
    );

    const options = ids
      .map((id) => {
        const summary = summariesById[id] || {};
        const latestScore = latestScoresById[id]?.score ?? summary.average_score;
        return {
          id,
          name: labelMap[id] || summary.element_name || id,
          lastScore: latestScore,
          declining: summary.trend_direction === "declining",
        };
      })
      .filter((option) => option.id && option.name);

    if (!options.length && selectedTeacherId) {
      return [
        {
          id: "general_lesson_focus",
          name: copy.generalFocus,
          lastScore: null,
          declining: false,
        },
      ];
    }
    return options;
  }, [copy.generalFocus, dashboardRes, frameworkDetailRes, frameworkType, i18n.resolvedLanguage, selectedTeacherId, selectionRes]);

  const activeObserverGoals = useMemo(
    () => observerGoalsRes?.goals || [],
    [observerGoalsRes]
  );

  const goalsAlignedToElement = (elementId) => {
    const normalizedElement = String(elementId || "").toLowerCase();
    return activeObserverGoals.filter((goal) => {
      const haystack = `${goal.goal_text || ""} ${goal.target_metric || ""}`.toLowerCase();
      return goal.goal_type === "element_focus" || haystack.includes(normalizedElement);
    });
  };

  const createSessionMutation = useMutation({
    mutationFn: (payload) => observationSessionApi.create(payload).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["observation-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["upcoming-observation-sessions"] });
    },
  });

  const toggleFocus = (elementId) => {
    setFocusElements((current) => {
      if (current.includes(elementId)) {
        return current.filter((id) => id !== elementId);
      }
      if (current.length >= 3) {
        toast.error(copy.maxFocus);
        return current;
      }
      return [...current, elementId];
    });
  };

  const validateStep = () => {
    if (STEPS[stepIndex] === "teacher" && !selectedTeacherId) {
      toast.error(copy.selectTeacherFirst);
      return false;
    }
    if (STEPS[stepIndex] === "focus" && !focusElements.length) {
      toast.error(copy.selectFocusFirst);
      return false;
    }
    if (
      STEPS[stepIndex] === "intent" &&
      (!focusNote.trim() || !splitGoals(personalGoalsText).length)
    ) {
      toast.error(copy.writeIntentFirst);
      return false;
    }
    return true;
  };

  const validateSession = () => {
    if (!selectedTeacherId) {
      toast.error(copy.selectTeacherFirst);
      setStepIndex(0);
      return false;
    }
    if (!focusElements.length) {
      toast.error(copy.selectFocusFirst);
      setStepIndex(1);
      return false;
    }
    if (!focusNote.trim() || !splitGoals(personalGoalsText).length) {
      toast.error(copy.writeIntentFirst);
      setStepIndex(2);
      return false;
    }
    return true;
  };

  const goNext = () => {
    if (!validateStep()) return;
    setStepIndex((current) => Math.min(current + 1, STEPS.length - 1));
  };

  const createSession = async (mode) => {
    if (!validateSession()) {
      return;
    }
    const scheduled = mode === "upload-now" ? new Date() : new Date(scheduledDate);
    if (Number.isNaN(scheduled.getTime())) {
      toast.error(copy.invalidDate);
      return;
    }
    const plannedDate = scheduled.toISOString();
    try {
      const session = await createSessionMutation.mutateAsync({
        teacher_id: selectedTeacherId,
        scheduled_date: plannedDate,
        focus_elements: focusElements,
        focus_note: focusNote,
        personal_goals: splitGoals(personalGoalsText),
        placement_id: placementId || null,
      });
      if (mode === "upload-now") {
        toast.success(copy.createdForUpload);
        const params = new URLSearchParams({
          teacher_id: selectedTeacherId,
          observation_session_id: session.id,
        });
        navigate(`/record?${params.toString()}`);
      } else {
        toast.success(copy.planned);
        navigate("/dashboard");
      }
    } catch (error) {
      toast.error(error?.response?.data?.detail || copy.createFailed);
    }
  };

  const renderTeacherStep = () => (
    <div>
      <SectionHeader title={copy.selectTeacherTitle} description={copy.selectTeacherDescription} />
      <div className="mt-5">
        <Field label={copy.teacherLabel}>
          <Select
            value={selectedTeacherId}
            onChange={(event) => {
              setSelectedTeacherId(event.target.value);
              setFocusElements([]);
              setPlacementId("");
            }}
          >
            <option value="">{copy.chooseTeacher}</option>
            {teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>
                {teacher.name || teacher.email} {teacher.subject ? `- ${teacher.subject}` : ""}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </div>
  );

  const renderFocusStep = () => (
    <div>
      <SectionHeader title={copy.focusTitle} description={copy.focusDescription} />
      {dashboardLoading ? (
        <div className="mt-5">
          <SkeletonCard height={180} />
          <p className="mt-3 text-xs text-slate-500">{copy.loadingFocus}</p>
        </div>
      ) : (
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {focusOptions.map((option) => {
            const selected = focusElements.includes(option.id);
            const alignedGoals = goalsAlignedToElement(option.id);
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => toggleFocus(option.id)}
                className={[
                  "min-h-[112px] rounded-md border px-4 py-4 text-left transition",
                  selected
                    ? "border-primary bg-primary/10 text-slate-950"
                    : option.declining
                      ? "border-amber-200 bg-amber-50/70 hover:bg-amber-50"
                      : "border-slate-200 bg-white hover:bg-slate-50",
                  isRtl ? "text-right" : "text-left",
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{option.name}</div>
                    <div className="mt-2 text-xs text-slate-600">
                      {scoreText(option.lastScore, copy)}
                    </div>
                  </div>
                  {selected ? (
                    <CheckCircle2 className="h-5 w-5 text-primary" />
                  ) : option.declining ? (
                    <AlertTriangle className="h-5 w-5 text-amber-600" />
                  ) : (
                    <Target className="h-5 w-5 text-slate-400" />
                  )}
                </div>
                {option.declining ? (
                  <div className="mt-3 inline-flex rounded-full border border-amber-200 bg-white px-2.5 py-1 text-xs font-medium text-amber-700">
                    {copy.declining}
                  </div>
                ) : null}
                {alignedGoals.length ? (
                  <div className="mt-3 rounded-md border border-teal-100 bg-white px-3 py-2 text-xs text-teal-800">
                    {copy.goalAlignment} {alignedGoals[0].goal_text}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
      {!dashboardLoading && !focusOptions.length ? (
        <div className="mt-5 rounded-md border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
          {copy.noFocusYet}
        </div>
      ) : null}
    </div>
  );

  const renderIntentStep = () => (
    <div>
      <SectionHeader title={copy.noteTitle} description={copy.noteDescription} />
      <div className="mt-5 space-y-4">
        <Field label={copy.focusNoteLabel}>
          <Textarea
            rows={4}
            value={focusNote}
            placeholder={copy.focusNotePlaceholder}
            onChange={(event) => setFocusNote(event.target.value)}
          />
        </Field>
        <Field label={copy.personalGoalLabel} hint={copy.personalGoalHint}>
          <Textarea
            rows={3}
            value={personalGoalsText}
            placeholder={copy.personalGoalPlaceholder}
            onChange={(event) => setPersonalGoalsText(event.target.value)}
          />
        </Field>
      </div>
    </div>
  );

  const renderScheduleStep = () => (
    <div>
      <SectionHeader title={copy.scheduleTitle} description={copy.scheduleDescription} />
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <Field label={copy.scheduledDate}>
          <Input
            type="datetime-local"
            value={scheduledDate}
            onChange={(event) => setScheduledDate(event.target.value)}
          />
        </Field>
        {isTrainingAdmin && (placementsRes?.placements || []).length ? (
          <Field label={copy.placementLabel}>
            <Select value={placementId} onChange={(event) => setPlacementId(event.target.value)}>
              <option value="">{copy.choosePlacement}</option>
              {(placementsRes?.placements || []).map((placement) => (
                <option key={placement.id} value={placement.id}>
                  {placement.school_site}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
          <div className="font-semibold text-slate-900">{copy.selectedTeacher}</div>
          <div className="mt-1">{selectedTeacher?.name || selectedTeacher?.email || copy.chooseTeacher}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {focusElements.map((elementId) => {
              const option = focusOptions.find((item) => item.id === elementId);
              return (
                <span key={elementId} className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-700">
                  {option?.name || elementId}
                </span>
              );
            })}
          </div>
        </div>
      </div>
      <div className="mt-6 grid gap-3 md:grid-cols-2">
        <Button
          type="button"
          variant="primary"
          size="lg"
          onClick={() => createSession("schedule")}
          disabled={createSessionMutation.isPending}
          className="justify-center gap-2"
        >
          <CalendarClock className="h-4 w-4" />
          {copy.scheduleLater}
        </Button>
        <Button
          type="button"
          variant="success"
          size="lg"
          onClick={() => createSession("upload-now")}
          disabled={createSessionMutation.isPending}
          className="justify-center gap-2"
        >
          <Upload className="h-4 w-4" />
          {copy.uploadNow}
        </Button>
      </div>
    </div>
  );

  const stepRenderers = [renderTeacherStep, renderFocusStep, renderIntentStep, renderScheduleStep];

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-6 py-6" dir={isRtl ? "rtl" : "ltr"}>
        <header className="mb-6">
          <h1 className="font-heading text-2xl font-semibold text-slate-950">{copy.title}</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">{copy.description}</p>
        </header>

        <Panel className="mb-6 border border-teal-100 bg-teal-50">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-teal-700">
                <Target className="h-4 w-4" />
                {copy.observerGoalsTitle}
              </div>
              <p className="mt-1 text-sm text-teal-950">{copy.observerGoalsDescription}</p>
            </div>
            <Link
              to="/my-insights"
              className="inline-flex items-center rounded-md bg-white px-3 py-2 text-xs font-semibold text-teal-800 ring-1 ring-teal-200 hover:bg-teal-50"
            >
              {copy.observerGoalsTitle}
            </Link>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {activeObserverGoals.length ? (
              activeObserverGoals.slice(0, 3).map((goal) => (
                <span key={goal.id} className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-teal-900 ring-1 ring-teal-100">
                  {goal.goal_text}
                </span>
              ))
            ) : (
              <span className="text-sm text-teal-800">{copy.noObserverGoals}</span>
            )}
          </div>
        </Panel>

        <div className="grid gap-6 lg:grid-cols-12">
          <aside className="lg:col-span-4">
            <Panel className="border border-slate-200 bg-white">
              <div className="space-y-3">
                {[copy.stepTeacher, copy.stepFocus, copy.stepNote, copy.stepSchedule].map((label, index) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setStepIndex(index)}
                    className={[
                      "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition",
                      stepIndex === index
                        ? "bg-primary/10 font-semibold text-primary"
                        : "text-slate-600 hover:bg-slate-50",
                    ].join(" ")}
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-full border border-current text-xs">
                      {index + 1}
                    </span>
                    {label}
                  </button>
                ))}
              </div>
              {selectedTeacher ? (
                <div className="mt-5 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {copy.selectedTeacher}
                  </div>
                  <div className="mt-1 font-semibold text-slate-900">{selectedTeacher.name}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {selectedTeacher.subject || selectedTeacher.school_name || selectedTeacher.email}
                  </div>
                  <Link
                    to={`/teachers/${selectedTeacher.id}`}
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80"
                  >
                    <Video className="h-3.5 w-3.5" />
                    {selectedTeacher.name}
                  </Link>
                </div>
              ) : null}
            </Panel>
          </aside>

          <Panel className="border border-slate-200 bg-white lg:col-span-8">
            {teachersLoading ? <SkeletonCard height={220} /> : stepRenderers[stepIndex]()}

            {stepIndex < STEPS.length - 1 ? (
              <div className="mt-6 flex flex-wrap justify-between gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
                  disabled={stepIndex === 0}
                  className="gap-2"
                >
                  <ChevronLeft className="h-4 w-4" />
                  {copy.back}
                </Button>
                <Button type="button" onClick={goNext} className="gap-2">
                  {copy.continue}
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="mt-6">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
                  className="gap-2"
                >
                  <ChevronLeft className="h-4 w-4" />
                  {copy.back}
                </Button>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </LayoutShell>
  );
}
