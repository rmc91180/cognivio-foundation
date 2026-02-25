import React from "react";
import classNames from "classnames";

const VARIANT_CLASS = {
  neutral: "cv-badge-neutral",
  success: "cv-badge-success",
  warning: "cv-badge-warning",
  danger: "cv-badge-danger",
};

export function Badge({ variant = "neutral", className, children }) {
  return (
    <span
      className={classNames(
        "cv-badge",
        VARIANT_CLASS[variant] || VARIANT_CLASS.neutral,
        className
      )}
    >
      {children}
    </span>
  );
}
