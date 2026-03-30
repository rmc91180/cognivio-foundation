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
  const [form, setForm] = useState({ email: "", password: "", name: "" });

  useEffect(() => {
    if (user) {
      navigate(getDefaultHomeRoute(user), { replace: true });
    }
  }, [navigate, user]);

  const onSubmit = async (e) => {
    e.preventDefault();
    const payload =
      mode === "register"
        ? {
            email: form.email,
            password: form.password,
            name: form.name || form.email,
          }
        : {
            email: form.email,
            password: form.password,
          };

    if (mode === "request_access") {
      try {
        const res = await requestAccessAsync(payload);
        setForm((current) => ({ ...current, password: "" }));
        if (res?.data?.status === "approved") {
          setMode("login");
        }
      } catch (error) {
        return;
      }
      return;
    }

    const fn = mode === "register" ? register : login;
    fn(payload);
  };

  const busy = loggingIn || registering || requestingAccess;

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
          {!isDemo && !approvalRequired && (
            <button
              type="button"
              onClick={() => setMode("register")}
              className={`flex-1 rounded px-3 py-2 ${
                mode === "register"
                  ? "bg-white text-slate-900 shadow-sm font-semibold"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t("auth.registerTab")}
            </button>
          )}
          {!isDemo && approvalRequired && (
            <button
              type="button"
              onClick={() => setMode("request_access")}
              className={`flex-1 rounded px-3 py-2 ${
                mode === "request_access"
                  ? "bg-white text-slate-900 shadow-sm font-semibold"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t("auth.requestAccessTab")}
            </button>
          )}
        </div>

        {isDemo && (
          <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            <div className="font-semibold text-slate-700">{t("auth.demoLogins")}</div>
            <div className="mt-1">
              {t("auth.principalDemo")}
            </div>
            <div>{t("auth.teacherDemo")}</div>
          </div>
        )}

        {!isDemo && approvalRequired && mode === "request_access" && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <div className="font-semibold">{t("auth.approvalRequiredTitle")}</div>
            <div className="mt-1">{t("auth.approvalRequiredDescription")}</div>
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          {(mode === "register" || mode === "request_access") && !isDemo && (
            <Field label={t("auth.name")}>
              <Input
                type="text"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
              />
            </Field>
          )}
          <Field label={t("auth.email")}>
            <Input
              type="email"
              required
              value={form.email}
              onChange={(e) =>
                setForm((f) => ({ ...f, email: e.target.value }))
              }
            />
          </Field>
          <Field label={t("auth.password")}>
            <Input
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
              ? mode === "request_access"
                ? t("auth.requestingAccess")
                : t("auth.signingIn")
              : mode === "login"
              ? t("auth.signIn")
              : mode === "request_access"
              ? t("auth.requestAccessCta")
              : t("auth.createAccount")}
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

