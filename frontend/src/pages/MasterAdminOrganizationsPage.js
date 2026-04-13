import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Panel,
} from "@/components/ui";
import {
  MasterAdminMetricCard,
  MasterAdminMetricGrid,
  MasterAdminPageScaffold,
} from "@/components/master-admin/MasterAdminPageScaffold";
import { masterAdminApi } from "@/lib/api";

function capacityVariant(value) {
  if (value === "at_limit") return "danger";
  if (value === "near_limit") return "warning";
  if (value === "available") return "success";
  return "neutral";
}

export function MasterAdminOrganizationsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [editingOrg, setEditingOrg] = useState(null);
  const [seatLimitInput, setSeatLimitInput] = useState("");
  const [reason, setReason] = useState("");

  const filters = useMemo(
    () => ({
      q: searchParams.get("q") || undefined,
      organization_type: searchParams.get("organization_type") || undefined,
      capacity_state: searchParams.get("capacity_state") || undefined,
    }),
    [searchParams]
  );

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["master-admin-organizations", filters],
    queryFn: () => masterAdminApi.organizations(filters).then((res) => res.data),
  });

  const setFilter = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next);
  };

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    setFilter("q", query.trim() || "");
  };

  const closeDialog = () => {
    setEditingOrg(null);
    setSeatLimitInput("");
    setReason("");
  };

  const seatPolicyMutation = useMutation({
    mutationFn: ({ organizationId, payload }) =>
      masterAdminApi.updateOrganizationSeatPolicy(organizationId, payload),
    onSuccess: () => {
      toast.success(t("masterAdminOrganizations.updateSuccess"));
      queryClient.invalidateQueries({ queryKey: ["master-admin-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["master-admin-overview"] });
      closeDialog();
    },
    onError: (error) => {
      toast.error(error?.response?.data?.detail || t("masterAdminOrganizations.updateFailed"));
    },
  });

  const openSeatDialog = (organization) => {
    setEditingOrg(organization);
    setSeatLimitInput(organization?.seat_limit ? String(organization.seat_limit) : "");
    setReason("");
  };

  const submitSeatPolicy = () => {
    if (!editingOrg) return;
    const payload = {
      seat_limit: seatLimitInput.trim() ? Number(seatLimitInput.trim()) : null,
      reason: reason.trim() || undefined,
    };
    seatPolicyMutation.mutate({ organizationId: editingOrg.id, payload });
  };

  return (
    <>
      <MasterAdminPageScaffold
        title={t("masterAdminOrganizations.title")}
        description={t("masterAdminOrganizations.description")}
        meta={t("masterAdminOrganizations.meta")}
        actions={
          <Button type="button" variant="secondary" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? t("masterAdminOrganizations.refreshing") : t("masterAdminOrganizations.refresh")}
          </Button>
        }
        railNote={t("masterAdminOrganizations.railNote")}
      >
        <Panel className="space-y-4">
          <form className="grid gap-4 lg:grid-cols-[1.5fr,0.8fr,0.8fr,auto]" onSubmit={handleSearchSubmit}>
            <Field label={t("masterAdminOrganizations.searchLabel")}>
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("masterAdminOrganizations.searchPlaceholder")}
              />
            </Field>
            <Field label={t("masterAdminOrganizations.typeLabel")}>
              <select
                value={filters.organization_type || ""}
                onChange={(event) => setFilter("organization_type", event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              >
                <option value="">{t("masterAdminOrganizations.allTypes")}</option>
                <option value="school">{t("masterAdminOrganizations.types.school")}</option>
                <option value="training">{t("masterAdminOrganizations.types.training")}</option>
              </select>
            </Field>
            <Field label={t("masterAdminOrganizations.capacityLabel")}>
              <select
                value={filters.capacity_state || ""}
                onChange={(event) => setFilter("capacity_state", event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              >
                <option value="">{t("masterAdminOrganizations.allCapacityStates")}</option>
                <option value="unlimited">{t("masterAdminOrganizations.capacityStates.unlimited")}</option>
                <option value="available">{t("masterAdminOrganizations.capacityStates.available")}</option>
                <option value="near_limit">{t("masterAdminOrganizations.capacityStates.near_limit")}</option>
                <option value="at_limit">{t("masterAdminOrganizations.capacityStates.at_limit")}</option>
              </select>
            </Field>
            <div className="flex items-end">
              <Button type="submit">{t("masterAdminOrganizations.applyFilters")}</Button>
            </div>
          </form>

          <MasterAdminMetricGrid className="xl:grid-cols-5">
            <MasterAdminMetricCard label={t("masterAdminOrganizations.total")} value={data?.total ?? 0} />
            <MasterAdminMetricCard label={t("masterAdminOrganizations.schoolCount")} value={data?.summary?.school ?? 0} />
            <MasterAdminMetricCard label={t("masterAdminOrganizations.trainingCount")} value={data?.summary?.training ?? 0} />
            <MasterAdminMetricCard label={t("masterAdminOrganizations.capped")} value={data?.summary?.capped ?? 0} tone="warning" />
            <MasterAdminMetricCard label={t("masterAdminOrganizations.atLimit")} value={data?.summary?.at_limit ?? 0} tone="danger" />
          </MasterAdminMetricGrid>
        </Panel>

        {isLoading ? <LoadingState message={t("masterAdminOrganizations.loading")} /> : null}
        {isError ? (
          <ErrorState
            title={t("masterAdminOrganizations.loadFailedTitle")}
            message={t("masterAdminOrganizations.loadFailedMessage")}
          />
        ) : null}

        {!isLoading && !isError ? (
          <Panel className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{t("masterAdminOrganizations.tableTitle")}</h2>
              <p className="text-sm text-slate-500">{t("masterAdminOrganizations.tableDescription")}</p>
            </div>
            {(data?.items || []).length ? (
              <div className="space-y-3">
                {data.items.map((organization) => (
                  <div key={organization.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-base font-semibold text-slate-900">{organization.name}</div>
                        <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                          {t("masterAdminOrganizations.identifier")}: {organization.id}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="neutral">{t(`masterAdminOrganizations.types.${organization.organization_type}`)}</Badge>
                        <Badge variant={capacityVariant(organization.capacity_state)}>
                          {t(`masterAdminOrganizations.capacityStates.${organization.capacity_state}`)}
                        </Badge>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                      <div className="rounded-xl bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          {t("masterAdminOrganizations.activeUsers")}
                        </div>
                        <div className="mt-1 text-sm text-slate-700">{organization.active_user_count}</div>
                      </div>
                      <div className="rounded-xl bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          {t("masterAdminOrganizations.pendingUsers")}
                        </div>
                        <div className="mt-1 text-sm text-slate-700">{organization.pending_user_count}</div>
                      </div>
                      <div className="rounded-xl bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          {t("masterAdminOrganizations.activeTeachers")}
                        </div>
                        <div className="mt-1 text-sm text-slate-700">{organization.active_teacher_count}</div>
                      </div>
                      <div className="rounded-xl bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          {t("masterAdminOrganizations.activeAdmins")}
                        </div>
                        <div className="mt-1 text-sm text-slate-700">{organization.active_admin_count}</div>
                      </div>
                      <div className="rounded-xl bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          {t("masterAdminOrganizations.schoolCountCard")}
                        </div>
                        <div className="mt-1 text-sm text-slate-700">{organization.school_count}</div>
                      </div>
                      <div className="rounded-xl bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          {t("masterAdminOrganizations.seatLimit")}
                        </div>
                        <div className="mt-1 text-sm text-slate-700">
                          {organization.seat_limit || t("masterAdminOrganizations.unlimited")}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <div className="text-sm text-slate-600">
                        {organization.seat_limit
                          ? t("masterAdminOrganizations.seatStatus", {
                              remaining: organization.seats_remaining ?? 0,
                              limit: organization.seat_limit,
                            })
                          : t("masterAdminOrganizations.unlimitedStatus")}
                      </div>
                      <div className="flex flex-wrap gap-3">
                        <Link
                          to={`/master-admin/users?organization_id=${organization.id}`}
                          className="text-sm font-medium text-primary hover:text-primary/80"
                        >
                          {t("masterAdminOrganizations.openMembers")}
                        </Link>
                        <Button type="button" variant="secondary" onClick={() => openSeatDialog(organization)}>
                          {t("masterAdminOrganizations.editSeats")}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title={t("masterAdminOrganizations.emptyTitle")}
                message={t("masterAdminOrganizations.emptyMessage")}
              />
            )}
          </Panel>
        ) : null}
      </MasterAdminPageScaffold>

      <Dialog open={Boolean(editingOrg)} onOpenChange={(open) => (!open ? closeDialog() : null)}>
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{t("masterAdminOrganizations.dialogTitle")}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {editingOrg
                ? t("masterAdminOrganizations.dialogDescription", { name: editingOrg.name })
                : ""}
            </p>
          </div>
          <Field label={t("masterAdminOrganizations.seatLimitInputLabel")}>
            <Input
              type="number"
              min="1"
              value={seatLimitInput}
              onChange={(event) => setSeatLimitInput(event.target.value)}
              placeholder={t("masterAdminOrganizations.seatLimitPlaceholder")}
            />
          </Field>
          <p className="text-xs text-slate-500">{t("masterAdminOrganizations.seatLimitHint")}</p>
          <Field label={t("masterAdminUserDetail.reasonLabel")}>
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t("masterAdminOrganizations.reasonPlaceholder")}
            />
          </Field>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={closeDialog}>
              {t("masterAdminUserDetail.cancel")}
            </Button>
            <Button type="button" onClick={submitSeatPolicy} disabled={seatPolicyMutation.isPending}>
              {seatPolicyMutation.isPending ? t("masterAdminUserDetail.saving") : t("masterAdminOrganizations.saveSeats")}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
