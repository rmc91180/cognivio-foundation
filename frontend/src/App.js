import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useAuth } from "@/hooks/useAuth";
import { AuthPage } from "@/pages/AuthPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { MasterAdminPage } from "@/pages/MasterAdminPage";
import { MasterAdminUsersPage } from "@/pages/MasterAdminUsersPage";
import { MasterAdminUserDetailPage } from "@/pages/MasterAdminUserDetailPage";
import { TeachersPage } from "@/pages/TeachersPage";
import { VideosPage } from "@/pages/VideosPage";
import { AccessManagementPage } from "@/pages/AccessManagementPage";
import { TeacherProfilePage } from "@/pages/TeacherProfilePage";
import { TeacherLatestLessonPage } from "@/pages/TeacherLatestLessonPage";
import { TeacherHistoryPage } from "@/pages/TeacherHistoryPage";
import { CoachingHubPage } from "@/pages/CoachingHubPage";
import { MasterSchedulePage } from "@/pages/MasterSchedulePage";
import { VideoPlayerPage } from "@/pages/VideoPlayerPage";
import { FrameworksPage } from "@/pages/FrameworksPage";
import { PrivacyReviewQueuePage } from "@/pages/PrivacyReviewQueuePage";
import { RecognitionReviewPage } from "@/pages/RecognitionReviewPage";
import { ExemplarLibraryPage } from "@/pages/ExemplarLibraryPage";
import { OpsMetricsPage } from "@/pages/OpsMetricsPage";
import { TeacherWorkspacePage } from "@/pages/TeacherWorkspacePage";
import { ActionPlanRecordPage } from "@/pages/ActionPlanRecordPage";
import { ReflectionRecordPage } from "@/pages/ReflectionRecordPage";
import { getDefaultHomeRoute } from "@/lib/userRoutes";

function HomeRedirect() {
  const { user, initializing } = useAuth();

  if (initializing) {
    return null;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Navigate to={getDefaultHomeRoute(user)} replace />;
}

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<AuthPage />} />
        <Route
          path="/master-admin"
          element={
            <ProtectedRoute superAdminOnly>
              <MasterAdminPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/master-admin/users"
          element={
            <ProtectedRoute superAdminOnly>
              <MasterAdminUsersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/master-admin/users/:userId"
          element={
            <ProtectedRoute superAdminOnly>
              <MasterAdminUserDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute adminOnly>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teachers"
          element={
            <ProtectedRoute adminOnly>
              <TeachersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teachers/:teacherId"
          element={
            <ProtectedRoute adminOnly>
              <TeacherProfilePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teachers/:teacherId/latest-lesson"
          element={
            <ProtectedRoute adminOnly>
              <TeacherLatestLessonPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teachers/:teacherId/coaching"
          element={
            <ProtectedRoute adminOnly>
              <CoachingHubPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teachers/:teacherId/history"
          element={
            <ProtectedRoute adminOnly>
              <TeacherHistoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teachers/:teacherId/action-plan"
          element={
            <ProtectedRoute adminOnly>
              <ActionPlanRecordPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teachers/:teacherId/reflections"
          element={
            <ProtectedRoute adminOnly>
              <ReflectionRecordPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/my-workspace"
          element={
            <ProtectedRoute>
              <TeacherWorkspacePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/my-workspace/goals"
          element={
            <ProtectedRoute>
              <ActionPlanRecordPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/my-workspace/coaching"
          element={
            <ProtectedRoute>
              <CoachingHubPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/my-workspace/reflections"
          element={
            <ProtectedRoute>
              <ReflectionRecordPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/my-workspace/:section"
          element={
            <ProtectedRoute>
              <TeacherWorkspacePage />
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
          path="/access-management"
          element={
            <ProtectedRoute adminOnly>
              <AccessManagementPage />
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
            <ProtectedRoute adminOnly>
              <PrivacyReviewQueuePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/recognition-review"
          element={
            <ProtectedRoute adminOnly>
              <RecognitionReviewPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/ops/metrics"
          element={
            <ProtectedRoute adminOnly>
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
            <ProtectedRoute adminOnly>
              <FrameworksPage />
            </ProtectedRoute>
          }
        />
        <Route path="/frameworks" element={<HomeRedirect />} />
        <Route
          path="/master-schedule"
          element={
            <ProtectedRoute adminOnly>
              <MasterSchedulePage />
            </ProtectedRoute>
          }
        />
        <Route path="/" element={<HomeRedirect />} />
        <Route path="*" element={<HomeRedirect />} />
      </Routes>
    </AuthProvider>
  );
}

export default App;

