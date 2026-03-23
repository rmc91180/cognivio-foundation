import React from 'react';
import { clsx } from 'clsx';
import type { SuggestionPriority, PatternType } from '@/types';

interface SuggestionImpactTagProps {
  priority?: SuggestionPriority;
  pattern?: PatternType;
  className?: string;
}

const PRIORITY_STYLES: Record<SuggestionPriority, string> = {
  high: 'bg-rose-100 text-rose-700 border-rose-200',
  medium: 'bg-amber-100 text-amber-700 border-amber-200',
  low: 'bg-emerald-100 text-emerald-700 border-emerald-200',
};

const PATTERN_LABELS: Partial<Record<PatternType, string>> = {
  declining_trend: 'Declining trend',
  consistent_low: 'Consistent low',
  improvement_stall: 'Growth stalled',
  high_performer: 'High performer',
  volatile_scores: 'Volatile scores',
  new_teacher: 'New teacher',
};

export const SuggestionImpactTag: React.FC<SuggestionImpactTagProps> = ({
  priority = 'medium',
  pattern,
  className,
}) => {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-medium',
        PRIORITY_STYLES[priority],
        className
      )}
    >
      <span className="capitalize">{priority}</span>
      {pattern ? (
        <span className="text-[10px] opacity-75">
          {PATTERN_LABELS[pattern] || pattern.replace(/_/g, ' ')}
        </span>
      ) : null}
    </span>
  );
};

export default SuggestionImpactTag;
