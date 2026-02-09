import React from 'react';
import { clsx } from 'clsx';
import type { StatusColor } from '@/types';

interface ColorChipProps {
  color: StatusColor;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  showTooltip?: boolean;
  tooltipContent?: string;
  onClick?: () => void;
  className?: string;
}

const sizeClasses = {
  sm: 'w-3 h-3 text-[10px]',
  md: 'w-4 h-4 text-[11px]',
  lg: 'w-6 h-6 text-xs',
};

const colorClasses = {
  green: 'bg-green-100 text-green-700 border-green-500 bg-status-green',
  yellow: 'bg-yellow-100 text-yellow-700 border-yellow-500 bg-status-yellow',
  red: 'bg-red-100 text-red-700 border-red-500 bg-status-red',
  gray: 'bg-gray-400 text-gray-700 border-gray-500 bg-status-gray',
};

export const ColorChip: React.FC<ColorChipProps> = ({
  color,
  size = 'md',
  label,
  showTooltip = false,
  tooltipContent,
  onClick,
  className,
}) => {
  const [showTip, setShowTip] = React.useState(false);

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={onClick}
        onMouseEnter={() => setShowTip(true)}
        onMouseLeave={() => setShowTip(false)}
        onFocus={() => setShowTip(true)}
        onBlur={() => setShowTip(false)}
        className={clsx(
          'rounded-full border-2 flex items-center justify-center font-bold transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500',
          sizeClasses[size],
          colorClasses[color] || colorClasses.gray,
          onClick && 'cursor-pointer',
          className
        )}
        role="status"
        aria-label={`Status: ${color}`}
      >
        {label ?? (color === 'green' ? '✓' : color === 'yellow' ? '!' : color === 'red' ? '✕' : '')}
      </button>

      {showTooltip && showTip && tooltipContent && (
        <div
          role="tooltip"
          className="absolute z-50 px-3 py-2 text-sm bg-gray-900 text-white rounded-lg shadow-lg -top-2 left-1/2 transform -translate-x-1/2 -translate-y-full whitespace-nowrap"
        >
          {tooltipContent}
          <div className="absolute left-1/2 transform -translate-x-1/2 top-full border-4 border-transparent border-t-gray-900" />
        </div>
      )}
    </div>
  );
};

export default ColorChip;
