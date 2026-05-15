import React, { useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * VideoTimeline - A visual timeline with observation markers
 * @param {number} duration - Total video duration in seconds
 * @param {number} currentTime - Current playback time in seconds
 * @param {Array} observations - Array of observations with timestamp_seconds
 * @param {function} onSeek - Callback when user clicks to seek
 */
export function VideoTimeline({ duration, currentTime, observations = [], onSeek, showTechnicalDetails = false }) {
  const { t, i18n } = useTranslation();
  const [hoveredMarker, setHoveredMarker] = useState(null);
  const isRtl = i18n.dir() === "rtl";

  if (!duration || duration <= 0) {
    return null;
  }

  const getMarkerPosition = (timestamp) => {
    return (timestamp / duration) * 100;
  };

  const getScoreColor = (score) => {
    if (score == null) return "bg-slate-500";
    if (score >= 7) return "bg-emerald-500";
    if (score >= 5) return "bg-amber-500";
    return "bg-red-500";
  };

  const handleTimelineClick = (e) => {
    if (!onSeek) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = clickX / rect.width;
    const seekTime = percentage * duration;
    onSeek(seekTime);
  };

  const progressPercentage = (currentTime / duration) * 100;

  return (
    <div className="relative">
      {/* Timeline bar */}
      <div
        className="relative h-4 cursor-pointer rounded-full bg-slate-800 sm:h-2"
        onClick={handleTimelineClick}
      >
        {/* Progress bar */}
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-primary/60"
          style={{ width: `${progressPercentage}%` }}
        />

        {/* Observation markers */}
        {observations.map((obs) => {
          if (typeof obs.timestamp_seconds !== "number") return null;
          const position = getMarkerPosition(obs.timestamp_seconds);

          return (
            <div
              key={obs.id}
              className="group absolute top-1/2 -translate-y-1/2"
              style={{ left: `${position}%` }}
              onMouseEnter={() => setHoveredMarker(obs.id)}
              onMouseLeave={() => setHoveredMarker(null)}
            >
              {/* Marker dot */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onSeek) onSeek(obs.timestamp_seconds);
                }}
                className={`-ml-3 h-6 w-6 rounded-full border-2 border-slate-950 transition-transform hover:scale-125 sm:-ml-1.5 sm:h-3 sm:w-3 sm:hover:scale-150 ${getScoreColor(obs.score)}`}
                title={obs.admin_comment || t("videoTimeline.observation")}
              />

              {/* Hover tooltip */}
              {hoveredMarker === obs.id && (
                <div className={`pointer-events-none absolute bottom-full z-30 mb-2 w-56 rounded-lg border border-slate-700 bg-slate-900/95 p-3 text-xs shadow-xl ${isRtl ? "right-1/2 translate-x-1/2" : "left-1/2 -translate-x-1/2"}`}>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="font-semibold text-slate-100">
                      {formatTime(obs.timestamp_seconds)}
                    </span>
                    {showTechnicalDetails && obs.score != null && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium text-white ${getScoreColor(obs.score)}`}
                      >
                        {obs.score.toFixed(1)}/10
                      </span>
                    )}
                  </div>
                  {showTechnicalDetails && obs.element_id && (
                    <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">
                      {obs.element_id}
                    </div>
                  )}
                  <p className="line-clamp-2 text-slate-300">
                    {obs.admin_comment || t("videoTimeline.observationRecorded")}
                  </p>
                  <div className={`absolute -bottom-1.5 h-3 w-3 rotate-45 border-b border-r border-slate-700 bg-slate-900 ${isRtl ? "right-1/2 translate-x-1/2" : "left-1/2 -translate-x-1/2"}`} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Time labels */}
      <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export default VideoTimeline;
