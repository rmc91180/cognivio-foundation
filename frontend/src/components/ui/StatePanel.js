import React from "react";
import classNames from "classnames";
import { useTranslation } from "react-i18next";

const TONE_CLASS = {
  neutral: "cv-state-neutral",
  success: "cv-state-success",
  error: "cv-state-error",
};

function StatePanel({
  tone = "neutral",
  title,
  message,
  action,
  className,
  children,
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={classNames("cv-state", TONE_CLASS[tone] || TONE_CLASS.neutral, className)}
    >
      {title ? <h3 className="text-sm font-semibold text-slate-900">{title}</h3> : null}
      {message ? <p className="mt-1 text-sm">{message}</p> : null}
      {children}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function LoadingState({ message = "Loading...", className }) {
  const { t } = useTranslation();
  const resolvedMessage = message === "Loading..." ? t("state.loadingMessage") : message;
  return (
    <StatePanel
      title={t("state.loadingTitle")}
      message={resolvedMessage}
      className={className}
    />
  );
}

export function EmptyState({ title = "No data yet", message, action, className }) {
  const { t } = useTranslation();
  const resolvedTitle = title === "No data yet" ? t("state.emptyTitle") : title;
  return <StatePanel title={resolvedTitle} message={message} action={action} className={className} />;
}

export function ErrorState({ title = "Something went wrong", message, action, className }) {
  const { t } = useTranslation();
  const resolvedTitle =
    title === "Something went wrong" ? t("state.errorTitle") : title;
  return (
    <StatePanel
      tone="error"
      title={resolvedTitle}
      message={message}
      action={action}
      className={className}
    />
  );
}

export function SuccessState({ title = "Saved", message, action, className }) {
  const { t } = useTranslation();
  const resolvedTitle = title === "Saved" ? t("state.successTitle") : title;
  return (
    <StatePanel
      tone="success"
      title={resolvedTitle}
      message={message}
      action={action}
      className={className}
    />
  );
}
