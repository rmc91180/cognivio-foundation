import React from 'react';
import { clsx } from 'clsx';

interface AIConfidenceBadgeProps {
  confidence?: number | null;
  showLabel?: boolean;
  className?: string;
}

function normalizeConfidence(confidence?: number | null): number | null {
  if (confidence == null || Number.isNaN(confidence)) return null;
  return confidence > 1 ? Math.min(confidence / 100, 1) : Math.max(confidence, 0);
}

export const AIConfidenceBadge: React.FC<AIConfidenceBadgeProps> = ({
  confidence,
  showLabel = true,
  className,
}) => {
  const normalized = normalizeConfidence(confidence);
  if (normalized == null) {
    return (
      <span
        className={clsx(
          'inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] text-gray-500',
          className
        )}
      >
        Confidence n/a
      </span>
    );
  }

  const percent = Math.round(normalized * 100);
  const level =
    percent >= 80 ? 'high' : percent >= 55 ? 'medium' : 'low';

  const colorMap: Record<string, string> = {
    high: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    medium: 'bg-amber-100 text-amber-700 border-amber-200',
    low: 'bg-rose-100 text-rose-700 border-rose-200',
  };

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-medium',
        colorMap[level],
        className
      )}
    >
      {showLabel && <span>Confidence</span>}
      <span>{percent}%</span>
    </span>
  );
};

export default AIConfidenceBadge;
