import React from "react";
import classNames from "classnames";

export function PageHeader({
  title,
  description,
  meta,
  actions,
  className,
  compact = false,
}) {
  return (
    <header
      className={classNames(
        "flex flex-col gap-4 md:flex-row md:items-center md:justify-between",
        compact ? "" : "mb-6",
        className
      )}
    >
      <div>
        <h1 className="font-heading text-2xl font-semibold text-slate-900">{title}</h1>
        {description ? <p className="mt-1 text-sm text-slate-600">{description}</p> : null}
        {meta ? <div className="mt-2 text-[10px] text-slate-400">{meta}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
