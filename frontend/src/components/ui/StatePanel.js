import React from "react";
import classNames from "classnames";

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
  return <StatePanel title="Loading" message={message} className={className} />;
}

export function EmptyState({ title = "No data yet", message, action, className }) {
  return <StatePanel title={title} message={message} action={action} className={className} />;
}

export function ErrorState({ title = "Something went wrong", message, action, className }) {
  return (
    <StatePanel
      tone="error"
      title={title}
      message={message}
      action={action}
      className={className}
    />
  );
}

export function SuccessState({ title = "Saved", message, action, className }) {
  return (
    <StatePanel
      tone="success"
      title={title}
      message={message}
      action={action}
      className={className}
    />
  );
}
