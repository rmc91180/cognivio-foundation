import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AuthPage } from "@/pages/AuthPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { TeachersPage } from "@/pages/TeachersPage";
import { VideosPage } from "@/pages/VideosPage";
import { TeacherProfilePage } from "@/pages/TeacherProfilePage";
import { MasterSchedulePage } from "@/pages/MasterSchedulePage";
import { VideoPlayerPage } from "@/pages/VideoPlayerPage";
import { FrameworksPage } from "@/pages/FrameworksPage";

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<AuthPage />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teachers"
          element={
            <ProtectedRoute>
              <TeachersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teachers/:teacherId"
          element={
            <ProtectedRoute>
              <TeacherProfilePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/videos"
          element={
            <ProtectedRoute>
              <VideosPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/videos/:videoId"
          element={
            <ProtectedRoute>
              <VideoPlayerPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/frameworks"
          element={
            <ProtectedRoute>
              <FrameworksPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/master-schedule"
          element={
            <ProtectedRoute>
              <MasterSchedulePage />
            </ProtectedRoute>
          }
        />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AuthProvider>
  );
}

export default App;

