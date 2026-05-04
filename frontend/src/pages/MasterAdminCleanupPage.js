import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge, Button, Dialog, ErrorState, Field, Input, LoadingState, Panel, Textarea } from "@/components/ui";
import { MasterAdminPageScaffold } from "@/components/master-admin/MasterAdminPageScaffold";
import { masterAdminApi } from "@/lib/api";

const GROUP_LABELS = {
  unused_teachers: "Unused teacher profiles",
  duplicate_teachers: "Possible duplicate teacher profiles",
  abandoned_pending_users: "Abandoned pending users",
  revoked_users: "Revoked users",
  orphaned_privacy_profiles: "Orphaned privacy profiles",
  orphaned_videos: "Orphaned videos",
};

const GROUP_DESCRIPTIONS = {
  unused_teachers: "Teacher profiles with little or no activity that may be safe to archive or delete.",
  duplicate_teachers: "Profiles that appear to share a name, email, or institution context.",
  abandoned_pending_users: "Access requests that have remained pending beyond the cleanup threshold.",
  revoked_users: "Accounts with access removed that may be eligible for permanent deletion.",
  orphaned_privacy_profiles: "Privacy reference records not linked to active teacher profiles.",
  orphaned_videos: "Video records whose teacher or owner linkage appears incomplete.",
};

function CandidateCard({ groupKey, item, onAction }) {
  const label = item.label || item.name || item.email || item.teacher_name || item.id || "Unknown record";
  const meta = item.meta || item.email || item.organization_name || item.school_name || "No additional context";
  const counts = item.dependency_counts || item.counts || {};
  const hasCounts = Object.keys(counts).length > 0;
  const canTeacherDelete = groupKey === "unused_teachers" || groupKey === "duplicate_teachers";
  const canUserDelete = groupKey === "abandoned_pending_users" || groupKey === "revoked_users";

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-slate-900">{label}</div>
          <div className="mt-1 text-sm text-slate-600">{meta}</div>
        </div>
        <Badge variant="neutral">{item.status || item.approval_status || item.profile_status || "candidate"}</Badge>
      </div>
      {hasCounts ? (
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
          {Object.entries(counts).map(([key, value]) => (
            <span key={key} className="rounded-full bg-white px-2 py-1">
              {key}: <strong>{value}</strong>
            </span>
          ))}
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {canTeacherDelete ? (
          <>
            <Button type="button" variant="secondary" onClick={() => onAction("archive_teacher", item)}>
              Archive profile
            </Button>
            <Button type="button" variant="danger" onClick={() => onAction("hard_delete_teacher", item)}>
              Permanently delete
            </Button>
          </>
        ) : null}
        {canUserDelete ? (
          <Button type="button" variant="danger" onClick={() => onAction("hard_delete_user", item)}>
            Permanently delete user
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function MasterAdminCleanupPage() {
  const queryClient = useQueryClient();
  const [pendingAction, setPendingAction] = useState(null);
  const [reason, setReason] = useState("");
  const [confirmationText, setConfirmationText] = useState("");

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["master-admin-cleanup-candidates"],
    queryFn: () => masterAdminApi.cleanupCandidates().then((res) => res.data),
  });

  const groups = useMemo(() => {
    const payload = data || {};
    return Object.keys(GROUP_LABELS).map((key) => ({
      key,
      items: Array.isArray(payload[key]) ? payload[key] : [],
    }));
  }, [data]);

  const closeDialog = () => {
    setPendingAction(null);
    setReason("");
    setConfirmationText("");
  };

  const cleanupMutation = useMutation({
    mutationFn: async ({ action, item, reason: actionReason, confirmation }) => {
      if (action === "archive_teacher") {
        return masterAdminApi.runCleanupAction({
          action: "archive_unused_teachers",
          candidate_ids: [item.teacher_id || item.id],
          reason: actionReason,
          confirmation_text: confirmation,
        });
      }
      if (action === "hard_delete_teacher") {
        return masterAdminApi.hardDeleteTeacher(item.teacher_id || item.id, {
          reason: actionReason,
          confirmation_text: confirmation,
          delete_storage_assets: true,
          delete_linked_user: true,
        });
      }
      if (action === "hard_delete_user") {
        return masterAdminApi.hardDeleteUser(item.user_id || item.id, {
          reason: actionReason,
          confirmation_text: confirmation,
          delete_linked_teacher: false,
        });
      }
      throw new Error(`Unsupported cleanup action: ${action}`);
    },
    onSuccess: () => {
      toast.success("Cleanup action completed.");
      queryClient.invalidateQueries({ queryKey: ["master-admin-cleanup-candidates"] });
      queryClient.invalidateQueries({ queryKey: ["master-admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["master-admin-overview"] });
      closeDialog();
    },
    onError: (error) => {
      toast.error(error?.response?.data?.detail || "Cleanup action failed.");
    },
  });

  const openAction = (action, item) => {
    setPendingAction({ action, item });
    setReason("");
    setConfirmationText("");
  };

  const submitAction = () => {
    if (!pendingAction) return;
    cleanupMutation.mutate({
      action: pendingAction.action,
      item: pendingAction.item,
      reason: reason.trim(),
      confirmation: confirmationText.trim(),
    });
  };

  const dialogTitle = pendingAction?.action === "archive_teacher"
    ? "Archive teacher profile"
    : pendingAction?.action === "hard_delete_user"
      ? "Permanently delete user"
      : "Permanently delete teacher profile";
  const targetLabel = pendingAction?.item?.email || pendingAction?.item?.name || pendingAction?.item?.label || pendingAction?.item?.id || "this record";

  return (
    <MasterAdminPageScaffold
      title="Data cleanup"
      description="Find unused, duplicate, revoked, and orphaned records before they accumulate in the database. Super admins can permanently delete teacher profiles even when they contain data."
      meta="Sensitive data lifecycle controls"
      actions={
        <Button type="button" variant="secondary" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? "Refreshing..." : "Refresh"}
        </Button>
      }
      railNoteTitle="Destructive action policy"
      railNote="Archive is the normal cleanup path. Permanent deletion is super-admin only, requires confirmation, and should write audit events and deleted-count summaries on the backend."
    >
      {isLoading ? <LoadingState message="Loading cleanup candidates..." /> : null}
      {isError ? (
        <ErrorState
          title="Could not load cleanup candidates"
          message="The cleanup endpoint may not be deployed yet, or the backend returned an error."
        />
      ) : null}

      {!isLoading && !isError ? (
        <div className="space-y-6">
          {groups.map((group) => (
            <Panel key={group.key} className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{GROUP_LABELS[group.key]}</h2>
                  <p className="text-sm text-slate-500">{GROUP_DESCRIPTIONS[group.key]}</p>
                </div>
                <Badge variant={group.items.length ? "warning" : "success"}>{group.items.length}</Badge>
              </div>
              {group.items.length ? (
                <div className="space-y-3">
                  {group.items.map((item) => (
                    <CandidateCard
                      key={item.id || item.teacher_id || item.user_id || JSON.stringify(item)}
                      groupKey={group.key}
                      item={item}
                      onAction={openAction}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                  No candidates in this group.
                </div>
              )}
            </Panel>
          ))}
        </div>
      ) : null}

      <Dialog
        open={Boolean(pendingAction)}
        onClose={() => (cleanupMutation.isPending ? null : closeDialog())}
        title={dialogTitle}
        description={`Target: ${targetLabel}. This action requires a reason and confirmation text.`}
        closeLabel="Close"
        actions={
          <>
            <Button type="button" variant="secondary" onClick={closeDialog} disabled={cleanupMutation.isPending}>
              Cancel
            </Button>
            <Button type="button" variant="danger" onClick={submitAction} disabled={cleanupMutation.isPending || !reason.trim() || !confirmationText.trim()}>
              {cleanupMutation.isPending ? "Working..." : "Confirm"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-950">
            Permanent deletion can remove users, teacher profiles, videos, assessments, privacy records, and related storage assets depending on the backend action. Use it only for intentional cleanup.
          </div>
          <Field label="Reason">
            <Textarea
              rows={4}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Explain why this record should be archived or deleted."
            />
          </Field>
          <Field label={`Type the target email, name, or id to confirm (${targetLabel})`}>
            <Input
              value={confirmationText}
              onChange={(event) => setConfirmationText(event.target.value)}
              placeholder="Confirmation text"
            />
          </Field>
        </div>
      </Dialog>
    </MasterAdminPageScaffold>
  );
}
