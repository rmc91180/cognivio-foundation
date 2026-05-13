import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { authApi } from "@/lib/api";
import { clearPreviewSession } from "@/lib/previewMode";

const AuthContext = createContext(null);

function getErrorMessage(error, fallback) {
  const detail = error?.response?.data?.detail;

  if (typeof detail === "string" && detail.trim()) {
    return detail;
  }

  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0];

    if (typeof first === "string" && first.trim()) {
      return first;
    }

    if (first && typeof first.msg === "string" && first.msg.trim()) {
      return first.msg;
    }
  }

  return fallback;
}

function clearStoredAuth() {
  localStorage.removeItem("cognivio_token");
  clearPreviewSession();
}

export function AuthProvider({ children }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);

  const refreshUser = useCallback(async () => {
    const token = localStorage.getItem("cognivio_token");

    if (!token) {
      setUser(null);
      return null;
    }

    try {
      const res = await authApi.me();
      setUser(res.data);
      return res.data;
    } catch (error) {
      clearStoredAuth();
      setUser(null);
      throw error;
    }
  }, []);

  useEffect(() => {
    let active = true;

    const initialize = async () => {
      const token = localStorage.getItem("cognivio_token");

      if (!token) {
        if (active) {
          setUser(null);
          setInitializing(false);
        }
        return;
      }

      try {
        const nextUser = await refreshUser();
        if (active) {
          setUser(nextUser);
        }
      } catch {
        if (active) {
          setUser(null);
        }
      } finally {
        if (active) {
          setInitializing(false);
        }
      }
    };

    initialize();

    return () => {
      active = false;
    };
  }, [refreshUser]);

  const loginMutation = useMutation({
    mutationFn: authApi.login,
    onSuccess: (res) => {
      clearPreviewSession();
      localStorage.setItem("cognivio_token", res.data.token);
      setUser(res.data.user);
      queryClient.clear();
      toast.success(t("auth.loggedInSuccessfully"));
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, t("auth.loginFailed")));
    },
  });

  const registerMutation = useMutation({
    mutationFn: authApi.register,
    onSuccess: (res) => {
      clearPreviewSession();
      localStorage.setItem("cognivio_token", res.data.token);
      setUser(res.data.user);
      queryClient.clear();
      toast.success(t("auth.accountCreated"));
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, t("auth.registrationFailed")));
    },
  });

  const requestAccessMutation = useMutation({
    mutationFn: authApi.requestAccess,
    onSuccess: (res) => {
      toast.success(res?.data?.message || t("auth.requestAccessSubmitted"));
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, t("auth.requestAccessFailed")));
    },
  });

  const requestPasswordResetMutation = useMutation({
    mutationFn: authApi.requestPasswordReset,
    onSuccess: (res) => {
      toast.success(res?.data?.message || t("auth.passwordResetRequestSubmitted"));
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, t("auth.passwordResetRequestFailed")));
    },
  });

  const confirmPasswordResetMutation = useMutation({
    mutationFn: authApi.confirmPasswordReset,
    onSuccess: (res) => {
      toast.success(res?.data?.message || t("auth.passwordResetConfirmSuccess"));
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, t("auth.passwordResetConfirmFailed")));
    },
  });

  const logout = useCallback(() => {
    clearStoredAuth();
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo(
    () => ({
      user,
      initializing,
      loading: initializing,
      isLoading: initializing,
      isAuthenticated: Boolean(user),
      login: (payload) => loginMutation.mutate(payload),
      loginAsync: (payload) => loginMutation.mutateAsync(payload),
      register: (payload) => registerMutation.mutate(payload),
      registerAsync: (payload) => registerMutation.mutateAsync(payload),
      requestAccess: (payload) => requestAccessMutation.mutate(payload),
      requestAccessAsync: (payload) => requestAccessMutation.mutateAsync(payload),
      requestPasswordReset: (payload) => requestPasswordResetMutation.mutate(payload),
      requestPasswordResetAsync: (payload) => requestPasswordResetMutation.mutateAsync(payload),
      confirmPasswordReset: (payload) => confirmPasswordResetMutation.mutate(payload),
      confirmPasswordResetAsync: (payload) => confirmPasswordResetMutation.mutateAsync(payload),
      loggingIn: loginMutation.isPending,
      registering: registerMutation.isPending,
      requestingAccess: requestAccessMutation.isPending,
      requestingPasswordReset: requestPasswordResetMutation.isPending,
      confirmingPasswordReset: confirmPasswordResetMutation.isPending,
      logout,
      refreshUser,
      setUserProfile: (nextUser) => setUser(nextUser),
    }),
    [
      user,
      initializing,
      loginMutation,
      registerMutation,
      requestAccessMutation,
      requestPasswordResetMutation,
      confirmPasswordResetMutation,
      logout,
      refreshUser,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);

  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return ctx;
}