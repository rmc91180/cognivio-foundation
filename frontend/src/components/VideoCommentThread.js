import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Clock3,
  Lock,
  MessageCircle,
  Pencil,
  Reply,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { frameworkApi, videoApi } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Badge, Button, Field, Select, Textarea } from "@/components/ui";

const DOMAIN_COLORS = [
  "#2563eb",
  "#059669",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#be123c",
  "#4f46e5",
];

function formatClock(seconds) {
  const safeSeconds = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function formatTimeAgo(value) {
  if (!value) return "";
  const created = Date.parse(value);
  if (Number.isNaN(created)) return "";
  const seconds = Math.max(1, Math.floor((Date.now() - created) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function canEditComment(comment, user) {
  if (!comment || comment.author_id !== user?.id) return false;
  const created = Date.parse(comment.created_at);
  if (Number.isNaN(created)) return false;
  return Date.now() - created <= 15 * 60 * 1000;
}

function buildRubricOptions(selection, framework) {
  const selected = new Set(selection?.selected_elements || []);
  const options = [];
  (framework?.domains || []).forEach((domain, domainIndex) => {
    const color = DOMAIN_COLORS[domainIndex % DOMAIN_COLORS.length];
    (domain.elements || []).forEach((element) => {
      if (selected.size && !selected.has(element.id)) return;
      options.push({
        id: element.id,
        code: element.id,
        name: element.name || element.id,
        domainId: domain.id || domain.name || `domain-${domainIndex}`,
        domainName: domain.name || domain.id || "Rubric",
        color,
      });
    });
  });
  return options;
}

export function VideoCommentThread({
  videoId,
  currentTime,
  duration = 0,
  onSeekTo,
  onStartAddComment,
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [highlightedCommentId, setHighlightedCommentId] = useState(null);
  const [formState, setFormState] = useState(null);
  const [body, setBody] = useState("");
  const [rubricElementId, setRubricElementId] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const commentRefs = useRef({});

  const { data: commentsRes, isLoading } = useQuery({
    queryKey: ["video-comments", videoId],
    enabled: Boolean(videoId),
    queryFn: () => videoApi.listComments(videoId).then((res) => res.data),
  });

  const comments = useMemo(() => {
    const raw = commentsRes?.comments || commentsRes || [];
    return [...raw].sort(
      (left, right) =>
        Number(left.timestamp_seconds || 0) - Number(right.timestamp_seconds || 0) ||
        String(left.created_at || "").localeCompare(String(right.created_at || ""))
    );
  }, [commentsRes]);

  const { data: selectionRes } = useQuery({
    queryKey: ["framework-selection-current"],
    queryFn: () => frameworkApi.currentSelection().then((res) => res.data),
  });
  const frameworkType = selectionRes?.framework_type || "danielson";
  const { data: frameworkRes } = useQuery({
    queryKey: ["framework-details", frameworkType],
    enabled: Boolean(frameworkType),
    queryFn: () => frameworkApi.get(frameworkType).then((res) => res.data),
  });
  const rubricOptions = useMemo(
    () => buildRubricOptions(selectionRes, frameworkRes),
    [frameworkRes, selectionRes]
  );
  const rubricById = useMemo(() => {
    const map = {};
    rubricOptions.forEach((option) => {
      map[option.id] = option;
    });
    return map;
  }, [rubricOptions]);

  const invalidateComments = () => {
    queryClient.invalidateQueries({ queryKey: ["video-comments", videoId] });
  };

  const createMutation = useMutation({
    mutationFn: (payload) => videoApi.createComment(videoId, payload),
    onSuccess: () => {
      toast.success("Comment added");
      setFormState(null);
      setBody("");
      invalidateComments();
    },
    onError: (error) => {
      toast.error(error?.response?.data?.detail || "Could not add comment");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ commentId, payload }) =>
      videoApi.updateComment(videoId, commentId, payload),
    onSuccess: () => {
      toast.success("Comment updated");
      setFormState(null);
      setBody("");
      invalidateComments();
    },
    onError: (error) => {
      toast.error(error?.response?.data?.detail || "Could not update comment");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (commentId) => videoApi.deleteComment(videoId, commentId),
    onSuccess: () => {
      toast.success("Comment deleted");
      invalidateComments();
    },
    onError: (error) => {
      toast.error(error?.response?.data?.detail || "Could not delete comment");
    },
  });

  const startComment = useCallback(
    (timestamp = currentTime, parent = null) => {
      onStartAddComment?.();
      const timestampSeconds = Number(parent?.timestamp_seconds ?? timestamp ?? 0);
      setFormState({
        mode: parent ? "reply" : "create",
        parentId: parent?.id || null,
        timestamp: timestampSeconds,
      });
      setBody("");
      setRubricElementId(parent?.rubric_element_id || "");
      setIsPrivate(false);
    },
    [currentTime, onStartAddComment]
  );

  const startEdit = (comment) => {
    setFormState({
      mode: "edit",
      commentId: comment.id,
      timestamp: Number(comment.timestamp_seconds || 0),
    });
    setBody(comment.body || "");
    setRubricElementId(comment.rubric_element_id || "");
    setIsPrivate(Boolean(comment.is_private));
  };

  useEffect(() => {
    const handleKeyDown = (event) => {
      const tagName = event.target?.tagName?.toLowerCase();
      if (
        event.key?.toLowerCase() !== "c" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        ["input", "select", "textarea"].includes(tagName) ||
        event.target?.isContentEditable
      ) {
        return;
      }
      event.preventDefault();
      startComment(currentTime);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentTime, startComment]);

  const seekAndHighlight = (comment) => {
    if (!comment) return;
    onSeekTo?.(Number(comment.timestamp_seconds || 0));
    setHighlightedCommentId(comment.id);
    window.setTimeout(() => {
      commentRefs.current[comment.id]?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 80);
  };

  const submitForm = (event) => {
    event.preventDefault();
    const trimmedBody = body.trim();
    if (!trimmedBody || !formState) return;
    const selectedElement = rubricOptions.find((option) => option.id === rubricElementId);
    if (formState.mode === "edit") {
      updateMutation.mutate({
        commentId: formState.commentId,
        payload: {
          body: trimmedBody,
          rubric_element_id: selectedElement?.id || null,
          rubric_element_code: selectedElement?.code || null,
          rubric_element_name: selectedElement?.name || null,
          is_private: isPrivate,
        },
      });
      return;
    }
    createMutation.mutate({
      timestamp_seconds: Number(formState.timestamp || 0),
      body: trimmedBody,
      rubric_element_id: selectedElement?.id || null,
      rubric_element_code: selectedElement?.code || null,
      rubric_element_name: selectedElement?.name || null,
      is_private: isPrivate,
      thread_parent_id: formState.parentId || null,
    });
  };

  const threadedComments = useMemo(() => {
    const byId = new Map(comments.map((comment) => [comment.id, comment]));
    const repliesByParent = {};
    const roots = [];
    comments.forEach((comment) => {
      if (comment.thread_parent_id && byId.has(comment.thread_parent_id)) {
        if (!repliesByParent[comment.thread_parent_id]) {
          repliesByParent[comment.thread_parent_id] = [];
        }
        repliesByParent[comment.thread_parent_id].push(comment);
      } else {
        roots.push(comment);
      }
    });
    return roots.map((comment) => ({
      ...comment,
      replies: repliesByParent[comment.id] || [],
    }));
  }, [comments]);

  const markerRail = (
    <div className="relative h-8">
      <div className="absolute left-0 right-0 top-3 h-1 rounded-full bg-slate-200" />
      {comments.map((comment) => {
        const elementMeta = rubricById[comment.rubric_element_id];
        const left = duration > 0
          ? Math.min(100, Math.max(0, (Number(comment.timestamp_seconds || 0) / duration) * 100))
          : 0;
        return (
          <button
            key={comment.id}
            type="button"
            onClick={() => seekAndHighlight(comment)}
            className="absolute top-1 h-5 w-5 -translate-x-1/2 rounded-full border-2 border-white shadow-sm transition-transform hover:scale-125 focus:outline-none focus:ring-2 focus:ring-primary"
            style={{
              left: `${left}%`,
              backgroundColor: elementMeta?.color || "#64748b",
            }}
            title={`${formatClock(comment.timestamp_seconds)} ${comment.rubric_element_name || "Comment"}`}
            aria-label={`Seek to comment at ${formatClock(comment.timestamp_seconds)}`}
          />
        );
      })}
    </div>
  );

  const renderComment = (comment, isReply = false) => {
    const elementMeta = rubricById[comment.rubric_element_id];
    const isHighlighted = highlightedCommentId === comment.id;
    const editable = canEditComment(comment, user);
    const deletable = comment.author_id === user?.id || ["admin", "principal", "super_admin"].includes(user?.role);
    return (
      <li
        key={comment.id}
        ref={(node) => {
          if (node) commentRefs.current[comment.id] = node;
        }}
        className={`${isReply ? "ml-8" : ""} rounded-md border px-3 py-3 transition-colors ${
          isHighlighted ? "border-primary bg-blue-50" : "border-slate-200 bg-white"
        }`}
      >
        <button
          type="button"
          onClick={() => seekAndHighlight(comment)}
          className="block w-full text-left"
        >
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1 font-semibold text-slate-800">
              <Clock3 className="h-3 w-3" />
              {formatClock(comment.timestamp_seconds)}
            </span>
            {comment.rubric_element_id ? (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                style={{ backgroundColor: elementMeta?.color || "#64748b" }}
                title={elementMeta?.domainName}
              >
                {comment.rubric_element_name || comment.rubric_element_code || comment.rubric_element_id}
              </span>
            ) : (
              <Badge variant="neutral">General</Badge>
            )}
            {comment.is_private ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                <Lock className="h-3 w-3" />
                Private
              </span>
            ) : null}
            <span>{comment.author_name}</span>
            <span>{formatTimeAgo(comment.created_at)}</span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
            {comment.body}
          </p>
        </button>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {!isReply ? (
            <Button size="sm" variant="ghost" onClick={() => startComment(comment.timestamp_seconds, comment)}>
              <Reply className="h-3.5 w-3.5" />
              Reply
            </Button>
          ) : null}
          {editable ? (
            <Button size="sm" variant="ghost" onClick={() => startEdit(comment)}>
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
          ) : null}
          {deletable ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate(comment.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          ) : null}
        </div>
      </li>
    );
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <MessageCircle className="h-4 w-4" />
            Timestamped comments
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            {comments.length ? `${comments.length} comment${comments.length === 1 ? "" : "s"}` : "No comments yet"}
          </p>
        </div>
        <Button size="sm" onClick={() => startComment(currentTime)}>
          <MessageCircle className="h-3.5 w-3.5" />
          Add comment at {formatClock(currentTime)}
        </Button>
      </div>

      <div className="mt-3">{markerRail}</div>

      {formState ? (
        <form onSubmit={submitForm} className="mt-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold text-slate-900">
              {formState.mode === "edit"
                ? "Edit comment"
                : formState.mode === "reply"
                  ? `Reply at ${formatClock(formState.timestamp)}`
                  : `Comment at ${formatClock(formState.timestamp)}`}
            </div>
            <Button size="sm" variant="ghost" onClick={() => setFormState(null)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <Field label="Comment text" className="mb-2">
            <Textarea
              rows={3}
              size="sm"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              required
            />
          </Field>
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <Field label="Rubric element">
              <Select
                size="sm"
                value={rubricElementId}
                onChange={(event) => setRubricElementId(event.target.value)}
              >
                <option value="">No rubric element</option>
                {rubricOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </Select>
            </Field>
            <label className="mt-5 flex items-center gap-2 text-xs font-medium text-slate-700">
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(event) => setIsPrivate(event.target.checked)}
              />
              Private
            </label>
          </div>
          <div className="mt-3 flex justify-end">
            <Button
              size="sm"
              type="submit"
              disabled={!body.trim() || createMutation.isPending || updateMutation.isPending}
            >
              <Send className="h-3.5 w-3.5" />
              {formState.mode === "edit" ? "Save comment" : "Post comment"}
            </Button>
          </div>
        </form>
      ) : null}

      <div className="mt-4">
        {isLoading ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-slate-500">
            Loading comments...
          </div>
        ) : threadedComments.length ? (
          <ul className="space-y-2">
            {threadedComments.map((comment) => (
              <React.Fragment key={comment.id}>
                {renderComment(comment)}
                {comment.replies.map((reply) => renderComment(reply, true))}
              </React.Fragment>
            ))}
          </ul>
        ) : (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-slate-500">
            Press C or use the button above to comment on this moment.
          </div>
        )}
      </div>
    </section>
  );
}

export default VideoCommentThread;
