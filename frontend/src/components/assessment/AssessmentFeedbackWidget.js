import React, { useEffect, useMemo, useState } from "react";
import classNames from "classnames";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { assessmentApi } from "@/lib/api";
import { Button, Textarea } from "@/components/ui";

function feedbackLabel(t, value) {
  return value === "useful" ? t("feedback.useful") : t("feedback.needsWork");
}

export function AssessmentFeedbackWidget({
  assessmentId,
  targetType,
  targetId,
  surface,
  existingFeedback,
  metadata,
  compact = false,
  className,
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [selectedValue, setSelectedValue] = useState(existingFeedback?.feedback_value || "");
  const [rationale, setRationale] = useState(existingFeedback?.rationale || "");

  useEffect(() => {
    setSelectedValue(existingFeedback?.feedback_value || "");
    setRationale(existingFeedback?.rationale || "");
  }, [existingFeedback?.feedback_value, existingFeedback?.rationale, existingFeedback?.updated_at]);

  const trimmedRationale = rationale.trim();
  const noteChanged = useMemo(
    () => trimmedRationale !== (existingFeedback?.rationale || ""),
    [existingFeedback?.rationale, trimmedRationale]
  );

  const feedbackMutation = useMutation({
    mutationFn: (feedbackValue) =>
      assessmentApi.submitFeedback(assessmentId, {
        target_type: targetType,
        target_id: targetId,
        feedback_value: feedbackValue,
        rationale: trimmedRationale || null,
        source_surface: surface,
        metadata: metadata || {},
      }),
    onSuccess: () => {
      toast.success(t("feedback.saved"));
      queryClient.invalidateQueries({ queryKey: ["assessment-feedback", assessmentId] });
    },
    onError: () => {
      toast.error(t("feedback.saveFailed"));
    },
  });

  if (!assessmentId) return null;

  return (
    <div
      className={classNames(
        "rounded-md border border-slate-200 bg-white",
        compact ? "mt-2 px-3 py-3" : "mt-3 px-4 py-4",
        className
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {t("feedback.prompt")}
          </div>
          {selectedValue ? (
            <div className="mt-1 text-[11px] text-slate-500">
              {t("feedback.currentStatus", {
                value: feedbackLabel(t, selectedValue),
              })}
            </div>
          ) : (
            <div className="mt-1 text-[11px] text-slate-500">{t("feedback.helpText")}</div>
          )}
        </div>
        {feedbackMutation.isPending && (
          <span className="text-[10px] text-slate-400">{t("feedback.saving")}</span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={selectedValue === "useful" ? "success" : "secondary"}
          disabled={feedbackMutation.isPending}
          onClick={() => {
            setSelectedValue("useful");
            feedbackMutation.mutate("useful");
          }}
        >
          {t("feedback.useful")}
        </Button>
        <Button
          size="sm"
          variant={selectedValue === "not_useful" ? "danger" : "secondary"}
          disabled={feedbackMutation.isPending}
          onClick={() => {
            setSelectedValue("not_useful");
            feedbackMutation.mutate("not_useful");
          }}
        >
          {t("feedback.needsWork")}
        </Button>
      </div>

      <div className="mt-3">
        <Textarea
          rows={compact ? 2 : 3}
          size="sm"
          value={rationale}
          onChange={(event) => setRationale(event.target.value)}
          placeholder={t("feedback.notePlaceholder")}
        />
      </div>

      <div className="mt-2 flex justify-end">
        <Button
          size="sm"
          variant="ghost"
          disabled={!selectedValue || !noteChanged || feedbackMutation.isPending}
          onClick={() => feedbackMutation.mutate(selectedValue)}
        >
          {t("feedback.saveNote")}
        </Button>
      </div>
    </div>
  );
}
