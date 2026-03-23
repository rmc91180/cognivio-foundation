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
import { PrivacyReviewQueuePage } from "@/pages/PrivacyReviewQueuePage";
import { RecognitionReviewPage } from "@/pages/RecognitionReviewPage";
import { ExemplarLibraryPage } from "@/pages/ExemplarLibraryPage";
import { OpsMetricsPage } from "@/pages/OpsMetricsPage";

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
          path="/privacy-review"
          element={
            <ProtectedRoute>
              <PrivacyReviewQueuePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/recognition-review"
          element={
            <ProtectedRoute>
              <RecognitionReviewPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/ops/metrics"
          element={
            <ProtectedRoute>
              <OpsMetricsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/all-star-library"
          element={
            <ProtectedRoute>
              <ExemplarLibraryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/school-setup"
          element={
            <ProtectedRoute>
              <FrameworksPage />
            </ProtectedRoute>
          }
        />
        <Route path="/frameworks" element={<Navigate to="/school-setup" replace />} />
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

