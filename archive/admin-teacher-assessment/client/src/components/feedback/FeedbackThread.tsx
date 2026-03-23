import React from 'react';
import { clsx } from 'clsx';
import { MessageSquare, CornerDownRight } from 'lucide-react';
import type { TeacherFeedbackMessage } from '@/types';

interface FeedbackThreadProps {
  messages: TeacherFeedbackMessage[];
  onReply?: (message: TeacherFeedbackMessage) => void;
  className?: string;
}

export const FeedbackThread: React.FC<FeedbackThreadProps> = ({
  messages,
  onReply,
  className,
}) => {
  if (!messages.length) {
    return (
      <div
        className={clsx(
          'flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500',
          className
        )}
      >
        <MessageSquare className="h-4 w-4" />
        No feedback thread yet.
      </div>
    );
  }

  return (
    <div className={clsx('space-y-3', className)}>
      {messages.map((message) => {
        const indent = Math.min(message.threadDepth || 0, 6);
        return (
          <div
            key={message.id}
            className={clsx(
              'rounded-lg border border-gray-200 bg-white p-3 shadow-sm',
              indent > 0 && 'bg-gray-50'
            )}
            style={{ marginLeft: indent * 12 }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-gray-600">
                {indent > 0 && <CornerDownRight className="h-3.5 w-3.5" />}
                <span className="font-medium text-gray-900">
                  {message.senderName || 'Staff'}
                </span>
                <span className="text-[11px] uppercase text-gray-400">
                  {message.feedbackType.replace(/_/g, ' ')}
                </span>
              </div>
              <span className="text-[11px] text-gray-400">
                {new Date(message.createdAt).toLocaleDateString()}
              </span>
            </div>
            <div className="mt-2 text-sm text-gray-700">{message.subject}</div>
            <div className="mt-1 text-xs text-gray-600 whitespace-pre-line">
              {message.message}
            </div>
            {onReply && (
              <button
                type="button"
                onClick={() => onReply(message)}
                className="mt-2 text-xs text-primary-600 hover:text-primary-700"
              >
                Reply
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default FeedbackThread;
