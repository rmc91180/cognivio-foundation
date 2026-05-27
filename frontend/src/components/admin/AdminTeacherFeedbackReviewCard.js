/**
 * PR C7: admin teacher-facing preview + approve/hide/request-revision controls.
 *
 * Renders the `teacher_preview` / `teacher_feedback_admin_status` block
 * the backend admin assessment endpoint already returns (C5) and the
 * three review actions added in C6 (admin_approved / admin_hidden /
 * revision_requested). Lives in components/admin/ so the admin
 * assessment / VideoPlayer page can drop it in.
 *
 * Authorization invariants enforced by the backend, mirrored in the UI:
 *   * Admin approval cannot override missing source or unsafe text.
 *   * Hide and Request revision require a non-empty reason.
 *   * Notifications are fanned out server-side; this card only
 *     surfaces the resulting `teacher_feedback_admin_status`.
 */

import React, { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { adminCoachingApi } from "@/lib/api";

const STATUS_LABELS = {
  auto_allowed: { label: "Auto-allowed", tone: "ok" },
  admin_approved: { label: "Admin approved", tone: "ok" },
  admin_hidden: { label: "Hidden from teacher", tone: "warn" },
  revision_requested: { label: "Revision requested", tone: "warn" },
  blocked_source: { label: "Blocked — source invalid", tone: "fail" },
  blocked_quality: { label: "Blocked — evidence insufficient", tone: "fail" },
  blocked_safety: { label: "Blocked — unsafe text", tone: "fail" },
};

const TONE_CLASSES = {
  ok: "bg-emerald-50 text-emerald-900 border-emerald-200",
  warn: "bg-amber-50 text-amber-900 border-amber-200",
  fail: "bg-rose-50 text-rose-900 border-rose-200",
};

function StatusPill({ status }) {
  const meta = STATUS_LABELS[status] || { label: status || "Unknown", tone: "warn" };
  return (
    <span
      data-testid="teacher-feedback-admin-status-pill"
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${TONE_CLASSES[meta.tone]}`}
    >
      {meta.label}
    </span>
  );
}

function previewSummary(teacherPreview) {
  if (!teacherPreview || typeof teacherPreview !== "object") return null;
  // admin_view_of_artifact embeds the artifact under `teacher_preview` and
  // also exposes the raw element_scores. Either shape is acceptable.
  const inner = teacherPreview.teacher_preview || teacherPreview;
  return {
    allowed: inner.teacher_feedback_allowed,
    blockedReason: inner.blocked_reason,
    summary: inner.summary || {},
    actionItemsCount: inner.action_items_count ?? (inner.action_items?.length || 0),
    deepDiveAvailable: inner.deep_dive_available ?? inner.deep_dive?.available,
    guardrails: inner.guardrails || {},
  };
}

export function AdminTeacherFeedbackReviewCard({
  assessmentId,
  teacherPreview,
  teacherFeedbackAdminStatus,
  invalidateKeys = [],
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const preview = useMemo(() => previewSummary(teacherPreview), [teacherPreview]);

  const upsertMutation = useMutation({
    mutationFn: (payload) => adminCoachingApi.upsertReview(assessmentId, payload),
    onSuccess: (response) => {
      const status = response?.data?.teacher_feedback_admin_status;
      toast.success(
        status === "admin_approved"
          ? "Teacher feedback approved."
          : status === "admin_hidden"
            ? "Hidden from teacher."
            : status === "revision_requested"
              ? "Revision requested."
              : "Review updated."
      );
      setReason("");
      invalidateKeys.forEach((key) =>
        queryClient.invalidateQueries({ queryKey: Array.isArray(key) ? key : [key] })
      );
    },
    onError: (error) => {
      const detail = error?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Review action failed.");
    },
  });

  if (!assessmentId) return null;

  const handleApprove = () => {
    upsertMutation.mutate({
      status: "admin_approved",
      review_note: reason || undefined,
    });
  };
  const handleHide = () => {
    const note = reason.trim();
    if (!note) {
      toast.error("Add a reason before hiding feedback.");
      return;
    }
    upsertMutation.mutate({
      status: "admin_hidden",
      hidden_reason: note,
      review_note: note,
    });
  };
  const handleRequestRevision = () => {
    const note = reason.trim();
    if (!note) {
      toast.error("Add a reason before requesting revision.");
      return;
    }
    upsertMutation.mutate({
      status: "revision_requested",
      revision_reason: note,
      review_note: note,
    });
  };

  return (
    <section
      data-testid="admin-teacher-feedback-review-card"
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Teacher-facing preview
          </h3>
          <p className="text-xs text-slate-500">
            Approval cannot override missing source, unsafe text, or insufficient evidence.
          </p>
        </div>
        <StatusPill status={teacherFeedbackAdminStatus} />
      </div>

      {preview ? (
        <div className="grid grid-cols-1 gap-2 text-xs text-slate-700 md:grid-cols-2">
          <div>
            <span className="font-semibold text-slate-900">Allowed: </span>
            {preview.allowed ? "Yes" : "No"}
          </div>
          <div>
            <span className="font-semibold text-slate-900">Action items: </span>
            {preview.actionItemsCount}
          </div>
          <div>
            <span className="font-semibold text-slate-900">Deep dive: </span>
            {preview.deepDiveAvailable ? "Available" : "Not available"}
          </div>
          {preview.blockedReason ? (
            <div>
              <span className="font-semibold text-slate-900">Blocked reason: </span>
              {preview.blockedReason}
            </div>
          ) : null}
          {preview.summary?.opening ? (
            <div className="md:col-span-2">
              <span className="font-semibold text-slate-900">Summary preview: </span>
              {preview.summary.opening}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="text-xs text-slate-500">No teacher preview available yet.</div>
      )}

      <div className="space-y-2">
        <label className="block text-xs font-semibold text-slate-700">
          Review note (required to hide or request revision)
        </label>
        <textarea
          aria-label="Review note"
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
          placeholder="Why are you hiding or requesting revision?"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="admin-approve-button"
          onClick={handleApprove}
          disabled={upsertMutation.isPending}
          className="inline-flex min-h-[36px] items-center rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
        >
          {upsertMutation.isPending ? "Working..." : "Approve teacher feedback"}
        </button>
        <button
          type="button"
          data-testid="admin-hide-button"
          onClick={handleHide}
          disabled={upsertMutation.isPending}
          className="inline-flex min-h-[36px] items-center rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60"
        >
          Hide from teacher
        </button>
        <button
          type="button"
          data-testid="admin-request-revision-button"
          onClick={handleRequestRevision}
          disabled={upsertMutation.isPending}
          className="inline-flex min-h-[36px] items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-60"
        >
          Request revision
        </button>
      </div>
    </section>
  );
}

export default AdminTeacherFeedbackReviewCard;
