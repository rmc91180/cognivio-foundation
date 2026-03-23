import React, { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import {
  Brain,
  Sparkles,
  AlertTriangle,
  CheckCircle,
  ThumbsUp,
  ThumbsDown,
  X,
  Filter,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Calendar,
  User,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { AIConfidenceBadge } from '@/components/ai/AIConfidenceBadge';
import { SuggestionImpactTag } from '@/components/ai/SuggestionImpactTag';
import { useSuggestionsStore } from '@/store/suggestionsStore';
import type {
  AISuggestion,
  SuggestionStatus,
  SuggestionPriority,
  SuggestionType,
} from '@/types';

interface AIReviewQueueProps {
  onViewTeacher?: (teacherId: string) => void;
  onViewObservation?: (observationId: string) => void;
  className?: string;
}

interface RejectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
  isSubmitting: boolean;
}

const RejectModal: React.FC<RejectModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
}) => {
  const [reason, setReason] = useState('');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
        <h3 className="font-heading font-semibold text-lg mb-4">
          Reject Suggestion
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          Please provide a reason for rejecting this suggestion. This helps
          improve future AI recommendations.
        </p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Enter rejection reason..."
          className="w-full border border-gray-300 rounded-lg p-3 text-sm resize-none h-24 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        />
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => onSubmit(reason)}
            isLoading={isSubmitting}
            disabled={!reason.trim()}
          >
            Reject
          </Button>
        </div>
      </div>
    </div>
  );
};

export const AIReviewQueue: React.FC<AIReviewQueueProps> = ({
  onViewTeacher,
  onViewObservation,
  className,
}) => {
  const {
    suggestions,
    totalSuggestions,
    currentPage,
    pageSize,
    isLoading,
    error,
    stats,
    fetchSuggestions,
    fetchStats,
    acceptSuggestion,
    rejectSuggestion,
  } = useSuggestionsStore();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [selectedForReject, setSelectedForReject] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [filters, setFilters] = useState<{
    status?: SuggestionStatus;
    priority?: SuggestionPriority;
    suggestionType?: SuggestionType;
  }>({
    status: 'pending',
  });
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    fetchSuggestions(filters);
    fetchStats();
  }, [filters]);

  const handleAccept = async (id: string) => {
    setIsSubmitting(true);
    try {
      await acceptSuggestion(id);
    } catch (err) {
      console.error('Failed to accept suggestion:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async (reason: string) => {
    if (!selectedForReject) return;
    setIsSubmitting(true);
    try {
      await rejectSuggestion(selectedForReject, reason);
      setRejectModalOpen(false);
      setSelectedForReject(null);
    } catch (err) {
      console.error('Failed to reject suggestion:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const openRejectModal = (id: string) => {
    setSelectedForReject(id);
    setRejectModalOpen(true);
  };

  const typeIcons = {
    observation: Brain,
    coaching: Sparkles,
    resource: CheckCircle,
    intervention: AlertTriangle,
    recognition: ThumbsUp,
  };

  const SuggestionCard = ({ suggestion }: { suggestion: AISuggestion }) => {
    const isExpanded = expandedId === suggestion.id;
    const Icon = typeIcons[suggestion.suggestionType] || Brain;

    return (
      <div
        className={clsx(
          'border rounded-lg transition-all',
          isExpanded ? 'border-primary-300 bg-primary-50/30' : 'border-gray-200'
        )}
      >
        {/* Header */}
        <div
          className="p-4 cursor-pointer"
          onClick={() => setExpandedId(isExpanded ? null : suggestion.id)}
        >
          <div className="flex items-start gap-3">
            <div
              className={clsx(
                'w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0',
                suggestion.priority === 'high'
                  ? 'bg-red-100'
                  : suggestion.priority === 'medium'
                  ? 'bg-yellow-100'
                  : 'bg-gray-100'
              )}
            >
              <Icon
                className={clsx(
                  'w-5 h-5',
                  suggestion.priority === 'high'
                    ? 'text-red-600'
                    : suggestion.priority === 'medium'
                    ? 'text-yellow-600'
                    : 'text-gray-600'
                )}
              />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="font-medium text-gray-900">{suggestion.title}</h4>
                <SuggestionImpactTag
                  priority={suggestion.priority}
                  pattern={suggestion.patternDetected}
                />
              </div>

              <p className="text-sm text-gray-500 mt-1 line-clamp-2">
                {suggestion.description}
              </p>

              <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                {suggestion.teacherId && (
                  <button
                    className="flex items-center gap-1 hover:text-primary-600"
                    onClick={(e) => {
                      e.stopPropagation();
                      onViewTeacher?.(suggestion.teacherId);
                    }}
                  >
                    <User className="w-3 h-3" />
                    View Teacher
                  </button>
                )}
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {new Date(suggestion.createdAt).toLocaleDateString()}
                </span>
                <AIConfidenceBadge confidence={suggestion.confidenceScore} />
              </div>
            </div>

            {isExpanded ? (
              <ChevronUp className="w-5 h-5 text-gray-400 flex-shrink-0" />
            ) : (
              <ChevronDown className="w-5 h-5 text-gray-400 flex-shrink-0" />
            )}
          </div>
        </div>

        {/* Expanded content */}
        {isExpanded && (
          <div className="px-4 pb-4 border-t border-gray-100">
            {/* Rationale */}
            {suggestion.rationale && (
              <div className="mt-4">
                <h5 className="text-sm font-medium text-gray-700 mb-1">
                  Rationale
                </h5>
                <p className="text-sm text-gray-600">{suggestion.rationale}</p>
              </div>
            )}

            {/* Action items */}
            {suggestion.actionItems && suggestion.actionItems.length > 0 && (
              <div className="mt-4">
                <h5 className="text-sm font-medium text-gray-700 mb-2">
                  Recommended Actions
                </h5>
                <ul className="space-y-1">
                  {suggestion.actionItems.map((item, i) => (
                    <li
                      key={i}
                      className="text-sm text-gray-600 flex items-start gap-2"
                    >
                      <span className="w-5 h-5 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center flex-shrink-0 text-xs font-medium">
                        {i + 1}
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Evidence basis */}
            {suggestion.evidenceBasis && (
              <div className="mt-4">
                <h5 className="text-sm font-medium text-gray-700 mb-1">
                  Evidence
                </h5>
                <div className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg">
                  {suggestion.evidenceBasis.observationCount && (
                    <p>
                      Based on {suggestion.evidenceBasis.observationCount}{' '}
                      observations
                    </p>
                  )}
                  {suggestion.evidenceBasis.trendPeriods && (
                    <p>
                      Analyzed over {suggestion.evidenceBasis.trendPeriods}{' '}
                      periods
                    </p>
                  )}
                  {suggestion.evidenceBasis.keyFindings &&
                    suggestion.evidenceBasis.keyFindings.length > 0 && (
                      <ul className="list-disc list-inside mt-1">
                        {suggestion.evidenceBasis.keyFindings.map(
                          (finding, i) => (
                            <li key={i}>{finding}</li>
                          )
                        )}
                      </ul>
                    )}
                </div>
              </div>
            )}

            {/* Actions */}
            {suggestion.status === 'pending' && (
              <div className="mt-4 flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  leftIcon={<ThumbsUp className="w-4 h-4" />}
                  onClick={() => handleAccept(suggestion.id)}
                  disabled={isSubmitting}
                >
                  Accept
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<ThumbsDown className="w-4 h-4" />}
                  onClick={() => openRejectModal(suggestion.id)}
                  disabled={isSubmitting}
                >
                  Reject
                </Button>
              </div>
            )}

            {suggestion.status === 'accepted' && (
              <div className="mt-4 flex items-center gap-2 text-sm text-green-600">
                <CheckCircle className="w-4 h-4" />
                Accepted on{' '}
                {new Date(suggestion.acceptedAt!).toLocaleDateString()}
              </div>
            )}

            {suggestion.status === 'rejected' && (
              <div className="mt-4 text-sm text-red-600">
                <div className="flex items-center gap-2">
                  <X className="w-4 h-4" />
                  Rejected on{' '}
                  {new Date(suggestion.rejectedAt!).toLocaleDateString()}
                </div>
                {suggestion.feedbackNotes && (
                  <p className="mt-1 text-gray-500">
                    Reason: {suggestion.feedbackNotes}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <Card className={className}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-primary-600" />
              AI Review Queue
              {stats && stats.pending > 0 && (
                <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-primary-100 text-primary-700 rounded-full">
                  {stats.pending} pending
                </span>
              )}
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Filter className="w-4 h-4" />}
              onClick={() => setShowFilters(!showFilters)}
            >
              Filters
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          {/* Filters */}
          {showFilters && (
            <div className="flex flex-wrap gap-2 mb-4 p-3 bg-gray-50 rounded-lg">
              <select
                value={filters.status || ''}
                onChange={(e) =>
                  setFilters({
                    ...filters,
                    status: (e.target.value || undefined) as SuggestionStatus,
                  })
                }
                className="text-sm border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="accepted">Accepted</option>
                <option value="rejected">Rejected</option>
                <option value="completed">Completed</option>
                <option value="expired">Expired</option>
              </select>

              <select
                value={filters.priority || ''}
                onChange={(e) =>
                  setFilters({
                    ...filters,
                    priority: (e.target.value || undefined) as SuggestionPriority,
                  })
                }
                className="text-sm border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">All Priorities</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>

              <select
                value={filters.suggestionType || ''}
                onChange={(e) =>
                  setFilters({
                    ...filters,
                    suggestionType: (e.target.value ||
                      undefined) as SuggestionType,
                  })
                }
                className="text-sm border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">All Types</option>
                <option value="observation">Observation</option>
                <option value="coaching">Coaching</option>
                <option value="resource">Resource</option>
                <option value="intervention">Intervention</option>
                <option value="recognition">Recognition</option>
              </select>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFilters({ status: 'pending' })}
              >
                Reset
              </Button>
            </div>
          )}

          {/* Stats summary */}
          {stats && (
            <div className="grid grid-cols-4 gap-2 mb-4">
              <div className="text-center p-2 bg-yellow-50 rounded-lg">
                <p className="text-lg font-bold text-yellow-700">
                  {stats.pending}
                </p>
                <p className="text-xs text-yellow-600">Pending</p>
              </div>
              <div className="text-center p-2 bg-green-50 rounded-lg">
                <p className="text-lg font-bold text-green-700">
                  {stats.accepted}
                </p>
                <p className="text-xs text-green-600">Accepted</p>
              </div>
              <div className="text-center p-2 bg-red-50 rounded-lg">
                <p className="text-lg font-bold text-red-700">
                  {stats.rejected}
                </p>
                <p className="text-xs text-red-600">Rejected</p>
              </div>
              <div className="text-center p-2 bg-blue-50 rounded-lg">
                <p className="text-lg font-bold text-blue-700">
                  {stats.completed}
                </p>
                <p className="text-xs text-blue-600">Completed</p>
              </div>
            </div>
          )}

          {/* Loading state */}
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <div className="animate-pulse flex flex-col items-center gap-2">
                <div className="w-8 h-8 bg-gray-200 rounded-full" />
                <div className="w-24 h-3 bg-gray-200 rounded" />
              </div>
            </div>
          )}

          {/* Error state */}
          {error && (
            <div className="text-center py-6">
              <AlertTriangle className="w-12 h-12 text-red-300 mx-auto mb-2" />
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* Suggestions list */}
          {!isLoading && !error && (
            <div className="space-y-3">
              {suggestions.map((suggestion) => (
                <SuggestionCard key={suggestion.id} suggestion={suggestion} />
              ))}
            </div>
          )}

          {/* Empty state */}
          {!isLoading && !error && suggestions.length === 0 && (
            <div className="text-center py-8">
              <CheckCircle className="w-12 h-12 text-green-300 mx-auto mb-2" />
              <p className="text-sm text-gray-600">
                No suggestions to review.
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {filters.status === 'pending'
                  ? "You're all caught up!"
                  : 'Try adjusting your filters.'}
              </p>
            </div>
          )}

          {/* Pagination */}
          {totalSuggestions > pageSize && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
              <p className="text-sm text-gray-500">
                Showing {(currentPage - 1) * pageSize + 1}-
                {Math.min(currentPage * pageSize, totalSuggestions)} of{' '}
                {totalSuggestions}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={currentPage === 1}
                  onClick={() =>
                    fetchSuggestions({ ...filters, page: currentPage - 1 })
                  }
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={currentPage * pageSize >= totalSuggestions}
                  onClick={() =>
                    fetchSuggestions({ ...filters, page: currentPage + 1 })
                  }
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <RejectModal
        isOpen={rejectModalOpen}
        onClose={() => {
          setRejectModalOpen(false);
          setSelectedForReject(null);
        }}
        onSubmit={handleReject}
        isSubmitting={isSubmitting}
      />
    </>
  );
};

export default AIReviewQueue;
