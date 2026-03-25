import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  actionPlanApi,
  assessmentApi,
  curriculumApi,
  lessonPlanApi,
  observationApi,
  privacyProfileApi,
  syllabusApi,
  teacherApi,
  videoApi,
} from "@/lib/api";

export function useTeacherWorkspaceData({ teacherId, teacherName, teacherSubject, t, i18n }) {
  const queryClient = useQueryClient();
  const privacyReferenceInputRef = useRef(null);
  const curriculumInputRef = useRef(null);
  const lessonPlanInputRef = useRef(null);
  const syllabusInputRef = useRef(null);

  const [periodMonths, setPeriodMonths] = useState(3);
  const [selfReflection, setSelfReflection] = useState("");
  const [actionsTaken, setActionsTaken] = useState("");
  const [actionPlanGoals, setActionPlanGoals] = useState([]);
  const [actionPlanNotes, setActionPlanNotes] = useState("");
  const [curriculumFile, setCurriculumFile] = useState(null);
  const [lessonPlanFile, setLessonPlanFile] = useState(null);
  const [syllabusFile, setSyllabusFile] = useState(null);
  const [curriculumTitle, setCurriculumTitle] = useState("");
  const [lessonPlanTitle, setLessonPlanTitle] = useState("");
  const [lessonPlanDate, setLessonPlanDate] = useState("");
  const [syllabusTitle, setSyllabusTitle] = useState("");
  const [privacyReferenceFiles, setPrivacyReferenceFiles] = useState([]);
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [recordedUrl, setRecordedUrl] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [videoSubject, setVideoSubject] = useState("");
  const [videoTab, setVideoTab] = useState("record");

  const { data: teacherRes } = useQuery({
    queryKey: ["teacher", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => teacherApi.get(teacherId).then((r) => r.data),
  });
  const { data: dashboardRes } = useQuery({
    queryKey: ["teacher-dashboard", teacherId, periodMonths],
    enabled: Boolean(teacherId),
    queryFn: () => {
      const end = new Date();
      const start = new Date();
      start.setMonth(end.getMonth() - periodMonths);
      return assessmentApi
        .teacherDashboard(teacherId, {
          start_date: start.toISOString(),
          end_date: end.toISOString(),
        })
        .then((r) => r.data);
    },
  });
  const { data: summaryInsightsRes } = useQuery({
    queryKey: ["teacher-summary-insights", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => assessmentApi.teacherSummaryInsights(teacherId).then((r) => r.data),
  });
  const { data: summaryReflectionRes } = useQuery({
    queryKey: ["teacher-summary-reflection", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => assessmentApi.teacherSummaryReflection(teacherId).then((r) => r.data),
  });
  const { data: actionPlanRes } = useQuery({
    queryKey: ["action-plan", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => actionPlanApi.get(teacherId).then((r) => r.data),
  });
  const { data: privacyProfileRes } = useQuery({
    queryKey: ["teacher-privacy-profile", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => privacyProfileApi.get(teacherId).then((r) => r.data),
  });
  const { data: observationsRes } = useQuery({
    queryKey: ["teacher-observations", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => observationApi.listForTeacher(teacherId).then((r) => r.data),
  });
  const { data: videosRes } = useQuery({
    queryKey: ["videos", { teacherId }],
    enabled: Boolean(teacherId),
    queryFn: () => videoApi.list({ teacher_id: teacherId }).then((r) => r.data),
  });
  const { data: curriculaRes } = useQuery({
    queryKey: ["curricula", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => curriculumApi.list(teacherId).then((r) => r.data),
  });
  const { data: lessonPlansRes } = useQuery({
    queryKey: ["lesson-plans", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => lessonPlanApi.list(teacherId).then((r) => r.data),
  });
  const { data: syllabiRes } = useQuery({
    queryKey: ["syllabi", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => syllabusApi.list(teacherId).then((r) => r.data),
  });

  useEffect(() => {
    if (summaryReflectionRes) {
      setSelfReflection(summaryReflectionRes.self_reflection || "");
      setActionsTaken(summaryReflectionRes.actions_taken || "");
    }
  }, [summaryReflectionRes]);
  useEffect(() => {
    if (actionPlanRes) {
      setActionPlanGoals(actionPlanRes.goals || []);
      setActionPlanNotes(actionPlanRes.notes || "");
    }
  }, [actionPlanRes]);
  useEffect(() => {
    const nextSubject = teacherRes?.subject || teacherSubject || "";
    if (nextSubject) setVideoSubject((current) => current || nextSubject);
  }, [teacherRes, teacherSubject]);

  const saveReflectionMutation = useMutation({
    mutationFn: (payload) => assessmentApi.saveTeacherSummaryReflection(teacherId, payload),
    onSuccess: () => {
      toast.success(t("teacherProfile.reflectionSaved"));
      queryClient.invalidateQueries({ queryKey: ["teacher-summary-reflection", teacherId] });
    },
    onError: () => toast.error(t("teacherProfile.reflectionSaveFailed")),
  });
  const saveActionPlanMutation = useMutation({
    mutationFn: (payload) => actionPlanApi.save(teacherId, payload),
    onSuccess: () => {
      toast.success(t("teacherProfile.actionPlanSaved"));
      queryClient.invalidateQueries({ queryKey: ["action-plan", teacherId] });
    },
    onError: () => toast.error(t("teacherProfile.actionPlanSaveFailed")),
  });
  const savePrivacyProfileMutation = useMutation({
    mutationFn: (files) => {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      formData.append("replace_existing", "true");
      return privacyProfileApi.upload(teacherId, formData);
    },
    onSuccess: () => {
      toast.success(t("teacherProfile.privacyProfileSaved"));
      setPrivacyReferenceFiles([]);
      queryClient.invalidateQueries({ queryKey: ["teacher-privacy-profile", teacherId] });
    },
    onError: (error) => toast.error(error?.response?.data?.detail || t("teacherProfile.privacyProfileSaveFailed")),
  });
  const uploadRecordedMutation = useMutation({
    mutationFn: ({ file, recordedAt }) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("teacher_id", teacherId);
      if (videoSubject) formData.append("subject", videoSubject);
      if (recordedAt) formData.append("recorded_at", recordedAt);
      return videoApi.upload(formData, {
        onUploadProgress: (event) => {
          if (event.total) setUploadProgress(Math.round((event.loaded / event.total) * 100));
        },
      });
    },
    onSuccess: () => {
      toast.success(t("teacherProfile.recordingQueued"));
      setUploadProgress(0);
      setRecordedBlob(null);
      setRecordedUrl("");
      queryClient.invalidateQueries({ queryKey: ["videos", { teacherId }] });
      queryClient.invalidateQueries({ queryKey: ["teacher-dashboard", teacherId, periodMonths] });
    },
    onError: (error) => {
      toast.error(error?.response?.data?.detail || t("teacherProfile.videoUploadFailed"));
      setUploadProgress(0);
    },
  });

  const uploadCurriculumMutation = useMutation({
    mutationFn: (payload) => curriculumApi.upload(payload),
    onSuccess: () => {
      toast.success(t("teacherProfile.curriculumUploaded"));
      setCurriculumFile(null);
      setCurriculumTitle("");
      queryClient.invalidateQueries({ queryKey: ["curricula", teacherId] });
    },
    onError: (error) => toast.error(error?.response?.data?.detail || t("teacherProfile.curriculumUploadFailed")),
  });
  const uploadLessonPlanMutation = useMutation({
    mutationFn: (payload) => lessonPlanApi.upload(payload),
    onSuccess: () => {
      toast.success(t("teacherProfile.lessonPlanUploaded"));
      setLessonPlanFile(null);
      setLessonPlanTitle("");
      setLessonPlanDate("");
      queryClient.invalidateQueries({ queryKey: ["lesson-plans", teacherId] });
    },
    onError: (error) => toast.error(error?.response?.data?.detail || t("teacherProfile.lessonPlanUploadFailed")),
  });
  const uploadSyllabusMutation = useMutation({
    mutationFn: (payload) => syllabusApi.upload(payload),
    onSuccess: () => {
      toast.success(t("teacherProfile.syllabusUploaded"));
      setSyllabusFile(null);
      setSyllabusTitle("");
      queryClient.invalidateQueries({ queryKey: ["syllabi", teacherId] });
    },
    onError: (error) => toast.error(error?.response?.data?.detail || t("teacherProfile.syllabusUploadFailed")),
  });

  return {
    refs: { privacyReferenceInputRef, curriculumInputRef, lessonPlanInputRef, syllabusInputRef },
    state: {
      periodMonths, setPeriodMonths, selfReflection, setSelfReflection, actionsTaken, setActionsTaken,
      actionPlanGoals, setActionPlanGoals, actionPlanNotes, setActionPlanNotes, curriculumFile, setCurriculumFile,
      lessonPlanFile, setLessonPlanFile, syllabusFile, setSyllabusFile, curriculumTitle, setCurriculumTitle,
      lessonPlanTitle, setLessonPlanTitle, lessonPlanDate, setLessonPlanDate, syllabusTitle, setSyllabusTitle,
      privacyReferenceFiles, setPrivacyReferenceFiles, recordedBlob, setRecordedBlob, recordedUrl, setRecordedUrl,
      uploadProgress, videoSubject, setVideoSubject, videoTab, setVideoTab,
    },
    data: {
      teacherRes, dashboardRes, summaryInsightsRes, summaryReflectionRes, actionPlanRes, privacyProfileRes,
      observationsRes, videosRes, curriculaRes, lessonPlansRes, syllabiRes, teacherId, teacherName, i18n,
    },
    mutations: {
      saveReflectionMutation, saveActionPlanMutation, savePrivacyProfileMutation, uploadRecordedMutation,
      uploadCurriculumMutation, uploadLessonPlanMutation, uploadSyllabusMutation,
    },
  };
}
