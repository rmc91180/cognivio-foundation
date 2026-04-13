import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { BrandMark } from "@/components/BrandMark";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Button, Field, Input, Panel } from "@/components/ui";
import { runtimeConfig } from "@/lib/runtimeConfig";
import { getDefaultHomeRoute } from "@/lib/userRoutes";

export function AuthPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    user,
    login,
    register,
    requestAccessAsync,
    loggingIn,
    registering,
    requestingAccess,
  } = useAuth();
  const isDemo = runtimeConfig.demoMode;
  const approvalRequired = runtimeConfig.registrationApprovalRequired;
  const [mode, setMode] = useState("login");
  const [role, setRole] = useState("teacher");
  const [form, setForm] = useState({
    email: "",
    password: "",
    name: "",
    organization_name: "",
    school_name: "",
    requested_manager_email: "",
  });
  const nameInputId = "auth-name";
  const emailInputId = "auth-email";
  const passwordInputId = "auth-password";
  const organizationInputId = "auth-organization";
  const schoolInputId = "auth-school";
  const managerEmailInputId = "auth-manager-email";

  useEffect(() => {
    if (user) {
      navigate(getDefaultHomeRoute(user), { replace: true });
    }
  }, [navigate, user]);

  const onSubmit = async (e) => {
    e.preventDefault();
    const isTeacherRole = role === "teacher";
    const needsSchoolName = role === "teacher" || role === "school_admin";
    const signupPayload = {
      email: form.email,
      password: form.password,
      name: form.name || form.email,
      organization_name: form.organization_name,
      ...(needsSchoolName ? { school_name: form.school_name } : {}),
      ...(isTeacherRole && form.requested_manager_email
        ? { requested_manager_email: form.requested_manager_email }
        : {}),
      ...(!isDemo ? { role } : {}),
    };

    if (mode === "signup" && approvalRequired) {
      try {
        const res = await requestAccessAsync(signupPayload);
        setForm((current) => ({
          ...current,
          password: "",
          requested_manager_email: "",
        }));
        if (res?.data?.status === "approved") {
          setMode("login");
        }
      } catch (error) {
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
            ...(!isDemo ? { role } : {}),
          };

    const fn = mode === "signup" ? register : login;
    fn(payload);
  };

  const busy = loggingIn || registering || requestingAccess;
  const isTeacherRole = role === "teacher";
  const isSchoolAdminRole = role === "school_admin";
  const isTrainingAdminRole = role === "training_admin";
  const requiresOrganizationFields = mode === "signup" && !isDemo;
  const requiresSchoolName = requiresOrganizationFields && !isTrainingAdminRole;
  const requiresManagerEmail = requiresOrganizationFields && isTeacherRole;
  const roleLabel =
    mode === "login" ? t("auth.loginRoleLabel") : t("auth.signUpRoleLabel");
  const roleHint =
    mode === "login"
      ? t(
          isSchoolAdminRole
            ? "auth.loginSchoolAdminHint"
            : isTrainingAdminRole
            ? "auth.loginTrainingAdminHint"
            : "auth.loginTeacherHint"
        )
      : t(
          isSchoolAdminRole
            ? "auth.signUpSchoolAdminHint"
            : isTrainingAdminRole
            ? "auth.signUpTrainingAdminHint"
            : "auth.signUpTeacherHint"
        );
  const approvalDescription =
    isSchoolAdminRole
      ? t("auth.approvalRequiredSchoolAdminDescription")
      : isTrainingAdminRole
      ? t("auth.approvalRequiredTrainingAdminDescription")
      : t("auth.approvalRequiredTeacherDescription");
  const organizationFieldLabel = isTrainingAdminRole
    ? t("auth.trainingOrganizationName")
    : t("auth.schoolOrOrganizationName");
  const organizationFieldHint = isTrainingAdminRole
    ? t("auth.trainingOrganizationHint")
    : t("auth.schoolOrganizationHint");

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8">
      <Panel as="div" className="w-full max-w-md p-8">
        <div className="mb-6 text-center">
          <div className="mb-4 flex justify-center">
            <LanguageSwitcher />
          </div>
          <div className="mb-2 inline-flex">
            <BrandMark compact />
          </div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-slate-900">
            {t("auth.title")}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {t("auth.subtitle")}
          </p>
        </div>

        <div className="mb-4 flex gap-2 rounded-xl bg-slate-100 p-1 text-xs">
          <button
            type="button"
            onClick={() => setMode("login")}
            className={`flex-1 rounded px-3 py-2 ${
              mode === "login"
                ? "bg-white text-slate-900 shadow-sm font-semibold"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t("auth.loginTab")}
          </button>
          {!isDemo && (
            <button
              type="button"
              onClick={() => setMode("signup")}
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

        {!isDemo && (
          <div className="mb-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              {roleLabel}
            </div>
            <div className="grid grid-cols-1 gap-2 rounded-xl bg-slate-100 p-1 text-sm sm:grid-cols-3">
              <button
                type="button"
                onClick={() => setRole("teacher")}
                className={`rounded-lg px-3 py-2 ${
                  role === "teacher"
                    ? "bg-white text-slate-900 shadow-sm font-semibold"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {t("auth.teacherRole")}
              </button>
              <button
                type="button"
                onClick={() => setRole("school_admin")}
                className={`rounded-lg px-3 py-2 ${
                  isSchoolAdminRole
                    ? "bg-white text-slate-900 shadow-sm font-semibold"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {t("auth.schoolAdminRole")}
              </button>
              <button
                type="button"
                onClick={() => setRole("training_admin")}
                className={`rounded-lg px-3 py-2 ${
                  isTrainingAdminRole
                    ? "bg-white text-slate-900 shadow-sm font-semibold"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {t("auth.trainingAdminRole")}
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500">{roleHint}</p>
          </div>
        )}

        {isDemo && (
          <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            <div className="font-semibold text-slate-700">{t("auth.demoLogins")}</div>
            <div className="mt-1">
              {t("auth.principalDemo")}
            </div>
            <div>{t("auth.teacherDemo")}</div>
          </div>
        )}

        {!isDemo && approvalRequired && mode === "signup" && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <div className="font-semibold">{t("auth.approvalRequiredTitle")}</div>
            <div className="mt-1">{approvalDescription}</div>
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          {mode === "signup" && !isDemo && (
            <Field label={t("auth.name")} htmlFor={nameInputId}>
              <Input
                id={nameInputId}
                type="text"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
              />
            </Field>
          )}
          {requiresOrganizationFields && (
            <Field label={organizationFieldLabel} htmlFor={organizationInputId}>
              <Input
                id={organizationInputId}
                type="text"
                required
                value={form.organization_name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, organization_name: e.target.value }))
                }
              />
              <p className="mt-2 text-xs text-slate-500">{organizationFieldHint}</p>
            </Field>
          )}
          {requiresSchoolName && (
            <Field label={t("auth.schoolName")} htmlFor={schoolInputId}>
              <Input
                id={schoolInputId}
                type="text"
                required
                value={form.school_name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, school_name: e.target.value }))
                }
              />
              <p className="mt-2 text-xs text-slate-500">
                {t("auth.schoolNameHint")}
              </p>
            </Field>
          )}
          <Field label={t("auth.email")} htmlFor={emailInputId}>
            <Input
              id={emailInputId}
              type="email"
              required
              value={form.email}
              onChange={(e) =>
                setForm((f) => ({ ...f, email: e.target.value }))
              }
            />
          </Field>
          {requiresManagerEmail && (
            <Field
              label={t("auth.requestedManagerEmail")}
              htmlFor={managerEmailInputId}
            >
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
              <p className="mt-2 text-xs text-slate-500">
                {t("auth.requestedManagerEmailHint")}
              </p>
            </Field>
          )}
          <Field label={t("auth.password")} htmlFor={passwordInputId}>
            <Input
              id={passwordInputId}
              type="password"
              required
              value={form.password}
              onChange={(e) =>
                setForm((f) => ({ ...f, password: e.target.value }))
              }
            />
          </Field>
          <Button type="submit" disabled={busy} fullWidth className="mt-2 shadow-brand">
            {busy
              ? mode === "signup"
                ? approvalRequired
                  ? t("auth.signingUp")
                  : t("auth.creatingAccount")
                : t("auth.signingIn")
              : mode === "login"
              ? t("auth.signIn")
              : t("auth.signUpCta")}
          </Button>
        </form>

        {!isDemo && approvalRequired && mode === "login" ? (
          <p className="mt-4 text-center text-xs text-slate-500">
            {t("auth.needApprovalHint")}
          </p>
        ) : null}
      </Panel>
    </div>
  );
}

