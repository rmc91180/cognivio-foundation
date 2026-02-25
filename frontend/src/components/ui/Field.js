import React, { forwardRef } from "react";
import classNames from "classnames";

const SIZE_CLASS = {
  sm: "cv-input-sm",
  md: "",
};

export function Field({ label, hint, htmlFor, className, children }) {
  return (
    <div className={classNames("cv-field", className)}>
      {label ? (
        <label htmlFor={htmlFor} className="cv-label">
          {label}
        </label>
      ) : null}
      {children}
      {hint ? <p className="cv-help">{hint}</p> : null}
    </div>
  );
}

export const Input = forwardRef(function Input(
  { size = "md", className, ...props },
  ref
) {
  return (
    <input
      ref={ref}
      className={classNames("cv-input", SIZE_CLASS[size] || "", className)}
      {...props}
    />
  );
});

export const Select = forwardRef(function Select(
  { size = "md", className, children, ...props },
  ref
) {
  return (
    <select
      ref={ref}
      className={classNames("cv-select", SIZE_CLASS[size] || "", className)}
      {...props}
    >
      {children}
    </select>
  );
});

export const Textarea = forwardRef(function Textarea(
  { size = "md", className, ...props },
  ref
) {
  return (
    <textarea
      ref={ref}
      className={classNames("cv-textarea", SIZE_CLASS[size] || "", className)}
      {...props}
    />
  );
});
