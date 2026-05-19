import React, { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { LayoutShell } from "@/components/LayoutShell";

const normalizeBadges = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.badges)) return payload.badges;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

const badgeTitle = (badge) =>
  badge?.title || badge?.name || badge?.badge_name || badge?.type || "Badge";

const badgeDescription = (badge) =>
  badge?.description ||
  badge?.summary ||
  badge?.message ||
  "Recognition earned through observed professional growth.";

const badgeDate = (badge) =>
  badge?.earned_at ||
  badge?.earnedAt ||
  badge?.created_at ||
  badge?.createdAt ||
  badge?.awarded_at ||
  badge?.awardedAt;

const formatDate = (value) => {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return "";
  }
};

export function TeacherBadgesPage() {
  const [badges, setBadges] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const loadBadges = async () => {
      setStatus("loading");
      setError("");

      try {
        const response = await api.get("/api/recognition/my-badges");
        if (!active) return;

        setBadges(normalizeBadges(response?.data));
        setStatus("ready");
      } catch (err) {
        if (!active) return;

        setError(
          err?.response?.data?.detail ||
            err?.message ||
            "Badges are not available right now."
        );
        setBadges([]);
        setStatus("error");
      }
    };

    loadBadges();

    return () => {
      active = false;
    };
  }, []);

  const earnedCount = useMemo(() => badges.length, [badges]);

  return (
    <LayoutShell>
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Teacher growth
          </p>
          <h1 className="mt-1 text-3xl font-bold text-slate-900">My Recognition</h1>
          <p className="mt-2 max-w-2xl text-slate-600">
            Recognition you earn will appear here. When a lesson shows a strong coaching move, your school can celebrate it here.
          </p>
          <div className="mt-4 inline-flex rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700">
            {earnedCount} earned
          </div>
        </div>

        {status === "loading" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-slate-600">Loading badges…</p>
          </div>
        )}

        {status === "error" && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
            <h2 className="font-semibold text-amber-900">
              Badges could not be loaded
            </h2>
            <p className="mt-2 text-sm text-amber-800">{error}</p>
          </div>
        )}

        {status === "ready" && badges.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-2xl">
              🏅
            </div>
            <h2 className="text-lg font-semibold text-slate-900">
              Recognition you earn will appear here
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
              After a reviewed lesson highlights a strong coaching move, you’ll be able to return to it from this page.
            </p>
          </div>
        )}

        {status === "ready" && badges.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {badges.map((badge, index) => {
              const id = badge?.id || badge?._id || index;
              const date = badgeDate(badge);

              return (
                <article
                  key={id}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-2xl">
                    {badge?.icon || "🏅"}
                  </div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    {badgeTitle(badge)}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {badgeDescription(badge)}
                  </p>
                  {date && (
                    <p className="mt-4 text-xs font-medium uppercase tracking-wide text-slate-500">
                      Earned {formatDate(date)}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </LayoutShell>
  );
}

export default TeacherBadgesPage;
