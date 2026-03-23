import React, { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import {
  MessageSquare,
  Star,
  AlertCircle,
  ArrowRight,
  CheckCircle,
  Clock,
  Archive,
  MailOpen,
  Reply,
  ChevronDown,
  ChevronUp,
  Filter,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useTeacherFeedbackStore } from '@/store/teacherFeedbackStore';
import type { TeacherFeedbackMessage, FeedbackType, FeedbackPriority } from '@/types';

interface FeedbackHistoryProps {
  teacherId: string;
  isTeacherView?: boolean;
  onReply?: (message: TeacherFeedbackMessage) => void;
  onViewObservation?: (observationId: string) => void;
  className?: string;
}

export const FeedbackHistory: React.FC<FeedbackHistoryProps> = ({
  teacherId,
  isTeacherView = false,
  onReply,
  onViewObservation,
  className,
}) => {
  const {
    messages,
    totalMessages,
    currentPage,
    pageSize,
    unreadCount,
    isLoading,
    error,
    fetchMessages,
    fetchUnreadCount,
    markAsRead,
    acknowledgeMessage,
    archiveMessage,
  } = useTeacherFeedbackStore();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filters, setFilters] = useState<{
    feedbackType?: FeedbackType;
    isArchived?: boolean;
    unreadOnly?: boolean;
  }>({
    isArchived: false,
  });
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    fetchMessages(teacherId, filters);
    fetchUnreadCount(teacherId);
  }, [teacherId, filters]);

  const handleMarkAsRead = async (messageId: string) => {
    await markAsRead(messageId);
  };

  const handleAcknowledge = async (messageId: string) => {
    await acknowledgeMessage(messageId);
  };

  const handleArchive = async (messageId: string) => {
    await archiveMessage(messageId);
  };

  const feedbackTypeIcons: Record<FeedbackType, React.ReactNode> = {
    praise: <Star className="w-4 h-4 text-yellow-500" />,
    coaching: <MessageSquare className="w-4 h-4 text-blue-500" />,
    action_required: <AlertCircle className="w-4 h-4 text-red-500" />,
    follow_up: <ArrowRight className="w-4 h-4 text-purple-500" />,
    general: <MessageSquare className="w-4 h-4 text-gray-500" />,
  };

  const feedbackTypeLabels: Record<FeedbackType, string> = {
    praise: 'Recognition',
    coaching: 'Coaching',
    action_required: 'Action Required',
    follow_up: 'Follow-up',
    general: 'General',
  };

  const priorityColors: Record<FeedbackPriority, string> = {
    urgent: 'bg-red-200 text-red-800 border-red-300',
    high: 'bg-red-100 text-red-700 border-red-200',
    normal: 'bg-gray-100 text-gray-600 border-gray-200',
    low: 'bg-blue-100 text-blue-700 border-blue-200',
  };

  const MessageCard = ({ message }: { message: TeacherFeedbackMessage }) => {
    const isExpanded = expandedId === message.id;
    const isUnread = !message.readAt;
    const needsAck = message.requiresAcknowledgment && !message.acknowledgedAt;

    return (
      <div
        className={clsx(
          'border rounded-lg transition-all',
          isUnread && 'border-primary-300 bg-primary-50/30',
          !isUnread && 'border-gray-200',
          isExpanded && 'ring-1 ring-primary-300'
        )}
      >
        {/* Header */}
        <div
          className="p-4 cursor-pointer"
          onClick={() => {
            setExpandedId(isExpanded ? null : message.id);
            if (isUnread && isTeacherView) {
              handleMarkAsRead(message.id);
            }
          }}
        >
          <div className="flex items-start gap-3">
            <div
              className={clsx(
                'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0',
                message.feedbackType === 'praise' && 'bg-yellow-100',
                message.feedbackType === 'action_required' && 'bg-red-100',
                message.feedbackType === 'coaching' && 'bg-blue-100',
                message.feedbackType === 'follow_up' && 'bg-purple-100',
                message.feedbackType === 'general' && 'bg-gray-100'
              )}
            >
              {feedbackTypeIcons[message.feedbackType]}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h4
                  className={clsx(
                    'font-medium',
                    isUnread ? 'text-gray-900' : 'text-gray-700'
                  )}
                >
                  {message.subject}
                </h4>
                {isUnread && (
                  <span className="w-2 h-2 bg-primary-500 rounded-full" />
                )}
                <span
                  className={clsx(
                    'text-xs px-2 py-0.5 rounded-full border',
                    priorityColors[message.priority]
                  )}
                >
                  {message.priority === 'high' ? 'Urgent' : feedbackTypeLabels[message.feedbackType]}
                </span>
                {needsAck && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-200">
                    Needs Response
                  </span>
                )}
              </div>

              <p className="text-sm text-gray-500 mt-1 line-clamp-2">
                {message.message}
              </p>

              <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {new Date(message.createdAt).toLocaleDateString()}
                </span>
                {message.acknowledgedAt && (
                  <span className="flex items-center gap-1 text-green-600">
                    <CheckCircle className="w-3 h-3" />
                    Acknowledged
                  </span>
                )}
                {message.isArchived && (
                  <span className="flex items-center gap-1 text-gray-500">
                    <Archive className="w-3 h-3" />
                    Archived
                  </span>
                )}
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
            {/* Full message */}
            <div className="mt-4 p-3 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-700 whitespace-pre-wrap">
                {message.message}
              </p>
            </div>

            {/* Related links */}
            {(message.observationId || message.videoId) && (
              <div className="mt-4 flex items-center gap-2">
                {message.observationId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onViewObservation?.(message.observationId!)}
                  >
                    View Observation
                  </Button>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="mt-4 flex items-center gap-2">
              {isTeacherView && needsAck && (
                <Button
                  variant="primary"
                  size="sm"
                  leftIcon={<CheckCircle className="w-4 h-4" />}
                  onClick={() => handleAcknowledge(message.id)}
                >
                  Acknowledge
                </Button>
              )}

              {!isTeacherView && (
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<Reply className="w-4 h-4" />}
                  onClick={() => onReply?.(message)}
                >
                  Reply
                </Button>
              )}

              {!message.isArchived && (
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<Archive className="w-4 h-4" />}
                  onClick={() => handleArchive(message.id)}
                >
                  Archive
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-primary-600" />
            {isTeacherView ? 'My Feedback' : 'Feedback History'}
            {unreadCount > 0 && (
              <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-primary-100 text-primary-700 rounded-full">
                {unreadCount} unread
              </span>
            )}
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<Filter className="w-4 h-4" />}
            onClick={() => setShowFilters(!showFilters)}
          >
            Filter
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {/* Filters */}
        {showFilters && (
          <div className="flex flex-wrap gap-2 mb-4 p-3 bg-gray-50 rounded-lg">
            <select
              value={filters.feedbackType || ''}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  feedbackType: (e.target.value || undefined) as FeedbackType,
                })
              }
              className="text-sm border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">All Types</option>
              <option value="praise">Recognition</option>
              <option value="coaching">Coaching</option>
              <option value="action_required">Action Required</option>
              <option value="follow_up">Follow-up</option>
              <option value="general">General</option>
            </select>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={filters.unreadOnly || false}
                onChange={(e) =>
                  setFilters({ ...filters, unreadOnly: e.target.checked })
                }
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              Unread only
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={filters.isArchived || false}
                onChange={(e) =>
                  setFilters({ ...filters, isArchived: e.target.checked })
                }
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              Show archived
            </label>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFilters({ isArchived: false })}
            >
              Reset
            </Button>
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
            <AlertCircle className="w-12 h-12 text-red-300 mx-auto mb-2" />
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* Messages list */}
        {!isLoading && !error && (
          <div className="space-y-3">
            {messages.map((message) => (
              <MessageCard key={message.id} message={message} />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !error && messages.length === 0 && (
          <div className="text-center py-8">
            <MailOpen className="w-12 h-12 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-600">No feedback messages yet.</p>
            <p className="text-xs text-gray-400 mt-1">
              {isTeacherView
                ? "You'll see feedback from your principal here."
                : 'Send feedback to teachers to start a conversation.'}
            </p>
          </div>
        )}

        {/* Pagination */}
        {totalMessages > pageSize && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
            <p className="text-sm text-gray-500">
              Showing {(currentPage - 1) * pageSize + 1}-
              {Math.min(currentPage * pageSize, totalMessages)} of{' '}
              {totalMessages}
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={currentPage === 1}
                onClick={() =>
                  fetchMessages(teacherId, { ...filters, page: currentPage - 1 })
                }
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={currentPage * pageSize >= totalMessages}
                onClick={() =>
                  fetchMessages(teacherId, { ...filters, page: currentPage + 1 })
                }
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default FeedbackHistory;
