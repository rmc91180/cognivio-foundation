import React from "react";
import { useNavigate } from "react-router-dom";
import { LayoutShell } from "@/components/LayoutShell";
import { Button, Panel } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { getHomeRoute } from "@/lib/roleRouter";

export function RoleMismatchPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const homeRoute = getHomeRoute(user);

  const goHome = () => {
    navigate(homeRoute, { replace: true, state: null });
  };

  return (
    <LayoutShell>
      <div className="mx-auto flex min-h-[60vh] max-w-2xl items-center px-6 py-12">
        <Panel as="section" className="w-full border-slate-200 bg-white p-8 text-center">
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-slate-900">
            This page isn't available for your account type.
          </h1>
          <p className="mt-3 text-sm text-slate-500">
            You have been redirected to the experience that matches your account.
          </p>
          <div className="mt-6 flex justify-center">
            <Button type="button" onClick={goHome}>
              Go to my dashboard
            </Button>
          </div>
        </Panel>
      </div>
    </LayoutShell>
  );
}
