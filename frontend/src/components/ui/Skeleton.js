import React from "react";

function toCssSize(value) {
  return typeof value === "number" ? `${value}px` : value;
}

export function Skeleton({
  width = "100%",
  height = "1rem",
  rounded = "rounded-md",
  className = "",
  style,
  ...props
}) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse bg-gray-100 ${rounded} ${className}`}
      style={{ width: toCssSize(width), height: toCssSize(height), ...style }}
      {...props}
    />
  );
}

export function SkeletonText({ width = "100%", className = "", ...props }) {
  return (
    <Skeleton
      width={width}
      height={16}
      className={className}
      rounded="rounded"
      {...props}
    />
  );
}

export function SkeletonCard({ height = 160, className = "", ...props }) {
  return (
    <Skeleton
      width="100%"
      height={height}
      rounded="rounded-xl"
      className={className}
      {...props}
    />
  );
}

export function SkeletonTable({ rows = 5, columns = 4, className = "" }) {
  const columnCells = Array.from({ length: columns });
  const bodyRows = Array.from({ length: rows });

  return (
    <div className={`overflow-hidden rounded-lg border border-slate-200 bg-white ${className}`}>
      <table className="min-w-full text-xs">
        <thead className="bg-slate-50">
          <tr>
            {columnCells.map((_, index) => (
              <th key={`header-${index}`} className="px-3 py-3">
                <SkeletonText width={index === 0 ? "60%" : "75%"} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {bodyRows.map((_, rowIndex) => (
            <tr key={`row-${rowIndex}`}>
              {columnCells.map((__, columnIndex) => (
                <td key={`cell-${rowIndex}-${columnIndex}`} className="px-3 py-3">
                  <SkeletonText width={columnIndex === 0 ? "80%" : "65%"} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SkeletonAvatar({ size = 40, className = "" }) {
  return (
    <Skeleton
      width={size}
      height={size}
      rounded="rounded-full"
      className={className}
    />
  );
}

export function SkeletonStat({ className = "" }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 ${className}`}>
      <SkeletonText width="55%" />
      <Skeleton width="45%" height={32} rounded="rounded-md" className="mt-3" />
    </div>
  );
}
