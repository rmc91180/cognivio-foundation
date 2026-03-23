import React, { useState } from 'react';
import { clsx } from 'clsx';
import {
  Send,
  Star,
  MessageSquare,
  AlertCircle,
  ArrowRight,
  X,
  Link,
  CheckSquare,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useTeacherFeedbackStore } from '@/store/teacherFeedbackStore';
import type { FeedbackType, FeedbackPriority } from '@/types';

interface FeedbackComposerProps {
  teacherId: string;
  teacherName?: string;
  observationId?: string;
  elementId?: string;
  suggestionId?: string;
  videoId?: string;
  parentMessageId?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
  className?: string;
}

export const FeedbackComposer: React.FC<FeedbackComposerProps> = ({
  teacherId,
  teacherName,
  observationId,
  elementId,
  suggestionId,
  videoId,
  parentMessageId,
  onSuccess,
  onCancel,
  className,
}) => {
  const { sendFeedback, replyToMessage, isSending, error } =
    useTeacherFeedbackStore();

  const [formData, setFormData] = useState({
    feedbackType: 'coaching' as FeedbackType,
    priority: 'normal' as FeedbackPriority,
    subject: '',
    message: '',
    requiresAcknowledgment: false,
  });

  const [showAdvanced, setShowAdvanced] = useState(false);

  const feedbackTypes: {
    value: FeedbackType;
    label: string;
    icon: React.ReactNode;
    description: string;
  }[] = [
    {
      value: 'praise',
      label: 'Recognition',
      icon: <Star className="w-4 h-4" />,
      description: 'Acknowledge great performance',
    },
    {
      value: 'coaching',
      label: 'Coaching',
      icon: <MessageSquare className="w-4 h-4" />,
      description: 'Provide guidance and suggestions',
    },
    {
      value: 'action_required',
      label: 'Action Required',
      icon: <AlertCircle className="w-4 h-4" />,
      description: 'Request specific action',
    },
    {
      value: 'follow_up',
      label: 'Follow-up',
      icon: <ArrowRight className="w-4 h-4" />,
      description: 'Continue a previous conversation',
    },
    {
      value: 'general',
      label: 'General',
      icon: <MessageSquare className="w-4 h-4" />,
      description: 'General communication',
    },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.subject.trim() || !formData.message.trim()) {
      return;
    }

    try {
      if (parentMessageId) {
        await replyToMessage(parentMessageId, formData.message);
      } else {
        await sendFeedback({
          teacherId,
          observationId,
          elementId,
          suggestionId,
          videoId,
          feedbackType: formData.feedbackType,
          subject: formData.subject,
          message: formData.message,
          priority: formData.priority,
          requiresAcknowledgment: formData.requiresAcknowledgment,
        });
      }

      // Reset form
      setFormData({
        feedbackType: 'coaching',
        priority: 'normal',
        subject: '',
        message: '',
        requiresAcknowledgment: false,
      });

      onSuccess?.();
    } catch (err) {
      console.error('Failed to send feedback:', err);
    }
  };

  const isReply = !!parentMessageId;

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Send className="w-5 h-5 text-primary-600" />
            {isReply ? 'Reply' : 'Send Feedback'}
            {teacherName && (
              <span className="text-sm font-normal text-gray-500">
                to {teacherName}
              </span>
            )}
          </CardTitle>
          {onCancel && (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Feedback type selector (not shown for replies) */}
          {!isReply && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Feedback Type
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {feedbackTypes.map((type) => (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() =>
                      setFormData({ ...formData, feedbackType: type.value })
                    }
                    className={clsx(
                      'flex flex-col items-center p-3 rounded-lg border transition-all',
                      formData.feedbackType === type.value
                        ? 'border-primary-500 bg-primary-50 text-primary-700'
                        : 'border-gray-200 hover:border-gray-300'
                    )}
                  >
                    {type.icon}
                    <span className="text-xs mt-1">{type.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Subject (not shown for replies) */}
          {!isReply && (
            <div>
              <label
                htmlFor="subject"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Subject
              </label>
              <input
                id="subject"
                type="text"
                value={formData.subject}
                onChange={(e) =>
                  setFormData({ ...formData, subject: e.target.value })
                }
                placeholder="Enter a subject for this feedback..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                required
              />
            </div>
          )}

          {/* Message */}
          <div>
            <label
              htmlFor="message"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Message
            </label>
            <textarea
              id="message"
              value={formData.message}
              onChange={(e) =>
                setFormData({ ...formData, message: e.target.value })
              }
              placeholder={
                isReply
                  ? 'Write your reply...'
                  : 'Write your feedback message...'
              }
              rows={4}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              required
            />
          </div>

          {/* Advanced options (not shown for replies) */}
          {!isReply && (
            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
              >
                {showAdvanced ? 'Hide' : 'Show'} advanced options
              </button>

              {showAdvanced && (
                <div className="mt-3 p-3 bg-gray-50 rounded-lg space-y-3">
                  {/* Priority */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Priority
                    </label>
                    <div className="flex gap-2">
                      {(['low', 'normal', 'high'] as FeedbackPriority[]).map(
                        (priority) => (
                          <button
                            key={priority}
                            type="button"
                            onClick={() =>
                              setFormData({ ...formData, priority })
                            }
                            className={clsx(
                              'px-3 py-1.5 text-sm rounded-lg border transition-all capitalize',
                              formData.priority === priority
                                ? priority === 'high'
                                  ? 'border-red-500 bg-red-50 text-red-700'
                                  : priority === 'low'
                                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                                  : 'border-primary-500 bg-primary-50 text-primary-700'
                                : 'border-gray-200 hover:border-gray-300'
                            )}
                          >
                            {priority}
                          </button>
                        )
                      )}
                    </div>
                  </div>

                  {/* Requires acknowledgment */}
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.requiresAcknowledgment}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          requiresAcknowledgment: e.target.checked,
                        })
                      }
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm text-gray-700">
                      Require acknowledgment from teacher
                    </span>
                  </label>

                  {/* Linked items indicator */}
                  {(observationId || elementId || videoId || suggestionId) && (
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <Link className="w-4 h-4" />
                      <span>
                        Linked to:{' '}
                        {[
                          observationId && 'Observation',
                          elementId && 'Element',
                          videoId && 'Video',
                          suggestionId && 'Suggestion',
                        ]
                          .filter(Boolean)
                          .join(', ')}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* Submit button */}
          <div className="flex items-center justify-end gap-2">
            {onCancel && (
              <Button
                type="button"
                variant="secondary"
                onClick={onCancel}
                disabled={isSending}
              >
                Cancel
              </Button>
            )}
            <Button
              type="submit"
              variant="primary"
              isLoading={isSending}
              disabled={
                !formData.message.trim() || (!isReply && !formData.subject.trim())
              }
              leftIcon={<Send className="w-4 h-4" />}
            >
              {isReply ? 'Send Reply' : 'Send Feedback'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};

export default FeedbackComposer;
