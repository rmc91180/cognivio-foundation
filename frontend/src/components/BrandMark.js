import React from "react";
import { Link } from "react-router-dom";

export function BrandMark({ to = "/", compact = false }) {
  return (
    <Link to={to} className="inline-flex items-center gap-2 no-underline">
      <span
        className={[
          "cv-brand-chip",
          compact ? "h-8 w-8 text-xs rounded-lg" : "h-10 w-10 text-sm rounded-xl",
        ].join(" ")}
      >
        Co
      </span>
      {!compact && (
        <span className="font-heading text-lg font-semibold tracking-tight text-slate-900">
          Cognivio
        </span>
      )}
    </Link>
  );
}

export default BrandMark;
