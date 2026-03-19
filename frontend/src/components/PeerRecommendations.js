import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { teacherApi } from "@/lib/api";
import { useTranslation } from "react-i18next";

/**
 * PeerRecommendations - Shows recommended peer mentors based on areas of growth
 * @param {string} teacherId - The current teacher's ID
 */
export function PeerRecommendations({ teacherId }) {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.dir() === "rtl";
  const { data, isLoading } = useQuery({
    queryKey: ["peer-recommendations", teacherId],
    queryFn: () =>
      teacherApi.getPeerRecommendations
        ? teacherApi.getPeerRecommendations(teacherId).then((r) => r.data)
        : Promise.resolve({ recommendations: [] }),
    enabled: !!teacherId,
  });

  const recommendations = data?.recommendations ?? [];

  if (isLoading) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-5">
        <h2 className="mb-2 text-sm font-semibold text-slate-200">
          {t("peerRecommendations.title")}
        </h2>
        <div className="text-xs text-slate-500">{t("peerRecommendations.loading")}</div>
      </div>
    );
  }

  if (recommendations.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-5">
        <h2 className="mb-2 text-sm font-semibold text-slate-200">
          {t("peerRecommendations.title")}
        </h2>
        <p className="text-xs text-slate-400">
          {t("peerRecommendations.empty")}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-5">
      <h2 className="mb-2 text-sm font-semibold text-slate-200">
        {t("peerRecommendations.title")}
      </h2>
      <p className="mb-3 text-xs text-slate-400">
        {t("peerRecommendations.description")}
      </p>
      <div className="space-y-2">
        {recommendations.map((rec) => (
          <div
            key={rec.peer_id}
            className="rounded-lg border border-slate-800 bg-slate-900/60 p-3"
          >
            <div className="mb-2 flex items-start justify-between">
              <div>
                <Link
                  to={`/teachers/${rec.peer_id}`}
                  className="text-xs font-medium text-slate-100 hover:underline"
                >
                  {rec.peer_name}
                </Link>
                <div className="text-[11px] text-slate-400">
                  {rec.subject} • {rec.grade_level}
                </div>
              </div>
              {rec.match_score && (
                <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                  {t("peerRecommendations.match", { percent: Math.round(rec.match_score * 100) })}
                </span>
              )}
            </div>
            <div className="mb-2">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">
                {t("peerRecommendations.strongIn")}
              </div>
              <div className="flex flex-wrap gap-1">
                {rec.strengths?.slice(0, 3).map((strength) => (
                  <span
                    key={strength.element_id}
                    className="inline-flex items-center rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300"
                  >
                    {strength.element_id.toUpperCase()}
                    <span className={`${isRtl ? "mr-1" : "ml-1"} text-emerald-400`}>
                      {strength.score.toFixed(1)}
                    </span>
                  </span>
                ))}
              </div>
            </div>
            {rec.reason && (
              <p className="text-[11px] text-slate-300">{rec.reason}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default PeerRecommendations;
