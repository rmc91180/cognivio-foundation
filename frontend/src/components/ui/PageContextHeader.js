import React from "react";
import classNames from "classnames";
import { Link } from "react-router-dom";
import { PageHeader } from "./PageHeader";

export function PageContextHeader({
  breadcrumbs = [],
  title,
  description,
  meta,
  actions,
  badge,
  stats = [],
  quickLinks = [],
  tags = [],
  className,
}) {
  const visibleBreadcrumbs = breadcrumbs.filter(Boolean);
  const visibleStats = stats.filter((item) => item && (item.label || item.value));
  const visibleQuickLinks = quickLinks.filter(Boolean);
  const visibleTags = tags.filter((item) => item && item.label && item.value);

  return (
    <div className={classNames("mb-6", className)}>
      {visibleBreadcrumbs.length ? (
        <nav
          aria-label="Breadcrumb"
          className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-slate-500"
        >
          {visibleBreadcrumbs.map((item, index) => {
            const isLast = index === visibleBreadcrumbs.length - 1;
            return (
              <React.Fragment key={`${item.label}-${index}`}>
                {item.to && !isLast ? (
                  <Link to={item.to} className="font-medium text-slate-500 hover:text-slate-800">
                    {item.label}
                  </Link>
                ) : (
                  <span className={classNames(isLast ? "font-semibold text-slate-800" : "")}>
                    {item.label}
                  </span>
                )}
                {!isLast ? <span className="text-slate-300">/</span> : null}
              </React.Fragment>
            );
          })}
        </nav>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        {badge ? (
          <div className="mb-3 inline-flex rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold text-primary">
            {badge}
          </div>
        ) : null}

        <PageHeader
          title={title}
          description={description}
          meta={meta}
          actions={actions}
          compact
          className={visibleStats.length || visibleQuickLinks.length || visibleTags.length ? "mb-0" : ""}
        />

        {visibleTags.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {visibleTags.map((item) => (
              <div
                key={`${item.label}-${item.value}`}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-700"
              >
                <span className="font-semibold uppercase tracking-wide text-slate-500">
                  {item.label}
                </span>
                <span className="font-medium text-slate-900">{item.value}</span>
              </div>
            ))}
          </div>
        ) : null}

        {visibleStats.length ? (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {visibleStats.map((item) => (
              <div
                key={item.label}
                className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
              >
                <div className="text-[11px] uppercase tracking-wide text-slate-500">
                  {item.label}
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {item.value}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {visibleQuickLinks.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {visibleQuickLinks.map((item) => (
              <Link
                key={`${item.label}-${item.to}`}
                to={item.to}
                className={classNames(
                  "inline-flex items-center rounded-md border px-3 py-1.5 text-[11px] font-medium transition-colors",
                  item.active
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                )}
              >
                {item.label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
