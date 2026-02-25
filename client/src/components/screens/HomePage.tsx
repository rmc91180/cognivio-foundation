import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText,
  Users,
  AlertTriangle,
  TrendingUp,
  ArrowRight,
  Edit3,
  BookOpen,
} from 'lucide-react';
import { Card, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { dashboardApi } from '@/services/api';
import type { DashboardSummary } from '@/types';
import { formatDistanceToNow } from 'date-fns';

export const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSummary = async () => {
      try {
        const data = await dashboardApi.getSummary();
        setSummary(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      } finally {
        setLoading(false);
      }
    };

    fetchSummary();
  }, []);

  const handleManageRubric = () => {
    if (summary?.activeRubricId) {
      navigate(`/frameworks/elements?templateId=${summary.activeRubricId}`);
      return;
    }

    navigate('/frameworks');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Unable to load dashboard</h2>
        <p className="text-gray-600 mb-4">{error}</p>
        <Button onClick={() => window.location.reload()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl sm:text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600 mt-1">
            Welcome back. Here is a quick snapshot of school performance and setup status.
          </p>
        </div>
        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-primary-50 text-primary-700 border border-primary-200 w-fit">
          Today&apos;s overview
        </span>
      </div>

      {/* Quick Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Active Rubric Card */}
        <Card className="min-h-[178px]">
          <div className="flex items-start justify-between">
            <div className="p-2 bg-primary-100 rounded-lg">
              <FileText className="w-6 h-6 text-primary-600" />
            </div>
            <button
              onClick={handleManageRubric}
              className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
              aria-label="Manage rubric"
            >
              <Edit3 className="w-4 h-4" />
            </button>
          </div>
          <div className="mt-4">
            <p className="text-sm text-gray-500">School Setup Template</p>
            <p className="font-heading font-semibold text-gray-900 mt-1">
              {summary?.activeRubricName || 'No template selected'}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Last edited {summary?.lastEditedAt
                ? formatDistanceToNow(new Date(summary.lastEditedAt), { addSuffix: true })
                : 'never'}
            </p>
          </div>
        </Card>

        {/* Teacher Roster Card */}
        <Card
          className="min-h-[178px]"
          onClick={() => navigate('/roster')}
        >
          <div className="p-2 bg-green-100 rounded-lg w-fit">
            <Users className="w-6 h-6 text-green-600" />
          </div>
          <div className="mt-4">
            <p className="text-sm text-gray-500">Teacher Roster</p>
            <p className="font-heading text-2xl font-bold text-gray-900 mt-1">
              {summary?.totalTeachers || 0}
            </p>
            <div className="flex items-center gap-3 mt-2">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-xs text-gray-600">{summary?.greenTeachers || 0}</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-yellow-500" />
                <span className="text-xs text-gray-600">{summary?.yellowTeachers || 0}</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-red-500" />
                <span className="text-xs text-gray-600">{summary?.redTeachers || 0}</span>
              </div>
            </div>
          </div>
        </Card>

        {/* Gradebook Health Card */}
        <Card className="min-h-[178px]">
          <div className={`p-2 rounded-lg w-fit ${
            (summary?.missingGradesCount || 0) > 0 ? 'bg-yellow-100' : 'bg-green-100'
          }`}>
            <BookOpen className={`w-6 h-6 ${
              (summary?.missingGradesCount || 0) > 0 ? 'text-yellow-600' : 'text-green-600'
            }`} />
          </div>
          <div className="mt-4">
            <p className="text-sm text-gray-500">Gradebook Health</p>
            <p className="font-heading text-2xl font-bold text-gray-900 mt-1">
              {summary?.missingGradesCount || 0}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {(summary?.missingGradesCount || 0) > 0
                ? 'Teachers with missing grades'
                : 'All grades up to date'}
            </p>
          </div>
        </Card>

        {/* Quick Action Card */}
        <Card className="min-h-[178px] bg-gradient-to-br from-primary-600 to-primary-700 text-white">
          <div className="p-2 bg-white/20 rounded-lg w-fit">
            <TrendingUp className="w-6 h-6 text-white" />
          </div>
          <div className="mt-4">
            <p className="text-sm text-primary-100">Teachers needing attention</p>
            <p className="font-heading text-2xl font-bold mt-1">
              {(summary?.yellowTeachers || 0) + (summary?.redTeachers || 0)}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-3 text-white hover:bg-white/20"
              onClick={() => navigate('/roster?status=yellow,red')}
            >
              View Details
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </Card>
      </div>

      {/* Main Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <Button
          size="lg"
          className="w-full justify-center"
          onClick={() => navigate('/roster')}
        >
          <Users className="w-5 h-5 mr-2" />
          Open Teacher Roster
        </Button>
        <Button
          variant="secondary"
          size="lg"
          className="w-full justify-center border border-gray-300"
          onClick={() => navigate('/frameworks')}
        >
          <FileText className="w-5 h-5 mr-2" />
          Open School Setup
        </Button>
      </div>

      {/* Recent Reports */}
      {summary?.recentReports && summary.recentReports.length > 0 && (
        <Card>
          <CardTitle>Recent Reports</CardTitle>
          <div className="mt-4 space-y-3">
            {summary.recentReports.map((report) => (
              <button
                key={report.id}
                type="button"
                className="w-full text-left flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer"
                onClick={() => navigate(`/reports/${report.id}`)}
              >
                <div>
                  <p className="font-medium text-gray-900">{report.title}</p>
                  <p className="text-sm text-gray-500">
                    Sent to {report.recipientCount} recipients •{' '}
                    {formatDistanceToNow(new Date(report.lastSent), { addSuffix: true })}
                  </p>
                </div>
                <ArrowRight className="w-5 h-5 text-gray-400" />
              </button>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};

export default HomePage;
