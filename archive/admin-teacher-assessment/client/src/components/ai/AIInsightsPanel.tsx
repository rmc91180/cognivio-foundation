import React, { useEffect } from 'react';
import { clsx } from 'clsx';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  CheckCircle,
  Brain,
  Sparkles,
  ThumbsUp,
  ThumbsDown,
  ChevronRight,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useTrendsStore } from '@/store/trendsStore';
import { useSuggestionsStore } from '@/store/suggestionsStore';
import type { TrendDirection, AISuggestion, RegressionAlert, ProgressReport } from '@/types';

interface AIInsightsPanelProps {
  teacherId: string;
  templateId?: string;
  showTrends?: boolean;
  showAlerts?: boolean;
  showSuggestions?: boolean;
  onSuggestionClick?: (suggestion: AISuggestion) => void;
  className?: string;
}

export const AIInsightsPanel: React.FC<AIInsightsPanelProps> = ({
  teacherId,
  templateId,
  showTrends = true,
  showAlerts = true,
  showSuggestions = true,
  onSuggestionClick,
  className,
}) => {
  const {
    trendData,
    regressionAlerts,
    progressReports,
    riskPrediction,
    isLoading: trendsLoading,
    fetchTeacherTrends,
    fetchRegressionAlerts,
    fetchProgressReports,
    fetchRiskPrediction,
  } = useTrendsStore();

  const {
    suggestions,
    isLoading: suggestionsLoading,
    fetchSuggestions,
  } = useSuggestionsStore();

  useEffect(() => {
    if (showTrends && teacherId) {
      fetchTeacherTrends(teacherId, { templateId });
    }
    if (showAlerts && teacherId) {
      fetchRegressionAlerts(teacherId);
      fetchProgressReports(teacherId);
      fetchRiskPrediction(teacherId);
    }
    if (showSuggestions && teacherId) {
      fetchSuggestions({ teacherId, status: 'pending', pageSize: 5 });
    }
  }, [teacherId, templateId, showTrends, showAlerts, showSuggestions]);

  const isLoading = trendsLoading || suggestionsLoading;

  // Calculate overall trend from trend data
  const overallTrend: TrendDirection = React.useMemo(() => {
    if (trendData.length < 2) return 'stable';
    const upCount = trendData.filter((t) => t.trendDirection === 'up').length;
    const downCount = trendData.filter((t) => t.trendDirection === 'down').length;
    if (upCount > downCount && upCount > trendData.length / 3) return 'up';
    if (downCount > upCount && downCount > trendData.length / 3) return 'down';
    return 'stable';
  }, [trendData]);

  // Get latest average score
  const latestAvgScore = React.useMemo(() => {
    if (trendData.length === 0) return null;
    const latest = trendData[trendData.length - 1];
    return latest?.averageScore;
  }, [trendData]);

  const TrendIndicator = ({ direction }: { direction: TrendDirection }) => {
    if (direction === 'up') {
      return (
        <div className="flex items-center gap-1 text-green-600">
          <TrendingUp className="w-4 h-4" />
          <span className="text-sm font-medium">Improving</span>
        </div>
      );
    }
    if (direction === 'down') {
      return (
        <div className="flex items-center gap-1 text-red-600">
          <TrendingDown className="w-4 h-4" />
          <span className="text-sm font-medium">Declining</span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1 text-gray-500">
        <Minus className="w-4 h-4" />
        <span className="text-sm font-medium">Stable</span>
      </div>
    );
  };

  const RiskIndicator = () => {
    if (!riskPrediction) return null;

    const riskColors: Record<string, string> = {
      low: 'bg-green-100 text-green-700 border-green-200',
      medium: 'bg-yellow-100 text-yellow-700 border-yellow-200',
      high: 'bg-red-100 text-red-700 border-red-200',
      critical: 'bg-red-200 text-red-800 border-red-300',
    };

    return (
      <div
        className={clsx(
          'px-3 py-2 rounded-lg border',
          riskColors[riskPrediction.riskLevel]
        )}
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Future Risk</span>
          <span className="text-sm capitalize">{riskPrediction.riskLevel}</span>
        </div>
        {riskPrediction.contributingFactors.length > 0 && (
          <p className="text-xs mt-1 opacity-75">
            {riskPrediction.contributingFactors[0]}
          </p>
        )}
      </div>
    );
  };

  const AlertItem = ({
    alert,
    type,
  }: {
    alert: RegressionAlert | ProgressReport;
    type: 'regression' | 'progress';
  }) => {
    const isRegression = type === 'regression';
    return (
      <div
        className={clsx(
          'flex items-start gap-2 p-2 rounded-lg',
          isRegression ? 'bg-red-50' : 'bg-green-50'
        )}
      >
        {isRegression ? (
          <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
        ) : (
          <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p
            className={clsx(
              'text-sm font-medium truncate',
              isRegression ? 'text-red-700' : 'text-green-700'
            )}
          >
            {alert.elementId}
          </p>
          <p
            className={clsx(
              'text-xs',
              isRegression ? 'text-red-600' : 'text-green-600'
            )}
          >
            {isRegression
              ? `${(alert as RegressionAlert).declinePercent.toFixed(1)}% decline`
              : `${(alert as ProgressReport).improvementPercent.toFixed(1)}% improvement`}
          </p>
        </div>
      </div>
    );
  };

  const SuggestionItem = ({ suggestion }: { suggestion: AISuggestion }) => {
    const priorityColors = {
      high: 'bg-red-100 text-red-700',
      medium: 'bg-yellow-100 text-yellow-700',
      low: 'bg-gray-100 text-gray-700',
    };

    const typeIcons = {
      observation: Brain,
      coaching: Sparkles,
      resource: CheckCircle,
      intervention: AlertTriangle,
      recognition: ThumbsUp,
    };

    const Icon = typeIcons[suggestion.suggestionType] || Brain;

    return (
      <div
        className="p-3 rounded-lg border border-gray-200 hover:border-primary-300 hover:bg-primary-50/50 cursor-pointer transition-colors"
        onClick={() => onSuggestionClick?.(suggestion)}
      >
        <div className="flex items-start gap-2">
          <Icon className="w-4 h-4 text-primary-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-medium text-gray-900 truncate">
                {suggestion.title}
              </h4>
              <span
                className={clsx(
                  'text-xs px-1.5 py-0.5 rounded-full',
                  priorityColors[suggestion.priority]
                )}
              >
                {suggestion.priority}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1 line-clamp-2">
              {suggestion.description}
            </p>
            {suggestion.confidenceScore && (
              <div className="flex items-center gap-1 mt-2">
                <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary-500 rounded-full"
                    style={{ width: `${suggestion.confidenceScore * 100}%` }}
                  />
                </div>
                <span className="text-xs text-gray-400">
                  {Math.round(suggestion.confidenceScore * 100)}%
                </span>
              </div>
            )}
          </div>
          <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-primary-600" />
            AI Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-pulse flex flex-col items-center gap-2">
              <div className="w-8 h-8 bg-gray-200 rounded-full" />
              <div className="w-24 h-3 bg-gray-200 rounded" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-primary-600" />
          AI Insights
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Overall Performance Summary */}
        {showTrends && (
          <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
            <div>
              <p className="text-sm text-gray-500">Overall Trend</p>
              <TrendIndicator direction={overallTrend} />
            </div>
            {latestAvgScore !== null && (
              <div className="text-right">
                <p className="text-sm text-gray-500">Latest Avg</p>
                <p className="text-2xl font-bold text-gray-900">
                  {latestAvgScore.toFixed(0)}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Risk Prediction */}
        {showAlerts && riskPrediction && <RiskIndicator />}

        {/* Regression Alerts */}
        {showAlerts && regressionAlerts.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">
              Areas Needing Attention
            </h4>
            <div className="space-y-2">
              {regressionAlerts.slice(0, 3).map((alert, i) => (
                <AlertItem key={i} alert={alert} type="regression" />
              ))}
            </div>
          </div>
        )}

        {/* Progress Reports */}
        {showAlerts && progressReports.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">
              Areas of Improvement
            </h4>
            <div className="space-y-2">
              {progressReports.slice(0, 3).map((report, i) => (
                <AlertItem key={i} alert={report} type="progress" />
              ))}
            </div>
          </div>
        )}

        {/* AI Suggestions */}
        {showSuggestions && suggestions.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">
              AI Recommendations
            </h4>
            <div className="space-y-2">
              {suggestions.slice(0, 3).map((suggestion) => (
                <SuggestionItem key={suggestion.id} suggestion={suggestion} />
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!isLoading &&
          trendData.length === 0 &&
          regressionAlerts.length === 0 &&
          progressReports.length === 0 &&
          suggestions.length === 0 && (
            <div className="text-center py-6">
              <Brain className="w-12 h-12 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">
                No insights available yet.
              </p>
              <p className="text-xs text-gray-400">
                Complete more observations to generate insights.
              </p>
            </div>
          )}
      </CardContent>
    </Card>
  );
};

export default AIInsightsPanel;
