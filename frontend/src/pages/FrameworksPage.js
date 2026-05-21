import React, { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { LayoutShell } from "@/components/LayoutShell";
import { frameworkApi, recordingPolicyApi, teacherApi } from "@/lib/api";
import { HEBREW_FRAMEWORK_LABELS } from "@/features/school-setup/constants";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "react-router-dom";
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  PageHeader,
  Panel,
  Select,
} from "@/components/ui";

export function FrameworksPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isHebrew = i18n.resolvedLanguage === "he";
  const isAdmin = ["admin", "principal", "super_admin"].includes(user?.role) ||
    ["school_admin", "training_admin", "super_admin"].includes(user?.tenant_role);
  const {
    data: frameworksRes,
    isLoading: frameworksLoading,
    isError: frameworksError,
    refetch: refetchFrameworks,
    isFetching: frameworksFetching,
  } = useQuery({
    queryKey: ["frameworks"],
    queryFn: () => frameworkApi.list().then((res) => res.data),
  });

  const { data: selectionRes } = useQuery({
    queryKey: ["framework-selection"],
    queryFn: () => frameworkApi.currentSelection().then((res) => res.data),
  });

  const [frameworkType, setFrameworkType] = useState("danielson");

  const { data: frameworkDetailRes, isLoading: frameworkLoading, isError: frameworkError } = useQuery({
    queryKey: ["framework-detail", frameworkType],
    queryFn: () => frameworkApi.get(frameworkType).then((res) => res.data),
    enabled: Boolean(frameworkType),
  });

  const { data: customDomainsRes, isLoading: customDomainsLoading, isError: customDomainsError } = useQuery({
    queryKey: ["custom-domains"],
    queryFn: () => frameworkApi.listCustomDomains().then((res) => res.data),
  });
  const { data: teachersData } = useQuery({
    queryKey: ["teachers"],
    enabled: isAdmin,
    queryFn: () => teacherApi.list().then((res) => res.data),
  });
  const { data: recordingPolicyRes } = useQuery({
    queryKey: ["recording-policies"],
    enabled: isAdmin,
    queryFn: () => recordingPolicyApi.list().then((res) => res.data),
  });

  const [selectedElements, setSelectedElements] = useState([]);
  const [priorityElements, setPriorityElements] = useState([]);
  const [focusNote, setFocusNote] = useState("");
  const [customDomainName, setCustomDomainName] = useState("");
  const [customElementsInput, setCustomElementsInput] = useState("");
  const [customElementInputs, setCustomElementInputs] = useState({});
  const [rubricUploadFile, setRubricUploadFile] = useState(null);
  const rubricUploadInputRef = useRef(null);
  const [policyPeriodDays, setPolicyPeriodDays] = useState(30);
  const [policyMinRecordings, setPolicyMinRecordings] = useState(2);
  const [policyReminderOffsets, setPolicyReminderOffsets] = useState([7, 2]);
  const [policyTeacherId, setPolicyTeacherId] = useState("");

  useEffect(() => {
    if (selectionRes?.framework_type) {
      setFrameworkType(selectionRes.framework_type);
    }
    if (selectionRes?.selected_elements) {
      setSelectedElements(selectionRes.selected_elements);
    }
    if (selectionRes?.priority_elements) {
      setPriorityElements(selectionRes.priority_elements);
    }
    setFocusNote(selectionRes?.focus_note || "");
  }, [selectionRes]);

  const domains = useMemo(
    () => frameworkDetailRes?.domains || [],
    [frameworkDetailRes]
  );
  const customDomains = useMemo(
    () => customDomainsRes?.domains || [],
    [customDomainsRes]
  );
  const teacherOptions = useMemo(() => {
    if (Array.isArray(teachersData)) return teachersData;
    if (Array.isArray(teachersData?.teachers)) return teachersData.teachers;
    return [];
  }, [teachersData]);

  useEffect(() => {
    if (frameworkType !== "custom") {
      return;
    }
    if (selectedElements.length) {
      return;
    }
    if (!domains.length) {
      return;
    }
    const allElements = domains.flatMap((domain) =>
      (domain.elements || []).map((el) => el.id)
    );
    setSelectedElements(allElements);
  }, [frameworkType, domains, selectedElements.length]);

  useEffect(() => {
    setPriorityElements((prev) =>
      prev.filter((elementId) => selectedElements.includes(elementId))
    );
  }, [selectedElements]);

  useEffect(() => {
    const policy = recordingPolicyRes?.[0];
    if (policy) {
      setPolicyPeriodDays(policy.period_length_days || 30);
      setPolicyMinRecordings(policy.min_recordings_per_period || 2);
      setPolicyReminderOffsets(policy.reminder_offsets_days || [7, 2]);
      setPolicyTeacherId(policy.teacher_id || "");
    }
  }, [recordingPolicyRes]);

  const saveSelectionMutation = useMutation({
    mutationFn: () =>
      frameworkApi.saveSelection({
        framework_type: frameworkType,
        selected_elements: selectedElements,
        priority_elements: priorityElements,
        focus_note: focusNote,
      }),
    onSuccess: () => {
      toast.success(t("frameworksPage.selectionSaved"));
      queryClient.invalidateQueries({ queryKey: ["framework-selection"] });
      queryClient.invalidateQueries({ queryKey: ["roster"] });
    },
    onError: () => {
      toast.error(t("frameworksPage.selectionSaveFailed"));
    },
  });
  const uploadRubricMutation = useMutation({
    mutationFn: () => {
      const formData = new FormData();
      formData.append("file", rubricUploadFile);
      return frameworkApi.uploadRubric(formData);
    },
    onSuccess: () => {
      toast.success(t("frameworksPage.rubricUploadSuccess"));
      setRubricUploadFile(null);
      setFrameworkType("custom");
      queryClient.invalidateQueries({ queryKey: ["custom-domains"] });
      queryClient.invalidateQueries({ queryKey: ["framework-detail", "custom"] });
      queryClient.invalidateQueries({ queryKey: ["frameworks"] });
    },
    onError: () => {
      toast.error(t("frameworksPage.rubricUploadFailed"));
    },
  });
  const saveRecordingPolicyMutation = useMutation({
    mutationFn: (payload) => recordingPolicyApi.create(payload),
    onSuccess: () => {
      toast.success(t("frameworksPage.recordingPolicySaved"));
      queryClient.invalidateQueries({ queryKey: ["recording-policies"] });
      queryClient.invalidateQueries({ queryKey: ["recording-compliance-summary"] });
    },
    onError: () => {
      toast.error(t("frameworksPage.recordingPolicySaveFailed"));
    },
  });

  const createCustomDomainMutation = useMutation({
    mutationFn: () =>
      frameworkApi.createCustomDomain({
        name: customDomainName.trim(),
        elements: customElementsInput
          .split(",")
          .map((e) => e.trim())
          .filter(Boolean)
          .map((name) => ({ name })),
      }),
    onSuccess: () => {
      toast.success(t("frameworksPage.customDomainCreated"));
      setCustomDomainName("");
      setCustomElementsInput("");
      queryClient.invalidateQueries({ queryKey: ["custom-domains"] });
      queryClient.invalidateQueries({ queryKey: ["framework-detail", "custom"] });
      queryClient.invalidateQueries({ queryKey: ["frameworks"] });
    },
    onError: () => {
      toast.error(t("frameworksPage.customDomainCreateFailed"));
    },
  });

  const deleteCustomDomainMutation = useMutation({
    mutationFn: (domainId) => frameworkApi.deleteCustomDomain(domainId),
    onSuccess: () => {
      toast.success(t("frameworksPage.customDomainDeleted"));
      queryClient.invalidateQueries({ queryKey: ["custom-domains"] });
      queryClient.invalidateQueries({ queryKey: ["framework-detail", "custom"] });
      queryClient.invalidateQueries({ queryKey: ["frameworks"] });
    },
    onError: () => {
      toast.error(t("frameworksPage.customDomainDeleteFailed"));
    },
  });

  const addCustomElementMutation = useMutation({
    mutationFn: ({ domainId, name }) =>
      frameworkApi.addCustomElement(domainId, { name }),
    onSuccess: () => {
      toast.success(t("frameworksPage.customElementAdded"));
      queryClient.invalidateQueries({ queryKey: ["custom-domains"] });
      queryClient.invalidateQueries({ queryKey: ["framework-detail", "custom"] });
    },
    onError: () => {
      toast.error(t("frameworksPage.customElementAddFailed"));
    },
  });

  const domainStats = useMemo(() => {
    return domains.map((domain) => {
      const total = domain.elements?.length || 0;
      const selected = domain.elements?.filter((el) =>
        selectedElements.includes(el.id)
      ).length;
      return { id: domain.id, selected, total };
    });
  }, [domains, selectedElements]);

  const toggleElement = (elementId) => {
    setSelectedElements((prev) => {
      if (prev.includes(elementId)) {
        return prev.filter((id) => id !== elementId);
      }
      return [...prev, elementId];
    });
  };

  const toggleDomain = (domain) => {
    const elementIds = domain.elements?.map((el) => el.id) || [];
    setSelectedElements((prev) => {
      const allSelected = elementIds.every((id) => prev.includes(id));
      if (allSelected) {
        setPriorityElements((existing) => existing.filter((id) => !elementIds.includes(id)));
        return prev.filter((id) => !elementIds.includes(id));
      }
      const merged = new Set([...prev, ...elementIds]);
      return Array.from(merged);
    });
  };

  const togglePriority = (elementId) => {
    if (!selectedElements.includes(elementId)) {
      return;
    }
    setPriorityElements((prev) => {
      if (prev.includes(elementId)) {
        return prev.filter((id) => id !== elementId);
      }
      return [...prev, elementId];
    });
  };

  const handleFrameworkChange = (type) => {
    setFrameworkType(type);
    setSelectedElements([]);
    setPriorityElements([]);
    setFocusNote("");
  };

  const selectedCount = selectedElements.length;
  const priorityCount = priorityElements.length;
  const localizeFrameworkNode = (id, fallback) => {
    if (!isHebrew || frameworkType === "custom") {
      return fallback;
    }
    return HEBREW_FRAMEWORK_LABELS[frameworkType]?.[id] || fallback;
  };

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-6 py-6">
        <PageHeader
          title={t("frameworksPage.title")}
          description={t("frameworksPage.description")}
        />

        <Panel className="mb-6 bg-sky-50/60">
          <h2 className="text-sm font-semibold text-slate-900">{t("frameworksPage.curriculumOwnership")}</h2>
          <p className="mt-1 text-xs text-slate-600">
            {t("frameworksPage.curriculumOwnershipDescription")}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              to="/teachers"
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
            >
              {t("frameworksPage.openTeachers")}
            </Link>
          </div>
        </Panel>

        {isAdmin && (
          <Panel className="mb-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  {t("frameworksPage.recordingCompliancePolicy")}
                </h2>
                <p className="text-xs text-slate-500">
                  {t("frameworksPage.recordingComplianceDescription")}
                </p>
              </div>
              <Button
                onClick={() =>
                  saveRecordingPolicyMutation.mutate({
                    teacher_id: policyTeacherId || null,
                    period_length_days: policyPeriodDays,
                    min_recordings_per_period: policyMinRecordings,
                    reminder_offsets_days: policyReminderOffsets,
                  })
                }
                disabled={saveRecordingPolicyMutation.isPending}
                size="sm"
              >
                {saveRecordingPolicyMutation.isPending
                  ? t("frameworksPage.saving")
                  : t("frameworksPage.savePolicy")}
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-4 text-xs md:grid-cols-4">
              <Field label={t("frameworksPage.assignToTeacher")} className="text-[11px] text-slate-600">
                <Select
                  value={policyTeacherId}
                  onChange={(e) => setPolicyTeacherId(e.target.value)}
                  size="sm"
                >
                  <option value="">{t("frameworksPage.allTeachersDefault")}</option>
                  {teacherOptions.map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>
                      {teacher.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("frameworksPage.periodLength")} className="text-[11px] text-slate-600">
                <Select
                  value={policyPeriodDays}
                  onChange={(e) => setPolicyPeriodDays(Number(e.target.value))}
                  size="sm"
                >
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days</option>
                  <option value={60}>60 days</option>
                  <option value={90}>90 days</option>
                </Select>
              </Field>
              <Field label={t("frameworksPage.minRecordings")} className="text-[11px] text-slate-600">
                <Select
                  value={policyMinRecordings}
                  onChange={(e) => setPolicyMinRecordings(Number(e.target.value))}
                  size="sm"
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                  <option value={4}>4</option>
                  <option value={5}>5</option>
                </Select>
              </Field>
              <div className="flex flex-col gap-1 text-[11px] text-slate-600">
                {t("frameworksPage.reminderTiming")}
                <div className="flex flex-wrap gap-2 text-[11px] text-slate-600">
                  {[14, 7, 3, 2, 1].map((day) => (
                    <label key={day} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={policyReminderOffsets.includes(day)}
                        onChange={(e) => {
                          setPolicyReminderOffsets((prev) =>
                            e.target.checked
                              ? Array.from(new Set([...prev, day]))
                              : prev.filter((value) => value !== day)
                          );
                        }}
                      />
                      {t("frameworksPage.daysBefore", { count: day })}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-3 text-[11px] text-slate-500">
              {t("frameworksPage.requiredSubjects")}
            </div>
          </Panel>
        )}

        <Panel className="mb-6">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">
            {t("frameworksPage.frameworkSelection")}
          </h2>
          {frameworksLoading ? (
            <LoadingState message={t("frameworksPage.loadingFrameworks")} />
          ) : frameworksError ? (
            <ErrorState
              message={t("frameworksPage.frameworksLoadFailed")}
              action={
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => refetchFrameworks()}
                  disabled={frameworksFetching}
                >
                  {frameworksFetching ? t("frameworksPage.loadingFrameworks") : t("frameworksPage.retryFrameworks")}
                </Button>
              }
            />
          ) : !(frameworksRes?.frameworks || []).length ? (
            <EmptyState
              title={frameworksRes?.empty_state?.title || "Framework settings are ready when you need them."}
              message={
                frameworksRes?.empty_state?.description ||
                "Framework settings will appear here once a rubric or observation framework is added."
              }
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              {(frameworksRes?.frameworks || []).map((f) => (
                <Button
                  key={f.type}
                  onClick={() => handleFrameworkChange(f.type)}
                  size="sm"
                  variant={frameworkType === f.type ? "primary" : "secondary"}
                >
                  {t(`frameworksPage.frameworkLabels.${f.type}`, { defaultValue: f.name })}
                  <span className="ml-2 text-[10px] text-slate-500">
                    {t("frameworksPage.domainsCount", { count: f.domain_count })}
                  </span>
                </Button>
              ))}
            </div>
          )}
        </Panel>

        <Panel>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                {t("frameworksPage.focusDomains")}
              </h2>
              <p className="text-xs text-slate-500">
                {t("frameworksPage.selectedElements", { count: selectedCount })}
              </p>
              <p className="text-xs text-slate-500">
                {t("frameworksPage.priorityElements", { count: priorityCount })}
              </p>
            </div>
            <Button
              onClick={() => saveSelectionMutation.mutate()}
              disabled={saveSelectionMutation.isPending || !selectedCount}
            >
              {saveSelectionMutation.isPending
                ? t("frameworksPage.saving")
                : t("frameworksPage.saveSelection")}
            </Button>
          </div>

          {frameworkLoading ? (
            <LoadingState message={t("frameworksPage.loadingFramework")} />
          ) : frameworkError ? (
            <ErrorState message={t("frameworksPage.frameworkLoadFailed")} />
          ) : (
            <div className="space-y-4">
              {frameworkType === "custom" && (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4">
                  <div className="mb-4 rounded-md border border-slate-200 bg-white p-4">
                    <h3 className="text-sm font-semibold text-slate-900">
                      {t("frameworksPage.uploadRubric")}
                    </h3>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {t("frameworksPage.uploadRubricDescription")}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <input
                        ref={rubricUploadInputRef}
                        type="file"
                        accept=".json,.csv"
                        onChange={(e) => setRubricUploadFile(e.target.files?.[0] || null)}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => rubricUploadInputRef.current?.click()}
                        className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      >
                        {t("frameworksPage.chooseRubricFile")}
                      </button>
                      <span className="text-xs text-slate-500">
                        {rubricUploadFile ? rubricUploadFile.name : t("frameworksPage.noRubricFileSelected")}
                      </span>
                      <Button
                        onClick={() => uploadRubricMutation.mutate()}
                        disabled={uploadRubricMutation.isPending || !rubricUploadFile}
                        variant="secondary"
                        size="sm"
                      >
                        {uploadRubricMutation.isPending
                          ? t("frameworksPage.uploadingRubric")
                          : t("frameworksPage.uploadRubricButton")}
                      </Button>
                    </div>
                    <p className="mt-2 text-[11px] text-slate-500">
                      {t("frameworksPage.uploadRubricFormats")}
                    </p>
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    {t("frameworksPage.createCustomDomain")}
                  </h3>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {t("frameworksPage.createCustomDomainDescription")}
                  </p>
                  <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
                    <Input
                      type="text"
                      value={customDomainName}
                      onChange={(e) => setCustomDomainName(e.target.value)}
                      placeholder={t("frameworksPage.domainNamePlaceholder")}
                      size="sm"
                    />
                    <Input
                      type="text"
                      value={customElementsInput}
                      onChange={(e) => setCustomElementsInput(e.target.value)}
                      placeholder={t("frameworksPage.elementsPlaceholder")}
                      size="sm"
                      className="md:col-span-2"
                    />
                  </div>
                  <div className="mt-3 flex justify-end">
                    <Button
                      onClick={() => createCustomDomainMutation.mutate()}
                      disabled={
                        createCustomDomainMutation.isPending ||
                        !customDomainName.trim() ||
                        !customElementsInput.trim()
                      }
                      variant="success"
                      size="sm"
                    >
                      {createCustomDomainMutation.isPending
                        ? t("frameworksPage.creating")
                        : t("frameworksPage.addCustomDomain")}
                    </Button>
                  </div>
                  {customDomainsLoading ? (
                    <LoadingState className="mt-4" message={t("frameworksPage.loadingCustomDomains")} />
                  ) : customDomainsError ? (
                    <ErrorState className="mt-4" message={t("frameworksPage.customDomainsLoadFailed")} />
                  ) : customDomains.length > 0 ? (
                    <div className="mt-4 space-y-2">
                      {customDomains.map((domain) => (
                        <div
                          key={domain.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
                        >
                          <div>
                            <div className="font-semibold text-slate-900">{domain.name}</div>
                            <div className="text-[11px] text-slate-500">
                              {(domain.elements || [])
                                .map((el) => el.name)
                                .join(", ")}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <Input
                                type="text"
                                value={customElementInputs[domain.id] || ""}
                                onChange={(e) =>
                                  setCustomElementInputs((prev) => ({
                                    ...prev,
                                    [domain.id]: e.target.value,
                                  }))
                                }
                                placeholder={t("frameworksPage.addNewElementPlaceholder")}
                                size="sm"
                              />
                              <Button
                                onClick={() => {
                                  const value = (customElementInputs[domain.id] || "").trim();
                                  if (!value) return;
                                  addCustomElementMutation.mutate({
                                    domainId: domain.id,
                                    name: value,
                                  });
                                  setCustomElementInputs((prev) => ({
                                    ...prev,
                                    [domain.id]: "",
                                  }));
                                }}
                                variant="success"
                                size="sm"
                              >
                                {t("frameworksPage.addElement")}
                              </Button>
                            </div>
                          </div>
                          <Button
                            onClick={() =>
                              deleteCustomDomainMutation.mutate(domain.id)
                            }
                            variant="danger"
                            size="sm"
                          >
                            {t("frameworksPage.delete")}
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState className="mt-4" title={t("frameworksPage.noCustomDomains")} />
                  )}
                </div>
              )}
              {domains.map((domain) => {
                const stats = domainStats.find((d) => d.id === domain.id);
                const allSelected = stats?.selected === stats?.total && stats?.total > 0;
                return (
                  <div
                    key={domain.id}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-4"
                  >
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">
                          {localizeFrameworkNode(domain.id, domain.name)}
                        </h3>
                        <p className="text-[11px] text-slate-500">
                          {t("frameworksPage.selectedOfTotal", {
                            selected: stats?.selected || 0,
                            total: stats?.total || 0,
                          })}
                        </p>
                      </div>
                      <Button
                        onClick={() => toggleDomain(domain)}
                        size="sm"
                        variant="secondary"
                      >
                        {allSelected
                          ? t("frameworksPage.clearDomain")
                          : t("frameworksPage.selectDomain")}
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {(domain.elements || []).map((el) => {
                        const isSelected = selectedElements.includes(el.id);
                        const isPriority = priorityElements.includes(el.id);
                        return (
                          <div
                            key={el.id}
                            className={`rounded-md border bg-white p-2 text-xs text-slate-600 ${
                              isPriority ? "border-amber-300 shadow-sm" : "border-slate-200"
                            } hover:border-primary/40`}
                          >
                            <label className="flex cursor-pointer items-start gap-2">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleElement(el.id)}
                                className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 bg-white text-primary focus:ring-primary/40"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="text-slate-800">{el.id.toUpperCase()}</div>
                                <div className="text-[11px] text-slate-500">
                                  {localizeFrameworkNode(el.id, el.name)}
                                </div>
                              </div>
                            </label>
                            <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
                              <span className="text-[11px] text-slate-500">
                                {t("frameworksPage.pressurePoint")}
                              </span>
                              <Button
                                onClick={() => togglePriority(el.id)}
                                size="sm"
                                variant={isPriority ? "primary" : "secondary"}
                                disabled={!isSelected}
                              >
                                {isPriority
                                  ? t("frameworksPage.prioritySelected")
                                  : t("frameworksPage.markPriority")}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-sm font-semibold text-slate-900">
                  {t("frameworksPage.focusNote")}
                </h3>
                <p className="mt-1 text-[11px] text-slate-500">
                  {t("frameworksPage.focusNoteDescription")}
                </p>
                <textarea
                  value={focusNote}
                  onChange={(e) => setFocusNote(e.target.value)}
                  placeholder={t("frameworksPage.focusNotePlaceholder")}
                  rows={3}
                  className="mt-3 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none ring-0 placeholder:text-slate-400 focus:border-primary/50"
                />
              </div>
            </div>
          )}
        </Panel>
      </div>
    </LayoutShell>
  );
}
