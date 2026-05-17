import React from "react";
import { formatTimestamp } from "@/components/VideoTimelineMarkers";

const speakerStyles = {
  teacher: "bg-sky-500",
  student: "bg-emerald-500",
  silence: "bg-slate-300",
  unknown: "bg-amber-400",
};

const speakerLabels = {
  teacher: "Teacher",
  student: "Students",
  silence: "Quiet",
  unknown: "Audio",
};

export function AudioTimeline({ segments = [], keyMoments = [], duration, onSeek }) {
  const totalDuration =
    Number(duration) ||
    segments.reduce((max, segment) => Math.max(max, Number(segment.end_sec) || 0), 0);

  if (!segments.length || !totalDuration) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
        Talk-time details will appear here after audio review is complete.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative h-8 overflow-hidden rounded-md bg-slate-100" aria-label="Audio timeline">
        {segments.map((segment, index) => {
          const start = Math.max(0, Number(segment.start_sec) || 0);
          const end = Math.max(start, Number(segment.end_sec) || start);
          const width = Math.max(0.5, ((end - start) / totalDuration) * 100);
          const left = Math.max(0, (start / totalDuration) * 100);
          const speaker = segment.speaker || "unknown";

          return (
            <button
              key={`${start}-${end}-${index}`}
              type="button"
              aria-label={`Jump to ${speakerLabels[speaker] || "audio"} at ${formatTimestamp(start)}`}
              title={`${speakerLabels[speaker] || "Audio"} ${formatTimestamp(start)}`}
              onClick={() => onSeek?.(start)}
              className={`absolute top-0 h-full min-w-[10px] ${speakerStyles[speaker] || speakerStyles.unknown} focus:z-10 focus:outline-none focus:ring-2 focus:ring-primary`}
              style={{ left: `${left}%`, width: `${width}%` }}
            />
          );
        })}
        {keyMoments.map((moment, index) => {
          const left = Math.max(0, Math.min(100, ((Number(moment.timestamp_sec) || 0) / totalDuration) * 100));
          return (
            <button
              key={`${moment.timestamp_sec}-${index}`}
              type="button"
              aria-label={`Jump to ${moment.label || "key moment"} at ${formatTimestamp(moment.timestamp_sec)}`}
              title={`${moment.label || "Key moment"} - ${formatTimestamp(moment.timestamp_sec)}`}
              onClick={() => onSeek?.(Number(moment.timestamp_sec) || 0)}
              className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-slate-900 shadow focus:outline-none focus:ring-2 focus:ring-primary"
              style={{ left: `${left}%` }}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3 text-[11px] text-slate-500">
        {Object.entries(speakerLabels).slice(0, 3).map(([speaker, label]) => (
          <span key={speaker} className="inline-flex items-center gap-1">
            <span className={`h-2.5 w-2.5 rounded-full ${speakerStyles[speaker]}`} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default AudioTimeline;
