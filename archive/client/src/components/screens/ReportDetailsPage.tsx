import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  AlertTriangle,
  Calendar,
  Send,
  Users,
  FileText,
} from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { dashboardApi } from '@/services/api';
import type { RecentReport } from '@/types';

export const ReportDetailsPage: React.FC = () => {
  const navigate = useNavigate();
  const { reportId } = useParams<{ reportId: string }>();

  const [report, setReport] = useState<RecentReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchReport = async () => {
      setLoading(true);
      setError(null);
      try {
        const summary = await dashboardApi.getSummary();
        const matchingReport = summary.recentReports.find((item) => item.id === reportId) || null;
        setReport(matchingReport);
        if (!matchingReport) {
          setError('This report is no longer available.');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load report details');
      } finally {
        setLoading(false);
      }
    };

    fetchReport();
  }, [reportId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="text-center py-12">
        <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Unable to open report</h2>
        <p className="text-gray-600 mb-6">{error || 'Report not found'}</p>
        <Button onClick={() => navigate('/dashboard')} leftIcon={<ArrowLeft className="w-4 h-4" />}>
          Back to Dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-3"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back
          </button>
          <h1 className="font-heading text-2xl font-bold text-gray-900">{report.title}</h1>
          <p className="text-gray-600 mt-1">
            Report ID: <span className="font-mono">{report.id}</span>
          </p>
        </div>
        <Button variant="secondary" onClick={() => navigate('/roster')}>
          Open Teacher Roster
        </Button>
      </div>

      <Card>
        <CardTitle>
          <div className="inline-flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary-600" />
            Report Snapshot
          </div>
        </CardTitle>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
          <div className="p-3 bg-gray-50 rounded-lg">
            <p className="text-xs uppercase tracking-wide text-gray-500">Last Sent</p>
            <p className="text-sm font-medium text-gray-900 mt-1">
              {format(new Date(report.lastSent), 'MMM d, yyyy h:mm a')}
            </p>
          </div>
          <div className="p-3 bg-gray-50 rounded-lg">
            <p className="text-xs uppercase tracking-wide text-gray-500">Recipients</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{report.recipientCount}</p>
          </div>
          <div className="p-3 bg-gray-50 rounded-lg">
            <p className="text-xs uppercase tracking-wide text-gray-500">Status</p>
            <p className="text-sm font-medium text-green-700 mt-1">Delivered</p>
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle>Distribution and Follow-Up</CardTitle>
        <div className="mt-4 space-y-3">
          <div className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg">
            <Send className="w-4 h-4 text-gray-500 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-gray-900">Delivery Log</p>
              <p className="text-sm text-gray-600">
                Sent to {report.recipientCount} stakeholders on{' '}
                {format(new Date(report.lastSent), 'MMMM d, yyyy')}.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg">
            <Users className="w-4 h-4 text-gray-500 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-gray-900">Next Review Meeting</p>
              <p className="text-sm text-gray-600">
                Recommend scheduling a follow-up with instructional leaders this week.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg">
            <Calendar className="w-4 h-4 text-gray-500 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-gray-900">Next Report Window</p>
              <p className="text-sm text-gray-600">
                Generate the next summary after updated observations are uploaded.
              </p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default ReportDetailsPage;
