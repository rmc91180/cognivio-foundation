import React from "react";
import { Link, useLocation } from "react-router-dom";
import { getHomeRoute } from "@/lib/roleRouter";

export function RoleMismatchPage({ user, requiredRole, currentRole }) {
  const location = useLocation();

  const homeRoute = getHomeRoute(user);
  const attemptedPath = location?.pathname || "";

  const resolvedCurrentRole =
    currentRole ||
    user?.tenant_role ||
    user?.tenantRole ||
    user?.role ||
    "your current role";

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Cognivio Access
        </p>

        <h1 className="mt-2 text-3xl font-bold text-slate-900">
          This page is not available for your role
        </h1>

        <p className="mt-4 text-slate-600">
          You are signed in as{" "}
          <span className="font-semibold text-slate-900">
            {resolvedCurrentRole}
          </span>
          {requiredRole ? (
            <>
              , but this page requires{" "}
              <span className="font-semibold text-slate-900">
                {requiredRole}
              </span>
              .
            </>
          ) : (
            "."
          )}
        </p>

        {attemptedPath && (
          <p className="mt-3 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-700">
            Requested page: <span className="font-mono">{attemptedPath}</span>
          </p>
        )}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link
            to={homeRoute}
            className="rounded-xl bg-slate-900 px-5 py-2.5 text-center text-sm font-semibold text-white shadow-sm"
          >
            Go to my dashboard
          </Link>

          <Link
            to="/login"
            className="rounded-xl border border-slate-300 px-5 py-2.5 text-center text-sm font-semibold text-slate-700"
          >
            Switch account
          </Link>
        </div>

        <p className="mt-6 text-sm text-slate-500">
          If you believe you should have access, contact your school or workspace administrator.
        </p>
      </div>
    </div>
  );
}

export default RoleMismatchPage;