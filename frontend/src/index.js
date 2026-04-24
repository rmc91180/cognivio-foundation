import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import "./index.css";
import "./i18n";
import App from "./App";
import { runtimeConfig } from "@/lib/runtimeConfig";
import logger from "@/lib/logger";

const queryClient = new QueryClient();

const backendUrl = runtimeConfig.backendUrl;

if (!backendUrl) {
  // Fail fast with a clear message if backend URL is missing during development.
  if (process.env.NODE_ENV !== "production") {
    logger.error("REACT_APP_BACKEND_URL is not set in .env");
  }
}

const root = ReactDOM.createRoot(document.getElementById("root"));

root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <Toaster
          richColors
          position="top-right"
          toastOptions={{
            className: "font-body",
            style: { borderRadius: 12 },
          }}
        />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {
      logger.warn("Service worker registration failed");
    });
  });
}

