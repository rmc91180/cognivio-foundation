import React, { useEffect } from 'react';
import { clsx } from 'clsx';
import { Brain, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { useAIModelStore } from '@/store/aiModelStore';
import type { AILearningEntry } from '@/types';

interface AILearningHistoryTimelineProps {
  teacherId: string;
  className?: string;
}

const DeltaIcon = ({ delta }: { delta: number }) => {
  if (delta > 0) return <ArrowUpRight className="h-4 w-4 text-emerald-600" />;
  if (delta < 0) return <ArrowDownRight className="h-4 w-4 text-rose-600" />;
  return <Minus className="h-4 w-4 text-gray-400" />;
};

const LearningEntryRow = ({ entry }: { entry: AILearningEntry }) => {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3">
      <div className="mt-1">
        <DeltaIcon delta={entry.scoreDelta} />
      </div>
      <div className="flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-gray-900">
            {entry.elementName || entry.elementId}
          </div>
          <div className="text-[11px] text-gray-400">
            {new Date(entry.createdAt).toLocaleDateString()}
          </div>
        </div>
        <div className="mt-1 text-xs text-gray-600">
          AI score {entry.originalAiScore} → corrected {entry.correctedScore} (
          {entry.scoreDelta > 0 ? '+' : ''}
          {entry.scoreDelta})
        </div>
        <div className="mt-1 text-[11px] text-gray-500">
          Reviewer: {entry.reviewerName || entry.reviewerRole || 'Reviewer'} ·
          Model {entry.modelVersion || 'n/a'}
        </div>
      </div>
    </div>
  );
};

export const AILearningHistoryTimeline: React.FC<
  AILearningHistoryTimelineProps
> = ({ teacherId, className }) => {
  const {
    learningHistory,
    historyLoading,
    fetchLearningHistory,
  } = useAIModelStore();

  useEffect(() => {
    if (teacherId) {
      fetchLearningHistory(teacherId, { pageSize: 20 });
    }
  }, [teacherId]);

  return (
    <Card className={clsx(className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary-600" />
          AI Learning History
        </CardTitle>
      </CardHeader>
      <CardContent>
        {historyLoading ? (
          <div className="text-sm text-gray-500">Loading history…</div>
        ) : learningHistory.length === 0 ? (
          <div className="text-sm text-gray-500">
            No learning history yet.
          </div>
        ) : (
          <div className="space-y-3">
            {learningHistory.map((entry) => (
              <LearningEntryRow key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default AILearningHistoryTimeline;
