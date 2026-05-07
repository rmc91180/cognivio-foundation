import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { BrandMark } from "@/components/BrandMark";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { InstitutionSuggestionList } from "@/components/ui/InstitutionSuggestionList";
import { Button, Field, Input, Panel } from "@/components/ui";
import { runtimeConfig } from "@/lib/runtimeConfig";
import { authApi } from "@/lib/api";
import { getHomeRoute } from "@/lib/roleRouter";
import { CheckCircle2, ClipboardList, GraduationCap, School } from "lucide-react";

function SegmentButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-lg px-3 py-2 transition-colors",
        active
          ? "bg-white text-slate-900 shadow-sm font-semibold"
          : "text-slate-500 hover:text-slate-700",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function ChoiceCard({ active, icon: Icon, title, subtext, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex min-h-36 flex-col items-start gap-3 rounded-xl border bg-white p-4 text-left transition",
        active ? "border-teal-500 ring-2 ring-teal-100" : "border-slate-200 hover:border-slate-300",
      ].join(" ")}
    >
      <span className={`rounded-lg p-2 ${active ? "bg-teal-50 text-teal-700" : "bg-slate-50 text-slate-600"}`}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="text-sm font-semibold text-slate-950">{title}</span>
      <span className="text-xs leading-5 text-slate-500">{subtext}</span>
      {active ? <CheckCircle2 className="mt-auto h-4 w-4 text-teal-600" /> : null}
    </button>
  );
}

function getPasswordStrength(password) {
  let score = 0;
  if ((password || "").length >= 8) score += 1;
  if (/[A-Z]/.test(password || "")) score += 1;
  if (/[0-9]/.test(password || "")) score += 1;
  if (/[^A-Za-z0-9]/.test(password || "")) score += 1;
  const labels = ["Too short", "Weak", "Fair", "Good", "Strong"];
  const colors = ["bg-slate-200", "bg-rose-500", "bg-amber-500", "bg-teal-500", "bg-emerald-600"];
  return { score, label: labels[score], color: colors[score] };
}

export function AuthPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    user,
    login,
    register,
    requestAccessAsync,
    requestPasswordResetAsync,
    confirmPasswordResetAsync,
    loggingIn,
    registering,
    requestingAccess,
    requestingPasswordReset,
    confirmingPasswordReset,
  } = useAuth();
  const isDemo = runtimeConfig.demoMode;
  const approvalRequired = runtimeConfig.registrationApprovalRequired;
  const [mode, setMode] = useState("login");
  const [showPasswordResetRequest, setShowPasswordResetRequest] = useState(false);
  const [accessType, setAccessType] = useState("teacher");
  const [institutionType, setInstitutionType] = useState("k12");
  const [form, setForm] = useState({
    email: "",
    password: "",
    password_confirm: "",
    name: "",
    organization_name: "",
    school_name: "",
    requested_manager_email: "",
  });

  const nameInputId = "auth-name";
  const emailInputId = "auth-email";
  const passwordInputId = "auth-password";
  const organizationInputId = "auth-organization";
  const subgroupInputId = "auth-subgroup";
  const managerEmailInputId = "auth-manager-email";
  const passwordConfirmInputId = "auth-password-confirm";
  const resetToken = useMemo(
    () => new URLSearchParams(location.search).get("reset_token") || "",
    [location.search]
  );
  const isResetConfirmMode = Boolean(resetToken);
  const isResetRequestMode = mode === "login" && showPasswordResetRequest && !isResetConfirmMode;

  useEffect(() => {
    if (user) {
      navigate(getHomeRoute(user), { replace: true });
    }
  }, [navigate, user]);

  useEffect(() => {
    if (isResetConfirmMode) {
      setMode("login");
      setShowPasswordResetRequest(false);
    }
  }, [isResetConfirmMode]);

  const derivedRole = useMemo(() => {
    if (accessType === "administrator") {
      return institutionType === "training" ? "training_admin" : "school_admin";
    }
    return "teacher";
  }, [accessType, institutionType]);

  const isTeacherRole = derivedRole === "teacher";
  const isSchoolAdminRole = derivedRole === "school_admin";
  const isTrainingAdminRole = derivedRole === "training_admin";
  const requiresOrganizationFields = mode === "signup" && !isDemo;
  const showInstitutionTypeRubric = !isDemo && mode === "login" && accessType === "administrator";
  const requiresSubgroupName = requiresOrganizationFields && institutionType === "k12";
  const showsSubgroupField = requiresOrganizationFields;
  const requiresManagerEmail = requiresOrganizationFields && isTeacherRole;

  const roleLabel = mode === "login" ? t("auth.loginRoleLabel") : t("auth.signUpRoleLabel");
  const institutionTypeLabel = mode === "login" ? t("auth.loginInstitutionTypeLabel") : t("auth.signUpInstitutionTypeLabel");

  const roleHint = useMemo(() => {
    if (mode === "login") {
      return accessType === "administrator"
        ? t("auth.loginAdministratorHint")
        : t("auth.loginTeacherHint");
    }
    if (accessType === "administrator") {
      return institutionType === "training"
        ? t("auth.signUpAdministratorTrainingHint")
        : t("auth.signUpAdministratorSchoolHint");
    }
    return institutionType === "training"
      ? t("auth.signUpTeacherTrainingHint")
      : t("auth.signUpTeacherSchoolHint");
  }, [accessType, institutionType, mode, t]);

  const approvalDescription = useMemo(() => {
    if (accessType === "administrator") {
      return institutionType === "training"
        ? t("auth.approvalRequiredTrainingAdminDescription")
        : t("auth.approvalRequiredSchoolAdminDescription");
    }
    return institutionType === "training"
      ? t("auth.approvalRequiredTrainingTeacherDescription")
      : t("auth.approvalRequiredTeacherDescription");
  }, [accessType, institutionType, t]);

  const organizationFieldLabel = institutionType === "training"
    ? "Training provider / college name"
    : accessType === "administrator"
      ? "District or network"
      : "District or network";
  const organizationFieldHint = institutionType === "training"
    ? "University, college, or teacher preparation program."
    : "Optional district, charter network, or school system.";
  const subgroupFieldLabel = institutionType === "training"
    ? accessType === "administrator"
      ? "Program or department"
      : "Program / cohort name"
    : "School name";
  const subgroupFieldHint = institutionType === "training"
    ? "Optional program, department, or cohort label."
    : "Primary or secondary school where observations will happen.";
  const managerFieldLabel = institutionType === "training"
    ? t("auth.requestedTrainingManagerEmail")
    : t("auth.requestedSchoolManagerEmail");
  const managerFieldHint = institutionType === "training"
    ? t("auth.requestedTrainingManagerEmailHint")
    : t("auth.requestedSchoolManagerEmailHint");

  const passwordStrength = getPasswordStrength(form.password);
  const institutionDisplay = institutionType === "training" ? "Teacher Training Program" : "K-12 School";
  const roleDisplay = accessType === "administrator" ? "Administrator" : "Teacher";
  const primaryPlaceName = institutionType === "training" ? form.organization_name : form.school_name;
  const summarySentence = `You are requesting access as a ${roleDisplay} at ${primaryPlaceName || institutionDisplay}.`;

  const { data: institutionLookupRes } = useQuery({
    queryKey: ["signup-institution-lookup", institutionType, form.organization_name],
    queryFn: () =>
      authApi
        .institutionLookup({
          organization_type: institutionType === "training" ? "training" : "school",
          q: form.organization_name.trim(),
          limit: 6,
        })
        .then((res) => res.data),
    enabled: mode === "signup" && !isDemo && form.organization_name.trim().length >= 2,
  });

  const applyInstitutionSuggestion = (suggestion) => {
    setForm((current) => ({
      ...current,
      organization_name: suggestion.organization_name || current.organization_name,
      school_name: suggestion.school_name || current.school_name,
      requested_manager_email:
        isTeacherRole && suggestion.manager_email
          ? suggestion.manager_email
          : current.requested_manager_email,
    }));
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (isResetConfirmMode) {
      if (form.password !== form.password_confirm) {
        return;
      }
      try {
        await confirmPasswordResetAsync({
          token: resetToken,
          password: form.password,
        });
        setForm((current) => ({
          ...current,
          password: "",
          password_confirm: "",
        }));
        navigate("/login", { replace: true });
      } catch {
        return;
      }
      return;
    }

    if (isResetRequestMode) {
      try {
        await requestPasswordResetAsync({ email: form.email });
        setShowPasswordResetRequest(false);
      } catch {
        return;
      }
      return;
    }

    const signupPayload = {
      email: form.email,
      password: form.password,
      name: form.name || form.email,
      user_type: accessType,
      institution_type: institutionType,
      role_requested: derivedRole,
      organization_type: institutionType === "training" ? "training" : "school",
      organization_name:
        institutionType === "training"
          ? form.organization_name
          : form.organization_name || form.school_name,
      school_name: institutionType === "k12" ? form.school_name : undefined,
      training_provider_name: institutionType === "training" ? form.organization_name : undefined,
      district_or_network: institutionType === "k12" ? form.organization_name || undefined : undefined,
      program_or_cohort_name:
        institutionType === "training" && accessType === "teacher"
          ? form.school_name || undefined
          : undefined,
      program_or_department:
        institutionType === "training" && accessType === "administrator"
          ? form.school_name || undefined
          : undefined,
      linked_admin_email: isTeacherRole && form.requested_manager_email
        ? form.requested_manager_email
        : undefined,
      requested_manager_email: isTeacherRole && form.requested_manager_email
        ? form.requested_manager_email
        : undefined,
      ...(!isDemo ? { role: derivedRole } : {}),
    };

    if (mode === "signup" && approvalRequired) {
      try {
        const res = await requestAccessAsync(signupPayload);
        setForm((current) => ({
          ...current,
          password: "",
        }));
        if (res?.data?.status === "approved") {
          setMode("login");
        }
      } catch {
        return;
      }
      return;
    }

    const payload =
      mode === "signup"
        ? signupPayload
        : {
            email: form.email,
            password: form.password,
            ...(!isDemo ? { role: derivedRole } : {}),
          };

    const fn = mode === "signup" ? register : login;
    fn(payload);
  };

  const busy =
    loggingIn ||
    registering ||
    requestingAccess ||
    requestingPasswordReset ||
    confirmingPasswordReset;
  const submitLabel = isResetConfirmMode
    ? busy
      ? t("auth.resetPasswordSubmitting")
      : t("auth.resetPasswordSubmit")
    : isResetRequestMode
      ? busy
        ? t("auth.passwordResetRequestSubmitting")
        : t("auth.passwordResetRequestSubmit")
      : busy
        ? mode === "signup"
          ? approvalRequired
            ? t("auth.signingUp")
            : t("auth.creatingAccount")
          : t("auth.signingIn")
        : mode === "login"
          ? t("auth.signIn")
          : t("auth.signUpCta");
  const pageTitle = isResetConfirmMode
    ? t("auth.resetPasswordTitle")
    : isResetRequestMode
      ? t("auth.forgotPasswordTitle")
      : t("auth.title");
  const pageSubtitle = isResetConfirmMode
    ? t("auth.resetPasswordSubtitle")
    : isResetRequestMode
      ? t("auth.forgotPasswordSubtitle")
      : t("auth.subtitle");

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8">
      <Panel as="div" className="w-full max-w-xl p-8">
        <div className="mb-6 text-center">
          <div className="mb-4 flex justify-center">
            <LanguageSwitcher />
          </div>
          <div className="mb-2 inline-flex">
            <BrandMark compact />
          </div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-slate-900">
            {pageTitle}
          </h1>
          <p className="mt-1 text-sm text-slate-500">{pageSubtitle}</p>
        </div>

        {!isResetConfirmMode ? (
          <div className="mb-4 flex gap-2 rounded-xl bg-slate-100 p-1 text-xs">
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setShowPasswordResetRequest(false);
            }}
            className={`flex-1 rounded px-3 py-2 ${
              mode === "login" && !showPasswordResetRequest
                ? "bg-white text-slate-900 shadow-sm font-semibold"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t("auth.loginTab")}
          </button>
          {!isDemo && (
            <button
              type="button"
              onClick={() => {
                setMode("signup");
                setShowPasswordResetRequest(false);
              }}
              className={`flex-1 rounded px-3 py-2 ${
                mode === "signup"
                  ? "bg-white text-slate-900 shadow-sm font-semibold"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t("auth.signUpTab")}
            </button>
          )}
          </div>
        ) : null}

        {!isDemo && !isResetRequestMode && !isResetConfirmMode ? (
          <div className="mb-4 space-y-4">
            {mode === "signup" ? (
              <>
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Step 1
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <ChoiceCard
                      active={accessType === "teacher"}
                      icon={GraduationCap}
                      title="I am a Teacher"
                      subtext="I want to view my observations, coaching goals, and feedback"
                      onClick={() => setAccessType("teacher")}
                    />
                    <ChoiceCard
                      active={accessType === "administrator"}
                      icon={ClipboardList}
                      title="I am an Administrator"
                      subtext="I manage teachers and run observations at my school or program"
                      onClick={() => setAccessType("administrator")}
                    />
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Step 2
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <ChoiceCard
                      active={institutionType === "k12"}
                      icon={School}
                      title="K-12 School"
                      subtext="A primary or secondary school"
                      onClick={() => setInstitutionType("k12")}
                    />
                    <ChoiceCard
                      active={institutionType === "training"}
                      icon={GraduationCap}
                      title="Teacher Training Program"
                      subtext="A university, college, or teacher preparation program"
                      onClick={() => setInstitutionType("training")}
                    />
                  </div>
                </div>
              </>
            ) : (
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                {roleLabel}
              </div>
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1 text-sm">
                <SegmentButton active={accessType === "teacher"} onClick={() => setAccessType("teacher")}>
                  {t("auth.teacherRole")}
                </SegmentButton>
                <SegmentButton active={accessType === "administrator"} onClick={() => setAccessType("administrator")}>
                  {t("auth.adminRole")}
                </SegmentButton>
              </div>
            </div>
            )}

            {showInstitutionTypeRubric ? (
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {institutionTypeLabel}
                </div>
                <div className="grid grid-cols-1 gap-2 rounded-xl bg-slate-100 p-1 text-sm sm:grid-cols-2">
                  <SegmentButton active={institutionType === "k12"} onClick={() => setInstitutionType("k12")}>
                    {t("auth.institutionTypeSchool")}
                  </SegmentButton>
                  <SegmentButton active={institutionType === "training"} onClick={() => setInstitutionType("training")}>
                    {t("auth.institutionTypeTraining")}
                  </SegmentButton>
                </div>
                <p className="mt-2 text-xs text-slate-500">{t("auth.institutionTypeHint")}</p>
              </div>
            ) : null}

            {mode === "login" ? <p className="text-xs text-slate-500">{roleHint}</p> : null}
          </div>
        ) : null}

        {isDemo && (
          <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            <div className="font-semibold text-slate-700">{t("auth.demoLogins")}</div>
            <div className="mt-1">{t("auth.principalDemo")}</div>
            <div>{t("auth.teacherDemo")}</div>
            <div>{t("auth.trainingAdminDemo")}</div>
          </div>
        )}

        {!isDemo && approvalRequired && mode === "signup" && !isResetConfirmMode && !isResetRequestMode && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <div className="font-semibold">{t("auth.approvalRequiredTitle")}</div>
            <div className="mt-1">{approvalDescription}</div>
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          {mode === "signup" && !isDemo && !isResetConfirmMode && !isResetRequestMode && (
            <>
              <Panel className="space-y-4 border-slate-200 bg-slate-50">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{t("auth.institutionDetailsTitle")}</div>
                  <p className="mt-1 text-xs text-slate-500">{t("auth.institutionDetailsDescription")}</p>
                </div>

                <Field label={organizationFieldLabel} htmlFor={organizationInputId}>
                  <Input
                    id={organizationInputId}
                    type="text"
                    required={institutionType === "training"}
                    value={form.organization_name}
                    onChange={(e) => setForm((f) => ({ ...f, organization_name: e.target.value }))}
                  />
                  <p className="mt-2 text-xs text-slate-500">{organizationFieldHint}</p>
                  <InstitutionSuggestionList
                    suggestions={institutionLookupRes?.suggestions || []}
                    title={t("auth.institutionMatchesTitle")}
                    emptyLabel={
                      form.organization_name.trim().length >= 2
                        ? t("auth.institutionMatchesEmpty")
                        : null
                    }
                    selectLabel={t("auth.useInstitutionMatch")}
                    onSelect={applyInstitutionSuggestion}
                  />
                </Field>

                {showsSubgroupField ? (
                  <Field label={subgroupFieldLabel} htmlFor={subgroupInputId}>
                    <Input
                      id={subgroupInputId}
                      type="text"
                      required={requiresSubgroupName}
                      value={form.school_name}
                      onChange={(e) => setForm((f) => ({ ...f, school_name: e.target.value }))}
                    />
                    <p className="mt-2 text-xs text-slate-500">{subgroupFieldHint}</p>
                  </Field>
                ) : null}

                {requiresManagerEmail ? (
                  <Field label={managerFieldLabel} htmlFor={managerEmailInputId}>
                    <Input
                      id={managerEmailInputId}
                      type="email"
                      value={form.requested_manager_email}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          requested_manager_email: e.target.value,
                        }))
                      }
                    />
                    <p className="mt-2 text-xs text-slate-500">{managerFieldHint}</p>
                  </Field>
                ) : null}
              </Panel>

              <Panel className="space-y-3 border-slate-200 bg-white">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Step 4</div>
                  <p className="mt-1 text-xs text-slate-500">Review your access request before submitting.</p>
                </div>
                <div className="rounded-xl border border-teal-300 bg-teal-50/40 p-4 text-sm text-slate-800">
                  <p className="font-semibold text-slate-950">{summarySentence}</p>
                  {isTeacherRole && form.requested_manager_email ? (
                    <p className="mt-2">Your administrator: {form.requested_manager_email}</p>
                  ) : null}
                  <p className="mt-2">Institution type: {institutionDisplay}</p>
                  <p className="mt-2 text-xs font-semibold text-teal-800">Access is subject to approval.</p>
                </div>
              </Panel>
            </>
          )}

          {mode === "signup" && !isDemo && !isResetConfirmMode && !isResetRequestMode && (
            <Field label={t("auth.name")} htmlFor={nameInputId}>
              <Input
                id={nameInputId}
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </Field>
          )}

          <Field
            label={
              isResetRequestMode
                ? t("auth.passwordResetEmailLabel")
                : t("auth.email")
            }
            htmlFor={emailInputId}
          >
            <Input
              id={emailInputId}
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </Field>

          {!isResetRequestMode ? (
            <Field
              label={isResetConfirmMode ? t("auth.newPassword") : t("auth.password")}
              htmlFor={passwordInputId}
            >
            <Input
              id={passwordInputId}
              type="password"
              required
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            />
            {mode === "signup" && !isDemo ? (
              <div className="mt-2">
                <div className="flex gap-1">
                  {[0, 1, 2, 3].map((index) => (
                    <span
                      key={index}
                      className={`h-1.5 flex-1 rounded-full ${
                        index < passwordStrength.score ? passwordStrength.color : "bg-slate-200"
                      }`}
                    />
                  ))}
                </div>
                <p className="mt-1 text-xs text-slate-500">Password strength: {passwordStrength.label}</p>
              </div>
            ) : null}
            </Field>
          ) : null}

          {isResetConfirmMode ? (
            <Field label={t("auth.confirmNewPassword")} htmlFor={passwordConfirmInputId}>
              <Input
                id={passwordConfirmInputId}
                type="password"
                required
                value={form.password_confirm || ""}
                onChange={(e) => setForm((f) => ({ ...f, password_confirm: e.target.value }))}
              />
            </Field>
          ) : null}

          {isResetConfirmMode && form.password && form.password_confirm && form.password !== form.password_confirm ? (
            <p className="text-xs text-rose-600">{t("auth.passwordMismatch")}</p>
          ) : null}

          <Button type="submit" disabled={busy} fullWidth className="mt-2 shadow-brand">
            {submitLabel}
          </Button>
        </form>

        {mode === "login" && !isResetRequestMode && !isResetConfirmMode ? (
          <div className="mt-3 text-center">
            <button
              type="button"
              onClick={() => setShowPasswordResetRequest(true)}
              className="text-xs font-medium text-primary hover:text-primary/80"
            >
              {t("auth.forgotPasswordLink")}
            </button>
          </div>
        ) : null}

        {isResetRequestMode || isResetConfirmMode ? (
          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => {
                setShowPasswordResetRequest(false);
                setForm((current) => ({ ...current, password: "", password_confirm: "" }));
                navigate("/login", { replace: true });
              }}
              className="text-xs font-medium text-primary hover:text-primary/80"
            >
              {t("auth.backToLogin")}
            </button>
          </div>
        ) : null}

        {!isDemo && approvalRequired && mode === "login" && !isResetRequestMode && !isResetConfirmMode ? (
          <p className="mt-4 text-center text-xs text-slate-500">
            {t("auth.needApprovalHint")}
          </p>
        ) : null}
      </Panel>
    </div>
  );
}
