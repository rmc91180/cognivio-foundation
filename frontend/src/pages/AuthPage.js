import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { BrandMark } from "@/components/BrandMark";

export function AuthPage() {
  const navigate = useNavigate();
  const { login, register, loggingIn, registering } = useAuth();
  const isDemo = process.env.REACT_APP_DEMO_MODE === "true";
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ email: "", password: "", name: "" });

  const onSubmit = (e) => {
    e.preventDefault();
    const payload =
      mode === "register"
        ? {
            email: form.email,
            password: form.password,
            name: form.name || form.email,
          }
        : {
            email: form.email,
            password: form.password,
          };

    const fn = mode === "register" ? register : login;

    fn(payload);
    navigate("/dashboard");
  };

  const busy = loggingIn || registering;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-md cv-panel p-8">
        <div className="mb-6 text-center">
          <div className="mb-2 inline-flex">
            <BrandMark compact />
          </div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-slate-900">
            Cognivio
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            AI-guided teacher development workspace
          </p>
        </div>

        <div className="mb-4 flex gap-2 rounded-xl bg-slate-100 p-1 text-xs">
          <button
            type="button"
            onClick={() => setMode("login")}
            className={`flex-1 rounded px-3 py-2 ${
              mode === "login"
                ? "bg-white text-slate-900 shadow-sm font-semibold"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Login
          </button>
          {!isDemo && (
            <button
              type="button"
              onClick={() => setMode("register")}
              className={`flex-1 rounded px-3 py-2 ${
                mode === "register"
                  ? "bg-white text-slate-900 shadow-sm font-semibold"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Register
            </button>
          )}
        </div>

        {isDemo && (
          <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            <div className="font-semibold text-slate-700">Demo logins</div>
            <div className="mt-1">
              Principal: principal@demo.cognivio.app / DemoAccess2026!
            </div>
            <div>Teacher: teacher@demo.cognivio.app / DemoAccess2026!</div>
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          {mode === "register" && !isDemo && (
            <div>
              <label className="block text-xs font-medium text-slate-600">
                Name
              </label>
              <input
                type="text"
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none ring-primary/35 focus:ring"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Email
            </label>
            <input
              type="email"
              required
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none ring-primary/35 focus:ring"
              value={form.email}
              onChange={(e) =>
                setForm((f) => ({ ...f, email: e.target.value }))
              }
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Password
            </label>
            <input
              type="password"
              required
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none ring-primary/35 focus:ring"
              value={form.password}
              onChange={(e) =>
                setForm((f) => ({ ...f, password: e.target.value }))
              }
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="mt-2 inline-flex w-full items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white shadow-brand hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy
              ? "Signing in..."
              : mode === "login"
              ? "Sign in"
              : "Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}

