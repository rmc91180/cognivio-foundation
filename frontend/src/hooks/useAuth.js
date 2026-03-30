import React, { createContext, useContext, useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { authApi } from "@/lib/api";

const AuthContext = createContext(null);

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
        localStorage.removeItem("cognivio_token");
        setUser(null);
        throw error;
      });

  useEffect(() => {
    const token = localStorage.getItem("cognivio_token");
    if (!token) {
      setInitializing(false);
      return;
    }
    refreshUser()
      .catch(() => {})
      .finally(() => setInitializing(false));
  }, []);

  const loginMutation = useMutation({
    mutationFn: authApi.login,
    onSuccess: (res) => {
      localStorage.setItem("cognivio_token", res.data.token);
      setUser(res.data.user);
      toast.success(t("auth.loggedInSuccessfully"));
      queryClient.clear();
    },
    onError: (error) => {
      toast.error(error?.response?.data?.detail || t("auth.loginFailed"));
    },
  });

  const registerMutation = useMutation({
    mutationFn: authApi.register,
    onSuccess: (res) => {
      localStorage.setItem("cognivio_token", res.data.token);
      setUser(res.data.user);
      toast.success(t("auth.accountCreated"));
      queryClient.clear();
    },
    onError: (error) => {
      toast.error(error?.response?.data?.detail || t("auth.registrationFailed"));
    },
  });

  const requestAccessMutation = useMutation({
    mutationFn: authApi.requestAccess,
    onSuccess: (res) => {
      toast.success(res?.data?.message || t("auth.requestAccessSubmitted"));
    },
    onError: (error) => {
      toast.error(error?.response?.data?.detail || t("auth.requestAccessFailed"));
    },
  });

  const logout = () => {
    localStorage.removeItem("cognivio_token");
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
    loggingIn: loginMutation.isPending,
    registering: registerMutation.isPending,
    requestingAccess: requestAccessMutation.isPending,
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

