import React, { createContext, useContext, useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { authApi } from "@/lib/api";
import { setUnauthorizedHandler } from "@/lib/apiClient";
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

export function AuthProvider({ children }) {
  const { t } = useTranslation();
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);
  const queryClient = useQueryClient();

  const refreshUser = () =>
    authApi
      .me()
      .then((res) => {
        setUser(res.data);
        return res.data;
      })
      .catch((error) => {
        setUser(null);
        throw error;
      });

  useEffect(() => {
    refreshUser()
      .catch(() => {})
      .finally(() => setInitializing(false));
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearPreviewSession();
      setUser(null);
      queryClient.clear();
      if (window.location.pathname !== "/login") {
        window.location.assign("/login");
      }
    });
    return () => setUnauthorizedHandler(null);
  }, [queryClient]);

  const loginMutation = useMutation({
    mutationFn: authApi.login,
    onSuccess: (res) => {
      clearPreviewSession();
      setUser(res.data.user || null);
      toast.success(t("auth.loggedInSuccessfully"));
      queryClient.clear();
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, t("auth.loginFailed")));
    },
  });

  const registerMutation = useMutation({
    mutationFn: authApi.register,
    onSuccess: (res) => {
      clearPreviewSession();
      setUser(res.data.user || null);
      toast.success(t("auth.accountCreated"));
      queryClient.clear();
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

  const logout = async () => {
    try {
      await authApi.logout();
    } catch (error) {
      // ignore backend logout errors; clear local auth state regardless
    }
    clearPreviewSession();
    setUser(null);
    queryClient.clear();
  };

  const value = {
    user,
    initializing,
    login: (payload) => loginMutation.mutate(payload),
    register: (payload) => registerMutation.mutate(payload),
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
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}

