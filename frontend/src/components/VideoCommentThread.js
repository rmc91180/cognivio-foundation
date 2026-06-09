import React, { useMemo, useState } from "react";
import { Badge, Button, EmptyState, Textarea } from "@/components/ui";
import { formatTimestamp } from "@/components/VideoTimelineMarkers";

const roleLabels = {
  super_admin: "Super admin",
  school_admin: "School admin",
  training_admin: "Training admin",
  teacher: "Teacher",
};

const visibilityLabels = {
  observer_private: "Private note",
  shared_with_teacher: "Shared with teacher",
  admin_only: "Admin only",
};

const visibilityVariants = {
  observer_private: "neutral",
  shared_with_teacher: "success",
  admin_only: "warning",
};

function normalizeComment(comment) {
  return {
    ...comment,
    timestamp_seconds: Number(comment.timestamp_seconds) || 0,
    visibility: comment.visibility || (comment.is_private ? "observer_private" : "shared_with_teacher"),
  };
}

function sortComments(comments) {
  return [...(comments || [])]
    .map(normalizeComment)
    .sort((a, b) => {
      const timeDelta = a.timestamp_seconds - b.timestamp_seconds;
      if (timeDelta !== 0) return timeDelta;
      return String(a.created_at || "").localeCompare(String(b.created_at || ""));
    });
}

export function VideoCommentThread({
  comments = [],
  currentUser,
  onSeekTo,
  onReply,
  onEdit,
  onDelete,
  highlightedCommentId,
  isAdminView = false,
}) {
  const [replyTo, setReplyTo] = useState(null);
  const [replyBody, setReplyBody] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editBody, setEditBody] = useState("");

  const { parents, repliesByParent } = useMemo(() => {
    const sorted = sortComments(comments).filter(
      (comment) => isAdminView || comment.visibility === "shared_with_teacher"
    );
    const nextReplies = {};
    const nextParents = [];
    sorted.forEach((comment) => {
      if (comment.thread_parent_id) {
        nextReplies[comment.thread_parent_id] = nextReplies[comment.thread_parent_id] || [];
        nextReplies[comment.thread_parent_id].push(comment);
      } else {
        nextParents.push(comment);
      }
    });
    return { parents: nextParents, repliesByParent: nextReplies };
  }, [comments, isAdminView]);

  const canManage = (comment) => {
    if (!currentUser) return false;
    return comment.author_id === currentUser.id || isAdminView;
  };

  const submitReply = (comment) => {
    const body = replyBody.trim();
    if (!body) return;
    onReply?.(comment, body);
    setReplyBody("");
    setReplyTo(null);
  };

  const submitEdit = (comment) => {
    const body = editBody.trim();
    if (!body) return;
    onEdit?.(comment, body);
    setEditingId(null);
    setEditBody("");
  };

  if (!parents.length) {
    return (
      <EmptyState
        title="Add a note at the moment you want to revisit."
        message="Timestamped notes will appear here in the order they happen in the lesson."
      />
    );
  }

  const renderComment = (comment, isReply = false) => {
    const isHighlighted = highlightedCommentId === comment.id;

    return (
      <article
        key={comment.id}
        className={`rounded-md border px-3 py-3 text-sm ${
          isHighlighted ? "border-primary bg-primary/5" : "border-slate-200 bg-white"
        } ${isReply ? "ml-5" : ""}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <button
            type="button"
            onClick={() => onSeekTo?.(comment.timestamp_seconds)}
            className="inline-flex min-h-[36px] items-center rounded-full bg-slate-100 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-200"
          >
            {formatTimestamp(comment.timestamp_seconds)}
          </button>
          <div className="flex flex-wrap items-center gap-1">
            {comment.focus_area_label ? (
              <Badge variant="neutral">{comment.focus_area_label}</Badge>
            ) : null}
            {isAdminView ? (
              <Badge variant={visibilityVariants[comment.visibility] || "neutral"}>
                {visibilityLabels[comment.visibility] || "Shared"}
              </Badge>
            ) : null}
          </div>
        </div>
        <div className="mt-2 text-xs text-slate-500">
          {comment.author_name || "Cognivio user"}
          {comment.author_role ? ` - ${roleLabels[comment.author_role] || comment.author_role}` : ""}
        </div>
        {editingId === comment.id ? (
          <div className="mt-3 space-y-2">
            <Textarea rows={3} value={editBody} onChange={(event) => setEditBody(event.target.value)} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => submitEdit(comment)} disabled={!editBody.trim()}>
                Save note
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setEditingId(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-2 leading-6 text-slate-700">{comment.body}</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {!isReply ? (
            <Button size="sm" variant="secondary" onClick={() => setReplyTo(comment.id)}>
              Reply
            </Button>
          ) : null}
          {canManage(comment) ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setEditingId(comment.id);
                  setEditBody(comment.body || "");
                }}
              >
                Edit
              </Button>
              <Button size="sm" variant="danger" onClick={() => onDelete?.(comment)}>
                Delete
              </Button>
            </>
          ) : null}
        </div>
        {replyTo === comment.id ? (
          <div className="mt-3 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
            <Textarea
              rows={2}
              value={replyBody}
              onChange={(event) => setReplyBody(event.target.value)}
              placeholder="Add a short reply..."
            />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => submitReply(comment)} disabled={!replyBody.trim()}>
                Add reply
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setReplyTo(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </article>
    );
  };

  return (
    <div className="space-y-3">
      {parents.map((comment) => (
        <div key={comment.id} className="space-y-2">
          {renderComment(comment)}
          {(repliesByParent[comment.id] || []).map((reply) => renderComment(reply, true))}
        </div>
      ))}
    </div>
  );
}

export default VideoCommentThread;
