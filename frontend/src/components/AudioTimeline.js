import React, { useMemo, useState } from "react";

const SPEAKER_STYLES = {
  teacher: {
    label: "Teacher",
    color: "#0f766e",
  },
  student: {
    label: "Student",
    color: "#2563eb",
  },
  silence: {
    label: "Silence",
    color: "#94a3b8",
  },
};

function formatClock(seconds) {
  const safeSeconds = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function AudioTimeline({
  segments = [],
  keyMoments = [],
  duration = 0,
  onSeek,
}) {
  const [hoveredSegment, setHoveredSegment] = useState(null);
  const totalDuration = useMemo(() => {
    const segmentEnd = Math.max(
      0,
      ...segments.map((segment) => Number(segment.end_sec || 0))
    );
    const keyMomentEnd = Math.max(
      0,
      ...keyMoments.map((moment) => Number(moment.timestamp_sec || 0))
    );
    return Math.max(Number(duration || 0), segmentEnd, keyMomentEnd);
  }, [duration, keyMoments, segments]);

  if (!totalDuration || !segments.length) {
    return null;
  }

  return (
    <div className="relative pt-5">
      <div className="absolute left-0 right-0 top-0 h-5">
        {keyMoments.map((moment, index) => {
          const left = Math.min(
            100,
            Math.max(0, (Number(moment.timestamp_sec || 0) / totalDuration) * 100)
          );
          return (
            <button
              key={`${moment.timestamp_sec}-${moment.signal_type}-${index}`}
              type="button"
              onClick={() => onSeek?.(Number(moment.timestamp_sec || 0))}
              className="absolute top-0 h-4 w-4 -translate-x-1/2 rounded-full border border-white bg-amber-500 shadow-sm hover:scale-110 focus:outline-none focus:ring-2 focus:ring-amber-300"
              style={{ left: `${left}%` }}
              title={`${moment.label} · ${formatClock(moment.timestamp_sec)}`}
              aria-label={`Seek to ${moment.label} at ${formatClock(moment.timestamp_sec)}`}
            />
          );
        })}
      </div>
      <div className="relative flex h-4 overflow-hidden rounded-full bg-slate-200">
        {segments.map((segment, index) => {
          const start = Math.max(0, Number(segment.start_sec || 0));
          const end = Math.max(start, Number(segment.end_sec || start));
          const width = Math.max(0.25, ((end - start) / totalDuration) * 100);
          const style = SPEAKER_STYLES[segment.speaker] || SPEAKER_STYLES.teacher;
          return (
            <button
              key={`${start}-${end}-${segment.speaker}-${index}`}
              type="button"
              onClick={() => onSeek?.(start)}
              onMouseEnter={() => setHoveredSegment(index)}
              onMouseLeave={() => setHoveredSegment(null)}
              className="h-full min-w-[2px] border-r border-white/30 transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-primary"
              style={{
                width: `${width}%`,
                backgroundColor: style.color,
              }}
              title={`${style.label} · ${formatClock(start)}-${formatClock(end)}`}
              aria-label={`Seek to ${style.label} segment at ${formatClock(start)}`}
            >
              {hoveredSegment === index ? (
                <span className="sr-only">
                  {style.label} {formatClock(start)}-{formatClock(end)}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
        {Object.entries(SPEAKER_STYLES).map(([key, item]) => (
          <span key={key} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: item.color }}
            />
            {item.label}
          </span>
        ))}
        {keyMoments.length ? (
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" />
            Key moment
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default AudioTimeline;
