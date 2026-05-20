import React, { Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { AuthPage } from "@/pages/AuthPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { SkeletonTable } from "@/components/ui";
import { getHomeRoute } from "@/lib/roleRouter";

const lazyPage = (loader, exportName) =>
  lazy(() => loader().then((mod) => ({ default: mod[exportName] })));

const MasterAdminPage = lazyPage(() => import("@/pages/MasterAdminPage"), "MasterAdminPage");
const MasterAdminUsersPage = lazyPage(() => import("@/pages/MasterAdminUsersPage"), "MasterAdminUsersPage");
const MasterAdminUserDetailPage = lazyPage(() => import("@/pages/MasterAdminUserDetailPage"), "MasterAdminUserDetailPage");
const MasterAdminOrganizationsPage = lazyPage(() => import("@/pages/MasterAdminOrganizationsPage"), "MasterAdminOrganizationsPage");
const MasterAdminOrganizationDetailPage = lazyPage(() => import("@/pages/MasterAdminOrganizationDetailPage"), "MasterAdminOrganizationDetailPage");
const MasterAdminAuthActivityPage = lazyPage(() => import("@/pages/MasterAdminAuthActivityPage"), "MasterAdminAuthActivityPage");
const MasterAdminAuditPage = lazyPage(() => import("@/pages/MasterAdminAuditPage"), "MasterAdminAuditPage");
const MasterAdminWorkspacesPage = lazyPage(() => import("@/pages/MasterAdminWorkspacesPage"), "MasterAdminWorkspacesPage");
const MasterAdminWorkspaceDetailPage = lazyPage(() => import("@/pages/MasterAdminWorkspaceDetailPage"), "MasterAdminWorkspaceDetailPage");
const MasterAdminVideosPage = lazyPage(() => import("@/pages/MasterAdminVideosPage"), "MasterAdminVideosPage");
const MasterAdminVideoDetailPage = lazyPage(() => import("@/pages/MasterAdminVideoDetailPage"), "MasterAdminVideoDetailPage");
const MasterAdminStoragePage = lazyPage(() => import("@/pages/MasterAdminStoragePage"), "MasterAdminStoragePage");
const MasterAdminDependenciesPage = lazyPage(() => import("@/pages/MasterAdminDependenciesPage"), "MasterAdminDependenciesPage");
const MasterAdminAIQualityPage = lazyPage(() => import("@/pages/MasterAdminAIQualityPage"), "MasterAdminAIQualityPage");
const MasterAdminIncidentsPage = lazyPage(() => import("@/pages/MasterAdminIncidentsPage"), "MasterAdminIncidentsPage");
const MasterAdminSupportPage = lazyPage(() => import("@/pages/MasterAdminSupportPage"), "MasterAdminSupportPage");
const TeachersPage = lazyPage(() => import("@/pages/TeachersPage"), "TeachersPage");
const VideosPage = lazyPage(() => import("@/pages/VideosPage"), "VideosPage");
const TeacherProfilePage = lazyPage(() => import("@/pages/TeacherProfilePage"), "TeacherProfilePage");
const TeacherLatestLessonPage = lazyPage(() => import("@/pages/TeacherLatestLessonPage"), "TeacherLatestLessonPage");
const TeacherHistoryPage = lazyPage(() => import("@/pages/TeacherHistoryPage"), "TeacherHistoryPage");
const TeacherOperationsPage = lazyPage(() => import("@/pages/TeacherOperationsPage"), "TeacherOperationsPage");
const CoachingHubPage = lazyPage(() => import("@/pages/CoachingHubPage"), "CoachingHubPage");
const CohortManagementPage = lazyPage(() => import("@/pages/CohortManagementPage"), "CohortManagementPage");
const MasterSchedulePage = lazyPage(() => import("@/pages/MasterSchedulePage"), "MasterSchedulePage");
const ObservationSetupPage = lazyPage(() => import("@/pages/ObservationSetupPage"), "ObservationSetupPage");
const ObserverInsightsPage = lazyPage(() => import("@/pages/ObserverInsightsPage"), "ObserverInsightsPage");
const ReportsPage = lazyPage(() => import("@/pages/ReportsPage"), "ReportsPage");
const NotificationsPage = lazyPage(() => import("@/pages/NotificationsPage"), "NotificationsPage");
const NotificationPreferencesPage = lazyPage(() => import("@/pages/NotificationPreferencesPage"), "NotificationPreferencesPage");
const OnboardingPage = lazyPage(() => import("@/pages/OnboardingPage"), "OnboardingPage");
const ConsentPage = lazyPage(() => import("@/pages/ConsentPage"), "ConsentPage");
const TeacherPrivacyPage = lazyPage(() => import("@/pages/TeacherPrivacyPage"), "TeacherPrivacyPage");
const VideoPlayerPage = lazyPage(() => import("@/pages/VideoPlayerPage"), "VideoPlayerPage");
const VideoRecorderPage = lazyPage(() => import("@/pages/VideoRecorderPage"), "VideoRecorderPage");
const FrameworksPage = lazyPage(() => import("@/pages/FrameworksPage"), "FrameworksPage");
const PrivacyReviewQueuePage = lazyPage(() => import("@/pages/PrivacyReviewQueuePage"), "PrivacyReviewQueuePage");
const RecognitionReviewPage = lazyPage(() => import("@/pages/RecognitionReviewPage"), "RecognitionReviewPage");
const ExemplarLibraryPage = lazyPage(() => import("@/pages/ExemplarLibraryPage"), "ExemplarLibraryPage");
const OpsMetricsPage = lazyPage(() => import("@/pages/OpsMetricsPage"), "OpsMetricsPage");
const TeacherWorkspacePage = lazyPage(() => import("@/pages/TeacherWorkspacePage"), "TeacherWorkspacePage");
const TeacherSelfProfilePage = lazyPage(() => import("@/pages/TeacherSelfProfilePage"), "TeacherSelfProfilePage");
const TeacherLessonsPage = lazyPage(() => import("@/pages/TeacherLessonsPage"), "TeacherLessonsPage");
const TeacherCoachingPage = lazyPage(() => import("@/pages/TeacherCoachingPage"), "TeacherCoachingPage");
const TeacherBadgesPage = lazyPage(() => import("@/pages/TeacherBadgesPage"), "TeacherBadgesPage");
const ActionPlanRecordPage = lazyPage(() => import("@/pages/ActionPlanRecordPage"), "ActionPlanRecordPage");
const ReflectionRecordPage = lazyPage(() => import("@/pages/ReflectionRecordPage"), "ReflectionRecordPage");

function LazyRoute({ children }) {
  return (
    <Suspense fallback={<div className="p-6"><SkeletonTable rows={8} /></div>}>
      {children}
    </Suspense>
  );
}

function HomeRedirect() {
  const { user, initializing } = useAuth();

  if (initializing) {
    return null;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Navigate to={getHomeRoute(user)} replace />;
}

function RoleAwareAlias({ teacherTo, adminTo }) {
  const { user, initializing } = useAuth();
  if (initializing) return null;
  const role = user?.tenant_role || user?.role;
  return <Navigate to={role === "teacher" ? teacherTo : adminTo} replace />;
}

function RoleAwareCoachingRoute() {
  const { user, initializing } = useAuth();
  if (initializing) return null;
  const role = user?.tenant_role || user?.role;
  if (role === "teacher") {
    return <Navigate to="/my-coaching" replace />;
  }
  return <LazyRoute><CoachingHubPage /></LazyRoute>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<AuthPage />} />

      <Route
        path="/onboarding"
        element={
          <ProtectedRoute allowedTenantRoles={["school_admin", "training_admin"]}>
            <LazyRoute><OnboardingPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/consent"
        element={
          <ProtectedRoute allowedTenantRoles={["teacher"]}>
            <LazyRoute><ConsentPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/privacy"
        element={
          <ProtectedRoute allowedTenantRoles={["teacher", "school_admin", "training_admin", "super_admin"]}>
            <LazyRoute><TeacherPrivacyPage /></LazyRoute>
          </ProtectedRoute>
        }
      />

      <Route
        path="/master-admin"
        element={
          <ProtectedRoute superAdminOnly>
            <LazyRoute><MasterAdminPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/master-admin/users"
        element={
          <ProtectedRoute superAdminOnly>
            <LazyRoute><MasterAdminUsersPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/master-admin/users/:userId"
        element={
          <ProtectedRoute superAdminOnly>
            <LazyRoute><MasterAdminUserDetailPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/master-admin/organizations"
        element={
          <ProtectedRoute superAdminOnly>
            <LazyRoute><MasterAdminOrganizationsPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/master-admin/organizations/:organizationId"
        element={
          <ProtectedRoute superAdminOnly>
            <LazyRoute><MasterAdminOrganizationDetailPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/master-admin/workspaces"
        element={
          <ProtectedRoute superAdminOnly>
            <LazyRoute><MasterAdminWorkspacesPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/master-admin/workspaces/:ownerUserId"
        element={
          <ProtectedRoute superAdminOnly>
            <LazyRoute><MasterAdminWorkspaceDetailPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/master-admin/videos"
        element={
          <ProtectedRoute superAdminOnly>
            <LazyRoute><MasterAdminVideosPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/master-admin/videos/:videoId"
        element={
          <ProtectedRoute superAdminOnly>
            <LazyRoute><MasterAdminVideoDetailPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/master-admin/storage"
        element={
          <ProtectedRoute superAdminOnly>
            <LazyRoute><MasterAdminStoragePage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/master-admin/dependencies"
        element={
          <ProtectedRoute superAdminOnly>
            <LazyRoute><MasterAdminDependenciesPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/master-admin/ai-quality"
        element={
          <ProtectedRoute superAdminOnly>
            <LazyRoute><MasterAdminAIQualityPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/master-admin/incidents"
        element={
          <ProtectedRoute superAdminOnly>
            <LazyRoute><MasterAdminIncidentsPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/master-admin/support"
        element={
          <ProtectedRoute superAdminOnly>
            <LazyRoute><MasterAdminSupportPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/master-admin/auth-activity"
        element={
          <ProtectedRoute superAdminOnly>
            <LazyRoute><MasterAdminAuthActivityPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/master-admin/audit"
        element={
          <ProtectedRoute superAdminOnly>
            <LazyRoute><MasterAdminAuditPage /></LazyRoute>
          </ProtectedRoute>
        }
      />

      <Route
        path="/dashboard"
        element={
          <ProtectedRoute allowedTenantRoles={["school_admin", "training_admin"]}>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/dashboard/training"
        element={
          <ProtectedRoute allowedTenantRoles={["training_admin"]}>
            <Navigate to="/dashboard" replace />
          </ProtectedRoute>
        }
      />
      <Route
        path="/teachers"
        element={
          <ProtectedRoute allowedTenantRoles={["school_admin", "training_admin"]}>
            <LazyRoute><TeachersPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/cohorts"
        element={
          <ProtectedRoute allowedTenantRoles={["training_admin"]}>
            <LazyRoute><CohortManagementPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/teachers/:teacherId"
        element={
          <ProtectedRoute allowedTenantRoles={["school_admin", "training_admin"]}>
            <LazyRoute><TeacherProfilePage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/teachers/:teacherId/latest-lesson"
        element={
          <ProtectedRoute allowedTenantRoles={["school_admin", "training_admin"]}>
            <LazyRoute><TeacherLatestLessonPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/coaching"
        element={
          <ProtectedRoute allowedTenantRoles={["teacher", "school_admin", "training_admin"]}>
            <RoleAwareCoachingRoute />
          </ProtectedRoute>
        }
      />
      <Route
        path="/teachers/:teacherId/coaching"
        element={
          <ProtectedRoute allowedTenantRoles={["school_admin", "training_admin"]}>
            <LazyRoute><CoachingHubPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/teachers/:teacherId/history"
        element={
          <ProtectedRoute allowedTenantRoles={["school_admin", "training_admin"]}>
            <LazyRoute><TeacherHistoryPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/teachers/:teacherId/operations"
        element={
          <ProtectedRoute superAdminOnly>
            <LazyRoute><TeacherOperationsPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/teachers/:teacherId/action-plan"
        element={
          <ProtectedRoute allowedTenantRoles={["school_admin", "training_admin"]}>
            <LazyRoute><ActionPlanRecordPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/teachers/:teacherId/reflections"
        element={
          <ProtectedRoute allowedTenantRoles={["school_admin", "training_admin"]}>
            <LazyRoute><ReflectionRecordPage /></LazyRoute>
          </ProtectedRoute>
        }
      />

      <Route
        path="/my-workspace"
        element={
          <ProtectedRoute allowedTenantRoles={["teacher"]}>
            <LazyRoute><TeacherWorkspacePage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/my-badges"
        element={
          <ProtectedRoute allowedTenantRoles={["teacher"]}>
            <LazyRoute><TeacherBadgesPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/my-profile"
        element={
          <ProtectedRoute allowedTenantRoles={["teacher"]}>
            <LazyRoute><TeacherSelfProfilePage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/my-lessons"
        element={
          <ProtectedRoute allowedTenantRoles={["teacher"]}>
            <LazyRoute><TeacherLessonsPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/my-coaching"
        element={
          <ProtectedRoute allowedTenantRoles={["teacher"]}>
            <LazyRoute><TeacherCoachingPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/my-workspace/goals"
        element={
          <ProtectedRoute allowedTenantRoles={["teacher"]}>
            <LazyRoute><ActionPlanRecordPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/my-workspace/coaching"
        element={
          <ProtectedRoute allowedTenantRoles={["teacher"]}>
            <Navigate to="/my-coaching" replace />
          </ProtectedRoute>
        }
      />
      <Route
        path="/my-workspace/reflections"
        element={
          <ProtectedRoute allowedTenantRoles={["teacher"]}>
            <LazyRoute><ReflectionRecordPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/my-workspace/:section"
        element={
          <ProtectedRoute allowedTenantRoles={["teacher"]}>
            <LazyRoute><TeacherWorkspacePage /></LazyRoute>
          </ProtectedRoute>
        }
      />

      <Route
        path="/videos"
        element={
          <ProtectedRoute allowedTenantRoles={["teacher", "school_admin", "training_admin"]}>
            <LazyRoute><VideosPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/teacher/profile"
        element={
          <ProtectedRoute allowedTenantRoles={["teacher"]}>
            <Navigate to="/my-profile" replace />
          </ProtectedRoute>
        }
      />
      <Route
        path="/teacher/lessons"
        element={
          <ProtectedRoute allowedTenantRoles={["teacher"]}>
            <Navigate to="/my-lessons" replace />
          </ProtectedRoute>
        }
      />
      <Route
        path="/lessons"
        element={
          <ProtectedRoute allowedTenantRoles={["teacher", "school_admin", "training_admin"]}>
            <RoleAwareAlias teacherTo="/my-lessons" adminTo="/videos" />
          </ProtectedRoute>
        }
      />
      <Route
        path="/recognition"
        element={
          <ProtectedRoute allowedTenantRoles={["teacher", "school_admin", "training_admin"]}>
            <RoleAwareAlias teacherTo="/my-badges" adminTo="/recognition-review" />
          </ProtectedRoute>
        }
      />
      <Route
        path="/videos/:videoId"
        element={
          <ProtectedRoute allowedTenantRoles={["teacher", "school_admin", "training_admin"]}>
            <LazyRoute><VideoPlayerPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/privacy-review"
        element={
          <ProtectedRoute allowedTenantRoles={["school_admin"]}>
            <LazyRoute><PrivacyReviewQueuePage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/recognition-review"
        element={
          <ProtectedRoute allowedTenantRoles={["school_admin"]}>
            <LazyRoute><RecognitionReviewPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/ops/metrics"
        element={
          <ProtectedRoute allowedTenantRoles={["school_admin"]}>
            <LazyRoute><OpsMetricsPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports"
        element={
          <ProtectedRoute allowedTenantRoles={["school_admin", "training_admin"]}>
            <LazyRoute><ReportsPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/notifications"
        element={
          <ProtectedRoute allowedTenantRoles={["teacher", "school_admin", "training_admin", "super_admin"]}>
            <LazyRoute><NotificationsPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/notifications"
        element={
          <ProtectedRoute allowedTenantRoles={["teacher", "school_admin", "training_admin", "super_admin"]}>
            <LazyRoute><NotificationPreferencesPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/all-star-library"
        element={
          <ProtectedRoute allowedTenantRoles={["teacher", "school_admin", "training_admin"]}>
            <LazyRoute><ExemplarLibraryPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/school-setup"
        element={
          <ProtectedRoute allowedTenantRoles={["school_admin", "training_admin"]}>
            <LazyRoute><FrameworksPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute allowedTenantRoles={["school_admin", "training_admin"]}>
            <LazyRoute><FrameworksPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/settings"
        element={
          <ProtectedRoute allowedTenantRoles={["school_admin", "training_admin"]}>
            <Navigate to="/settings" replace />
          </ProtectedRoute>
        }
      />
      <Route path="/frameworks" element={<HomeRedirect />} />
      <Route
        path="/master-schedule"
        element={
          <ProtectedRoute allowedTenantRoles={["school_admin", "training_admin"]}>
            <LazyRoute><MasterSchedulePage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/my-insights"
        element={
          <ProtectedRoute allowedTenantRoles={["school_admin", "training_admin", "super_admin"]}>
            <LazyRoute><ObserverInsightsPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/observation/new"
        element={
          <ProtectedRoute allowedTenantRoles={["school_admin", "training_admin"]}>
            <LazyRoute><ObservationSetupPage /></LazyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/record"
        element={
          <ProtectedRoute allowedTenantRoles={["teacher", "school_admin", "training_admin"]}>
            <LazyRoute><VideoRecorderPage /></LazyRoute>
          </ProtectedRoute>
        }
      />

      <Route path="/" element={<HomeRedirect />} />
      <Route path="*" element={<HomeRedirect />} />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <RouteErrorBoundary>
        <AppRoutes />
      </RouteErrorBoundary>
    </AuthProvider>
  );
}

export default App;
