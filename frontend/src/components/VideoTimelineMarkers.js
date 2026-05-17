import React from "react";

export const formatTimestamp = (seconds = 0) => {
  const safeSeconds = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = safeSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
};

export function VideoTimelineMarkers({
  duration,
  currentTime = 0,
  comments = [],
  onSeekTo,
  onSelectComment,
  highlightedCommentId,
}) {
  const usableDuration = Number(duration) || 0;
  if (!usableDuration || usableDuration <= 0) {
    return null;
  }

  const progressPct = Math.max(0, Math.min(100, (Number(currentTime) / usableDuration) * 100));

  return (
    <div className="relative py-2" aria-label="Comment timeline">
      <div className="relative h-5 rounded-full bg-slate-800 sm:h-3">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-primary/60"
          style={{ width: `${progressPct}%` }}
        />
        {comments.map((comment) => {
          const timestamp = Number(comment.timestamp_seconds);
          if (!Number.isFinite(timestamp)) return null;
          const left = Math.max(0, Math.min(100, (timestamp / usableDuration) * 100));
          const isActive = highlightedCommentId === comment.id;

          return (
            <button
              key={comment.id}
              type="button"
              aria-label={`Jump to note at ${formatTimestamp(timestamp)}`}
              title={`${formatTimestamp(timestamp)} - ${comment.body || "Observation note"}`}
              onClick={() => {
                onSeekTo?.(timestamp);
                onSelectComment?.(comment.id);
              }}
              className={`absolute top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-sm transition hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary sm:h-5 sm:w-5 ${
                isActive ? "bg-primary" : "bg-amber-400"
              }`}
              style={{ left: `${left}%` }}
            />
          );
        })}
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
        <span>{formatTimestamp(currentTime)}</span>
        <span>{formatTimestamp(duration)}</span>
      </div>
    </div>
  );
}

export default VideoTimelineMarkers;
