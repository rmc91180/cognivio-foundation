import React from "react";
import classNames from "classnames";

const VARIANT_CLASS = {
  primary: "cv-btn-primary",
  secondary: "cv-btn-secondary",
  ghost: "cv-btn-ghost",
  danger: "cv-btn-danger",
  success: "cv-btn-success",
};

const SIZE_CLASS = {
  sm: "px-2.5 py-1.5 text-xs",
  md: "px-3 py-2 text-sm",
  lg: "px-4 py-2.5 text-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className,
  type = "button",
  ...props
}) {
  return (
    <button
      type={type}
      className={classNames(
        "cv-btn",
        VARIANT_CLASS[variant] || VARIANT_CLASS.primary,
        SIZE_CLASS[size] || SIZE_CLASS.md,
        fullWidth && "w-full",
        className
      )}
      {...props}
    />
  );
}
