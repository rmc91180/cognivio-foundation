import { useEffect, useState } from "react";

function coverageColor(coveragePct) {
  if (coveragePct > 80) return "#16a34a";
  if (coveragePct >= 50) return "#d97706";
  return "#dc2626";
}

export function ObservationCoverageRing({
  coveragePct = 0,
  observedCount = 0,
  totalCount = 0,
  size = 164,
  strokeWidth = 12,
}) {
  const [animatedPct, setAnimatedPct] = useState(0);
  const normalizedPct = Math.max(0, Math.min(100, Number(coveragePct) || 0));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (animatedPct / 100) * circumference;
  const color = coverageColor(normalizedPct);

  useEffect(() => {
    if (typeof window === "undefined" || !window.requestAnimationFrame) {
      setAnimatedPct(normalizedPct);
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => setAnimatedPct(normalizedPct));
    return () => window.cancelAnimationFrame(frame);
  }, [normalizedPct]);

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        role="img"
        aria-label={`${normalizedPct}% observation coverage`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeLinecap="round"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <div className="text-3xl font-semibold text-slate-950">
          {Math.round(normalizedPct)}%
        </div>
        <div className="mt-1 max-w-[7rem] text-xs font-medium leading-4 text-slate-500">
          {observedCount} of {totalCount} teachers observed
        </div>
      </div>
    </div>
  );
}
