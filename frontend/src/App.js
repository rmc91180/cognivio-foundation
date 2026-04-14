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
import { MasterAdminOrganizationsPage } from "@/pages/MasterAdminOrganizationsPage";
import { MasterAdminOrganizationDetailPage } from "@/pages/MasterAdminOrganizationDetailPage";
import { MasterAdminAuthActivityPage } from "@/pages/MasterAdminAuthActivityPage";
import { MasterAdminAuditPage } from "@/pages/MasterAdminAuditPage";
import { MasterAdminWorkspacesPage } from "@/pages/MasterAdminWorkspacesPage";
import { MasterAdminWorkspaceDetailPage } from "@/pages/MasterAdminWorkspaceDetailPage";
import { MasterAdminVideosPage } from "@/pages/MasterAdminVideosPage";
import { MasterAdminVideoDetailPage } from "@/pages/MasterAdminVideoDetailPage";
import { MasterAdminStoragePage } from "@/pages/MasterAdminStoragePage";
import { MasterAdminDependenciesPage } from "@/pages/MasterAdminDependenciesPage";
import { MasterAdminAIQualityPage } from "@/pages/MasterAdminAIQualityPage";
import { MasterAdminIncidentsPage } from "@/pages/MasterAdminIncidentsPage";
import { MasterAdminSupportPage } from "@/pages/MasterAdminSupportPage";
import { TeachersPage } from "@/pages/TeachersPage";
import { VideosPage } from "@/pages/VideosPage";
import { TeacherProfilePage } from "@/pages/TeacherProfilePage";
import { TeacherLatestLessonPage } from "@/pages/TeacherLatestLessonPage";
import { TeacherHistoryPage } from "@/pages/TeacherHistoryPage";
import { TeacherOperationsPage } from "@/pages/TeacherOperationsPage";
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
          path="/master-admin/organizations"
          element={
            <ProtectedRoute superAdminOnly>
              <MasterAdminOrganizationsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/master-admin/organizations/:organizationId"
          element={
            <ProtectedRoute superAdminOnly>
              <MasterAdminOrganizationDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/master-admin/workspaces"
          element={
            <ProtectedRoute superAdminOnly>
              <MasterAdminWorkspacesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/master-admin/workspaces/:ownerUserId"
          element={
            <ProtectedRoute superAdminOnly>
              <MasterAdminWorkspaceDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/master-admin/videos"
          element={
            <ProtectedRoute superAdminOnly>
              <MasterAdminVideosPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/master-admin/videos/:videoId"
          element={
            <ProtectedRoute superAdminOnly>
              <MasterAdminVideoDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/master-admin/storage"
          element={
            <ProtectedRoute superAdminOnly>
              <MasterAdminStoragePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/master-admin/dependencies"
          element={
            <ProtectedRoute superAdminOnly>
              <MasterAdminDependenciesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/master-admin/ai-quality"
          element={
            <ProtectedRoute superAdminOnly>
              <MasterAdminAIQualityPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/master-admin/incidents"
          element={
            <ProtectedRoute superAdminOnly>
              <MasterAdminIncidentsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/master-admin/support"
          element={
            <ProtectedRoute superAdminOnly>
              <MasterAdminSupportPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/master-admin/auth-activity"
          element={
            <ProtectedRoute superAdminOnly>
              <MasterAdminAuthActivityPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/master-admin/audit"
          element={
            <ProtectedRoute superAdminOnly>
              <MasterAdminAuditPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute allowedTenantRoles={["school_admin"]}>
              <DashboardPage forcedWorkspaceMode="school" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard/training"
          element={
            <ProtectedRoute allowedTenantRoles={["training_admin"]}>
              <DashboardPage forcedWorkspaceMode="training" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teachers"
          element={
            <ProtectedRoute allowedTenantRoles={["school_admin", "training_admin"]}>
              <TeachersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teachers/:teacherId"
          element={
            <ProtectedRoute allowedTenantRoles={["school_admin", "training_admin"]}>
              <TeacherProfilePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teachers/:teacherId/latest-lesson"
          element={
            <ProtectedRoute allowedTenantRoles={["school_admin", "training_admin"]}>
              <TeacherLatestLessonPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teachers/:teacherId/coaching"
          element={
            <ProtectedRoute allowedTenantRoles={["school_admin", "training_admin"]}>
              <CoachingHubPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teachers/:teacherId/history"
          element={
            <ProtectedRoute allowedTenantRoles={["school_admin", "training_admin"]}>
              <TeacherHistoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teachers/:teacherId/operations"
          element={
            <ProtectedRoute allowedTenantRoles={["super_admin"]}>
              <TeacherOperationsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teachers/:teacherId/action-plan"
          element={
            <ProtectedRoute allowedTenantRoles={["school_admin", "training_admin"]}>
              <ActionPlanRecordPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teachers/:teacherId/reflections"
          element={
            <ProtectedRoute allowedTenantRoles={["school_admin", "training_admin"]}>
              <ReflectionRecordPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/my-workspace"
          element={
            <ProtectedRoute allowedTenantRoles={["teacher"]}>
              <TeacherWorkspacePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/my-workspace/goals"
          element={
            <ProtectedRoute allowedTenantRoles={["teacher"]}>
              <ActionPlanRecordPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/my-workspace/coaching"
          element={
            <ProtectedRoute allowedTenantRoles={["teacher"]}>
              <CoachingHubPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/my-workspace/reflections"
          element={
            <ProtectedRoute allowedTenantRoles={["teacher"]}>
              <ReflectionRecordPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/my-workspace/:section"
          element={
            <ProtectedRoute allowedTenantRoles={["teacher"]}>
              <TeacherWorkspacePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/videos"
          element={
            <ProtectedRoute allowedTenantRoles={["teacher", "school_admin", "training_admin"]}>
              <VideosPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/videos/:videoId"
          element={
            <ProtectedRoute allowedTenantRoles={["teacher", "school_admin", "training_admin"]}>
              <VideoPlayerPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/privacy-review"
          element={
            <ProtectedRoute allowedTenantRoles={["school_admin"]}>
              <PrivacyReviewQueuePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/recognition-review"
          element={
            <ProtectedRoute allowedTenantRoles={["school_admin"]}>
              <RecognitionReviewPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/ops/metrics"
          element={
            <ProtectedRoute allowedTenantRoles={["school_admin"]}>
              <OpsMetricsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/all-star-library"
          element={
            <ProtectedRoute allowedTenantRoles={["teacher", "school_admin", "training_admin"]}>
              <ExemplarLibraryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/school-setup"
          element={
            <ProtectedRoute allowedTenantRoles={["school_admin"]}>
              <FrameworksPage />
            </ProtectedRoute>
          }
        />
        <Route path="/frameworks" element={<HomeRedirect />} />
        <Route
          path="/master-schedule"
          element={
            <ProtectedRoute allowedTenantRoles={["school_admin"]}>
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

