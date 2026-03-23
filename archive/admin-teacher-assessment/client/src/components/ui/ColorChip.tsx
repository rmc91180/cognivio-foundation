import React from 'react';
import { clsx } from 'clsx';
import type { StatusColor } from '@/types';

interface ColorChipProps {
  color: StatusColor;
  size?: 'sm' | 'md' | 'lg';
  showTooltip?: boolean;
  tooltipContent?: string;
  onClick?: () => void;
  className?: string;
}

const sizeClasses = {
  sm: 'w-6 h-6 text-xs',
  md: 'w-8 h-8 text-sm',
  lg: 'w-10 h-10 text-base',
};

const colorClasses = {
  green: 'bg-green-100 text-green-700 border-green-500',
  yellow: 'bg-yellow-100 text-yellow-700 border-yellow-500',
  red: 'bg-red-100 text-red-700 border-red-500',
};

export const ColorChip: React.FC<ColorChipProps> = ({
  color,
  size = 'md',
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
          colorClasses[color],
          onClick && 'cursor-pointer',
          className
        )}
        aria-label={`Status: ${color}`}
      >
        {color === 'green' && '✓'}
        {color === 'yellow' && '!'}
        {color === 'red' && '✕'}
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
