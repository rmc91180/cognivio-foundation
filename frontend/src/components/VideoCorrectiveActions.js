import React from "react";
import { buildActionControls } from "@/lib/videoActions";

/**
 * PR C9.5 PART 3–6 (contract D) — corrective-action controls for a video.
 *
 * Renders the backend-authorized ``video.actions`` eligibility map (projected by
 * ``buildActionControls``). Every control reflects the server's decision exactly:
 * an enabled button is one the live endpoint will accept, and a disabled button
 * always shows its specific reason — never a dead button, never a generic blank.
 * The component is presentational: it calls ``onAction(key)`` and shows a pending
 * state for ``pendingKey``; the page owns the mutations.
 */
export function VideoCorrectiveActions({
  video,
  onAction,
  pendingKey = null,
  className = "",
}) {
  const controls = buildActionControls(video);
  if (!controls.length) return null;

  return (
    <div
      data-testid="video-corrective-actions"
      className={`rounded-lg border border-slate-200 bg-white px-4 py-3 ${className}`}
    >
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Corrective actions
      </h3>
      <ul className="space-y-2">
        {controls.map((control) => {
          const pending = pendingKey === control.key;
          return (
            <li
              key={control.key}
              data-testid={`action-${control.key}`}
              data-eligible={control.eligible ? "true" : "false"}
              className="flex flex-wrap items-center gap-2 text-xs"
            >
              <button
                type="button"
                disabled={!control.eligible || pending}
                onClick={() => control.eligible && onAction && onAction(control.key)}
                className={`inline-flex min-h-[32px] items-center justify-center rounded-md px-3 py-1.5 font-semibold ${
                  control.eligible
                    ? "bg-primary text-white hover:bg-primary/90"
                    : "cursor-not-allowed border border-slate-200 bg-slate-50 text-slate-400"
                }`}
              >
                {pending ? "Working…" : control.label}
              </button>
              {!control.eligible && control.disabledReason ? (
                <span
                  data-testid={`action-${control.key}-reason`}
                  className="text-[11px] text-slate-500"
                >
                  {control.disabledReason}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default VideoCorrectiveActions;
