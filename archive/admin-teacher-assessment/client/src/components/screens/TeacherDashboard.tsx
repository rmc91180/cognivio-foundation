import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Calendar,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  Play,
  Check,
  Pin,
  ChevronDown,
  ChevronRight,
  BookOpen,
  MessageSquare,
} from 'lucide-react';
import { Card, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ColorChip } from '@/components/ui/ColorChip';
import { AIFeedbackForm } from '@/components/shared/AIFeedbackForm';
import { AIInsightsPanel } from '@/components/ai/AIInsightsPanel';
import { EnhancedTrendChart } from '@/components/ui/EnhancedTrendChart';
import { AILearningHistoryTimeline } from '@/components/ui/AILearningHistoryTimeline';
import { FeedbackHistory } from '@/components/feedback/FeedbackHistory';
import { FeedbackComposer } from '@/components/feedback/FeedbackComposer';
import { teachersApi, settingsApi } from '@/services/api';
import { useTrendsStore } from '@/store/trendsStore';
import type { TeacherDetail, ElementScore, AIObservation, DateRange, PeriodType, AISuggestion } from '@/types';
import { format, subDays, subMonths, subQuarters } from 'date-fns';

const DATE_PRESETS: { label: string; preset: DateRange['preset']; getDates: () => { start: Date; end: Date } }[] = [
  { label: 'Last 7 Days', preset: 'week', getDates: () => ({ start: subDays(new Date(), 7), end: new Date() }) },
  { label: 'Last 30 Days', preset: 'month', getDates: () => ({ start: subDays(new Date(), 30), end: new Date() }) },
  { label: 'Last Quarter', preset: 'quarter', getDates: () => ({ start: subQuarters(new Date(), 1), end: new Date() }) },
  { label: 'Last Year', preset: 'year', getDates: () => ({ start: subMonths(new Date(), 12), end: new Date() }) },
];

export const TeacherDashboard: React.FC = () => {
  const { teacherId } = useParams<{ teacherId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const templateId = searchParams.get('templateId') || '';

  const [detail, setDetail] = useState<TeacherDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>({
    start: subDays(new Date(), 30),
    end: new Date(),
    preset: 'month',
  });
  const [viewMode, setViewMode] = useState<'auto' | 'priority'>('auto');
  const [expandedDomains, setExpandedDomains] = useState<string[]>([]);
  const [showFeedbackComposer, setShowFeedbackComposer] = useState(false);
  const [trendPeriodType, setTrendPeriodType] = useState<PeriodType>('month');

  const { trendData, fetchTeacherTrends } = useTrendsStore();

  useEffect(() => {
    const fetchDetail = async () => {
      if (!teacherId || !templateId) return;

      setLoading(true);
      setError(null);

      try {
        const data = await teachersApi.getDetail(
          teacherId,
          templateId,
          dateRange.start.toISOString(),
          dateRange.end.toISOString()
        );
        setDetail(data);

        // Expand all domains by default
        const domains = [...new Set(data.elementScores.map((e) => e.domain))];
        setExpandedDomains(domains);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load teacher data');
      } finally {
        setLoading(false);
      }
    };

    fetchDetail();
  }, [teacherId, templateId, dateRange]);

  // Fetch trend data
  useEffect(() => {
    if (teacherId && templateId) {
      fetchTeacherTrends(teacherId, { templateId, periodType: trendPeriodType });
    }
  }, [teacherId, templateId, trendPeriodType]);

  const handleSuggestionClick = (suggestion: AISuggestion) => {
    // Could navigate to a suggestion detail view or open a modal
    console.log('Suggestion clicked:', suggestion);
  };

  const handleDatePreset = (preset: typeof DATE_PRESETS[0]) => {
    const dates = preset.getDates();
    setDateRange({
      start: dates.start,
      end: dates.end,
      preset: preset.preset,
    });
  };

  const handlePinElement = async (elementId: string, isPinned: boolean) => {
    try {
      await settingsApi.updatePinnedElements(elementId, isPinned ? 'remove' : 'add');
      // Update local state
      if (detail) {
        setDetail({
          ...detail,
          elementScores: detail.elementScores.map((e) =>
            e.elementId === elementId ? { ...e, isPinned: !isPinned } : e
          ),
        });
      }
    } catch (err) {
      console.error('Failed to pin element:', err);
    }
  };

  const toggleDomain = (domain: string) => {
    setExpandedDomains((prev) =>
      prev.includes(domain) ? prev.filter((d) => d !== domain) : [...prev, domain]
    );
  };

  const TrendIcon = ({ trend }: { trend: 'up' | 'down' | 'stable' }) => {
    if (trend === 'up') return <TrendingUp className="w-4 h-4 text-green-600" />;
    if (trend === 'down') return <TrendingDown className="w-4 h-4 text-red-600" />;
    return <Minus className="w-4 h-4 text-gray-400" />;
  };

  const getTop4Elements = (): ElementScore[] => {
    if (!detail) return [];
    return [...detail.elementScores]
      .sort((a, b) => b.problemScore - a.problemScore)
      .slice(0, 4);
  };

  const getSortedElements = (): ElementScore[] => {
    if (!detail) return [];
    if (viewMode === 'priority') {
      // Pinned first, then by problem score
      return [...detail.elementScores].sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;
        return b.problemScore - a.problemScore;
      });
    }
    // Auto mode: by problem score
    return [...detail.elementScores].sort((a, b) => b.problemScore - a.problemScore);
  };

  const groupByDomain = (elements: ElementScore[]) => {
    const groups = new Map<string, ElementScore[]>();
    elements.forEach((elem) => {
      const existing = groups.get(elem.domain) || [];
      groups.set(elem.domain, [...existing, elem]);
    });
    return groups;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="text-center py-12">
        <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Unable to load data</h2>
        <p className="text-gray-600 mb-4">{error}</p>
        <Button onClick={() => navigate(-1)}>Go Back</Button>
      </div>
    );
  }

  const top4 = getTop4Elements();
  const sortedElements = getSortedElements();
  const domainGroups = groupByDomain(sortedElements);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div className="flex items-center gap-3">
            <div>
              <h1 className="font-heading text-2xl font-bold text-gray-900">
                {detail.teacher.name}
              </h1>
              <p className="text-gray-600">
                {detail.teacher.subjects?.join(', ')} • Grades{' '}
                {detail.teacher.grades?.join(', ')}
              </p>
            </div>
            <ColorChip color={detail.overallColor} size="lg" />
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Period Selector */}
          <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
            {DATE_PRESETS.map((preset) => (
              <button
                key={preset.preset}
                onClick={() => handleDatePreset(preset)}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  dateRange.preset === preset.preset
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* View Mode Toggle */}
          <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setViewMode('auto')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                viewMode === 'auto'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Auto Detail
            </button>
            <button
              onClick={() => setViewMode('priority')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                viewMode === 'priority'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Priority
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Column - Summary Cards */}
        <div className="space-y-4">
          {/* Overall Rating */}
          <Card>
            <CardTitle>Overall Performance</CardTitle>
            <div className="mt-4 text-center">
              <p className="text-4xl font-bold text-gray-900">
                {detail.overallScore}%
              </p>
              <div className="flex items-center justify-center gap-2 mt-2">
                <TrendIcon
                  trend={
                    detail.previousPeriodScore
                      ? detail.overallScore > detail.previousPeriodScore
                        ? 'up'
                        : detail.overallScore < detail.previousPeriodScore
                        ? 'down'
                        : 'stable'
                      : 'stable'
                  }
                />
                <span className="text-sm text-gray-600">
                  {detail.previousPeriodScore
                    ? `${Math.abs(
                        Math.round(detail.overallScore - detail.previousPeriodScore)
                      )}% ${
                        detail.overallScore >= detail.previousPeriodScore
                          ? 'increase'
                          : 'decrease'
                      }`
                    : 'No prior data'}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                School average: {detail.schoolAverage}%
              </p>
            </div>
          </Card>

          {/* Top 4 Problematic */}
          <Card>
            <CardTitle>Areas Needing Attention</CardTitle>
            <div className="mt-4 space-y-3">
              {top4.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">
                  Great job! No critical areas identified.
                </p>
              ) : (
                top4.map((elem) => (
                  <div
                    key={elem.elementId}
                    className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg"
                  >
                    <ColorChip color={elem.color} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {elem.elementName}
                      </p>
                      <div className="flex items-center gap-1 text-xs text-gray-500">
                        <span>{elem.numericScore}%</span>
                        <TrendIcon trend={elem.trend} />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          {/* Gradebook Status */}
          <Card>
            <CardTitle>Gradebook Status</CardTitle>
            <div className="mt-4">
              {detail.gradebookStatus.missingGrades ? (
                <div className="flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-yellow-800">
                      Missing Grades
                    </p>
                    <ul className="text-xs text-yellow-700 mt-1">
                      {detail.gradebookStatus.classesMissing.map((cls, i) => (
                        <li key={i}>• {cls}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-green-600">
                  <Check className="w-5 h-5" />
                  <span className="text-sm">All grades up to date</span>
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Center Column - Element Scores */}
        <div className="lg:col-span-2 space-y-4">
          <Card padding="none">
            <div className="p-4 border-b border-gray-200">
              <h2 className="font-heading font-semibold text-lg text-gray-900">
                Element Scores
              </h2>
            </div>

            <div className="divide-y divide-gray-100">
              {Array.from(domainGroups.entries()).map(([domain, elements]) => (
                <div key={domain}>
                  <button
                    onClick={() => toggleDomain(domain)}
                    className="w-full flex items-center justify-between p-4 hover:bg-gray-50 text-left"
                  >
                    <span className="font-medium text-gray-900">{domain}</span>
                    {expandedDomains.includes(domain) ? (
                      <ChevronDown className="w-5 h-5 text-gray-500" />
                    ) : (
                      <ChevronRight className="w-5 h-5 text-gray-500" />
                    )}
                  </button>

                  {expandedDomains.includes(domain) && (
                    <div className="border-t border-gray-100">
                      {elements.map((elem) => (
                        <div
                          key={elem.elementId}
                          className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50"
                        >
                          <button
                            onClick={() =>
                              handlePinElement(elem.elementId, elem.isPinned)
                            }
                            className={`p-1 rounded ${
                              elem.isPinned
                                ? 'text-primary-600'
                                : 'text-gray-300 hover:text-gray-500'
                            }`}
                            aria-label={elem.isPinned ? 'Unpin' : 'Pin'}
                          >
                            <Pin className="w-4 h-4" />
                          </button>

                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900">
                              {elem.elementName}
                            </p>
                            <p className="text-xs text-gray-500">
                              {elem.observationCount} observation
                              {elem.observationCount !== 1 && 's'}
                            </p>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">
                              {elem.numericScore}%
                            </span>
                            <TrendIcon trend={elem.trend} />
                            <ColorChip color={elem.color} size="sm" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Right Column - AI Insights */}
        <div className="space-y-4">
          {/* AI Insights Panel (new component) */}
          {teacherId && (
            <AIInsightsPanel
              teacherId={teacherId}
              templateId={templateId}
              onSuggestionClick={handleSuggestionClick}
            />
          )}

          {/* Legacy AI Observations (keeping for backward compatibility) */}
          {detail.aiObservations.filter((o) => o.status === 'pending').length > 0 && (
            <Card>
              <CardTitle>Pending AI Observations</CardTitle>
              <div className="mt-4 space-y-4">
                {detail.aiObservations
                  .filter((o) => o.status === 'pending')
                  .slice(0, 5)
                  .map((obs) => (
                    <div
                      key={obs.id}
                      className="p-3 border border-gray-200 rounded-lg"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-primary-600 bg-primary-50 px-2 py-0.5 rounded">
                          AI Confidence: {Math.round(obs.confidence * 100)}%
                        </span>
                        <span className="text-xs text-gray-500">
                          Score: {obs.scoreEstimate}%
                        </span>
                      </div>

                      <p className="text-sm text-gray-700 line-clamp-3">
                        {obs.summary}
                      </p>

                      {/* AI Feedback Form with learning loop */}
                      <div className="mt-3">
                        <AIFeedbackForm
                          observation={obs}
                          compact
                          onSubmitSuccess={async () => {
                            // Refresh data after feedback submission
                            if (teacherId && templateId) {
                              const data = await teachersApi.getDetail(
                                teacherId,
                                templateId,
                                dateRange.start.toISOString(),
                                dateRange.end.toISOString()
                              );
                              setDetail(data);
                            }
                          }}
                        />
                      </div>
                    </div>
                  ))}
              </div>
            </Card>
          )}

          {/* Video Evidence */}
          {detail.videoEvidence.length > 0 && (
            <Card>
              <CardTitle>Video Evidence</CardTitle>
              <div className="mt-4 space-y-2">
                {detail.videoEvidence.slice(0, 3).map((video) => (
                  <div
                    key={video.id}
                    className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100"
                  >
                    <div className="w-16 h-10 bg-gray-200 rounded flex items-center justify-center">
                      <Play className="w-4 h-4 text-gray-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        Classroom Recording
                      </p>
                      <p className="text-xs text-gray-500">
                        {video.durationSeconds
                          ? `${Math.round(video.durationSeconds / 60)} min`
                          : 'Unknown duration'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Send Feedback Button */}
          <Button
            variant="secondary"
            className="w-full"
            leftIcon={<MessageSquare className="w-4 h-4" />}
            onClick={() => setShowFeedbackComposer(true)}
          >
            Send Feedback to Teacher
          </Button>
        </div>
      </div>

      {/* Performance Trends Section */}
      {teacherId && trendData.length > 0 && (
        <Card>
          <CardTitle>Performance Trends</CardTitle>
          <div className="mt-4">
            <EnhancedTrendChart
              data={trendData}
              schoolAverage={detail.schoolAverage ? [detail.schoolAverage] : undefined}
              height={200}
              periodType={trendPeriodType}
              onPeriodChange={setTrendPeriodType}
              showSchoolComparison={true}
              showRegressionZones={true}
            />
          </div>
        </Card>
      )}

      {/* Feedback History Section */}
      {teacherId && (
        <FeedbackHistory
          teacherId={teacherId}
          isTeacherView={false}
          onReply={(message) => {
            setShowFeedbackComposer(true);
          }}
        />
      )}

      {/* AI Learning History */}
      {teacherId && <AILearningHistoryTimeline teacherId={teacherId} />}

      {/* Feedback Composer Modal */}
      {showFeedbackComposer && teacherId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="max-w-lg w-full">
            <FeedbackComposer
              teacherId={teacherId}
              teacherName={detail.teacher.name}
              onSuccess={() => setShowFeedbackComposer(false)}
              onCancel={() => setShowFeedbackComposer(false)}
            />
          </div>
        </div>
      )}

      {/* Observation Timeline */}
      {detail.observationHistory.length > 0 && (
        <Card>
          <CardTitle>Observation History</CardTitle>
          <div className="mt-4 space-y-4">
            {detail.observationHistory.slice(0, 10).map((obs) => (
              <div key={obs.id} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      obs.type === 'ai' ? 'bg-purple-100' : 'bg-primary-100'
                    }`}
                  >
                    {obs.type === 'ai' ? (
                      <BookOpen className="w-4 h-4 text-purple-600" />
                    ) : (
                      <Calendar className="w-4 h-4 text-primary-600" />
                    )}
                  </div>
                  <div className="w-0.5 h-full bg-gray-200 mt-2" />
                </div>
                <div className="flex-1 pb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">
                      {obs.type === 'ai' ? 'AI Analysis' : obs.observerName}
                    </span>
                    <span className="text-xs text-gray-500">
                      {format(new Date(obs.date), 'MMM d, yyyy')}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 mt-1">{obs.summary}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {obs.elementsObserved.length} element
                    {obs.elementsObserved.length !== 1 && 's'} observed
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};

export default TeacherDashboard;
