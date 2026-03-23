import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';

// Layout
import Layout from '@/components/shared/Layout';

// Screens
import LoginPage from '@/components/screens/LoginPage';
import SSOCallback from '@/components/screens/SSOCallback';
import HomePage from '@/components/screens/HomePage';
import FrameworkSelection from '@/components/screens/FrameworkSelection';
import ElementSelection from '@/components/screens/ElementSelection';
import RosterPage from '@/components/screens/RosterPage';
import TeacherDashboard from '@/components/screens/TeacherDashboard';
import VideoAnalysisPage from '@/components/screens/VideoAnalysisPage';
import VideoUploadPage from '@/components/screens/VideoUploadPage';
import SettingsPage from '@/components/screens/SettingsPage';
import NotFoundPage from '@/components/screens/NotFoundPage';

// Protected Route wrapper
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuthStore();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

const App: React.FC = () => {
  const { isAuthenticated } = useAuthStore();

  return (
    <Routes>
      {/* Public routes */}
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <LoginPage />}
      />
      <Route path="/auth/callback" element={<SSOCallback />} />

      {/* Protected routes */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<HomePage />} />
        <Route path="frameworks" element={<FrameworkSelection />} />
        <Route path="frameworks/elements" element={<ElementSelection />} />
        <Route path="roster" element={<RosterPage />} />
        <Route path="teachers/:teacherId" element={<TeacherDashboard />} />
        <Route path="video/:videoId/analysis" element={<VideoAnalysisPage />} />
        <Route path="video/upload" element={<VideoUploadPage />} />

        {/* Settings and Profile */}
        <Route path="settings" element={<SettingsPage />} />
        <Route path="profile" element={<PlaceholderPage title="Profile" />} />
        <Route path="reports/:reportId" element={<PlaceholderPage title="Report Details" />} />

        {/* 404 within authenticated area */}
        <Route path="*" element={<NotFoundPage />} />
      </Route>

      {/* 404 for unauthenticated */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
};

// Placeholder for routes not yet implemented
const PlaceholderPage: React.FC<{ title: string }> = ({ title }) => (
  <div className="text-center py-12">
    <h1 className="font-heading text-2xl font-bold text-gray-900 mb-4">{title}</h1>
    <p className="text-gray-600">This page is coming soon.</p>
  </div>
);

export default App;
