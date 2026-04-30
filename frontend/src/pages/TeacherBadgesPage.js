import React, { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Award, Copy, ExternalLink, Image as ImageIcon, PlayCircle, Share2 } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { LayoutShell } from "@/components/LayoutShell";
import { Button, ErrorState, LoadingState, PageContextHeader, Panel, SectionHeader } from "@/components/ui";
import api from "@/lib/apiClient";

function getBadges(payload) {
  if (Array.isArray(payload)) return payload;
  return payload?.badges || payload?.items || [];
}

function formatDate(value) {
  if (!value) return "Recently";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(parsed));
}

function badgeTitle(badge) {
  return String(badge.badge_type || badge.recognition_type || "Recognized lesson")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeBadge(badge) {
  return {
    ...badge,
    title: badge.title || badgeTitle(badge),
    imageUrl: badge.badge_url || badge.share_card_url || badge.share_url || "",
    lessonUrl: badge.lesson_url || (badge.video_id ? `/videos/${badge.video_id}` : ""),
    shareUrl: badge.share_url || badge.share_card_url || badge.badge_url || "",
    awardedFor: badge.awarded_for || "A lesson where your classroom practice stood out.",
  };
}

export function TeacherBadgesPage() {
  const [preview, setPreview] = useState(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["recognition-my-badges"],
    queryFn: () => api.get("/api/recognition/my-badges").then((res) => res.data),
  });

  const badges = useMemo(
    () => getBadges(data).map(normalizeBadge).sort((a, b) => Date.parse(b.awarded_at || 0) - Date.parse(a.awarded_at || 0)),
    [data]
  );

  const shareMutation = useMutation({
    mutationFn: (badgeId) => api.get(`/api/recognition/my-badges/${badgeId}/share-card`).then((res) => res.data),
    onSuccess: async (payload) => {
      const shareUrl = payload?.share_url || payload?.share_card_url || payload?.badge?.share_url;
      setPreview({
        imageUrl: payload?.share_card_url || payload?.badge?.share_card_url || payload?.badge?.badge_url,
        shareUrl,
      });
      if (shareUrl) {
        await navigator.clipboard.writeText(shareUrl);
        toast.success("Link copied!");
      }
    },
    onError: () => toast.error("Could not create a share link yet."),
  });

  const copyExistingLink = async (badge) => {
    const shareUrl = badge.shareUrl || badge.lessonUrl;
    if (!shareUrl) {
      shareMutation.mutate(badge.id);
      return;
    }
    const absoluteUrl =
      shareUrl.startsWith("http") || typeof window === "undefined"
        ? shareUrl
        : `${window.location.origin}${shareUrl}`;
    await navigator.clipboard.writeText(absoluteUrl);
    toast.success("Link copied!");
  };

  if (isLoading) {
    return (
      <LayoutShell>
        <div className="mx-auto max-w-6xl px-6 py-6">
          <LoadingState message="Gathering your earned recognition." />
        </div>
      </LayoutShell>
    );
  }

  if (isError) {
    return (
      <LayoutShell>
        <div className="mx-auto max-w-6xl px-6 py-6">
          <ErrorState title="Could not load badges" message="Please refresh and try again." />
        </div>
      </LayoutShell>
    );
  }

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        <PageContextHeader
          breadcrumbs={[{ label: "My Workspace", to: "/my-workspace" }, { label: "My Recognition" }]}
          title="My Recognition"
          description="Badges you have earned from reviewed lessons."
          meta="Teacher recognition"
        />

        {preview?.imageUrl ? (
          <Panel className="border border-slate-200 bg-white p-5">
            <SectionHeader title="Share card preview" description="This is the image attached to the copied share link." />
            <div className="mt-4 overflow-hidden rounded-md border border-slate-200 bg-slate-50">
              <img src={preview.imageUrl} alt="Recognition share card preview" className="w-full object-cover" />
            </div>
          </Panel>
        ) : null}

        {badges.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {badges.map((badge) => (
              <Panel key={badge.id} className="flex h-full flex-col border border-slate-200 bg-white p-5">
                <div className="flex items-start gap-3">
                  {badge.imageUrl ? (
                    <img
                      src={badge.imageUrl}
                      alt=""
                      className="h-16 w-16 rounded-md border border-slate-200 bg-white object-cover"
                    />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-md border border-amber-200 bg-amber-50 text-amber-600">
                      <Award className="h-7 w-7" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-slate-900">{badge.title}</h2>
                    <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                      Earned {formatDate(badge.awarded_at)}
                    </p>
                  </div>
                </div>
                <p className="mt-4 flex-1 text-sm leading-6 text-slate-600">{badge.awardedFor}</p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {badge.lessonUrl ? (
                    <Link
                      to={badge.lessonUrl}
                      className="cv-btn cv-btn-secondary inline-flex items-center gap-2 px-2.5 py-1.5 text-xs"
                    >
                      <PlayCircle className="h-4 w-4" />
                      Lesson
                    </Link>
                  ) : null}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => shareMutation.mutate(badge.id)}
                    disabled={shareMutation.isPending}
                  >
                    <Share2 className="h-4 w-4" />
                    Share
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => copyExistingLink(badge)}>
                    <Copy className="h-4 w-4" />
                    Copy link
                  </Button>
                </div>
              </Panel>
            ))}
          </div>
        ) : (
          <Panel className="border border-dashed border-slate-200 bg-white p-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500">
              <ImageIcon className="h-5 w-5" />
            </div>
            <h2 className="mt-4 text-base font-semibold text-slate-900">Complete more observations to earn recognition</h2>
            <p className="mt-2 text-sm text-slate-500">Badges will appear here after a reviewed lesson earns recognition.</p>
            <Link to="/videos" className="cv-btn cv-btn-secondary mt-5 inline-flex items-center gap-2 px-3 py-2 text-sm">
              <ExternalLink className="h-4 w-4" />
              Open lessons
            </Link>
          </Panel>
        )}
      </div>
    </LayoutShell>
  );
}
