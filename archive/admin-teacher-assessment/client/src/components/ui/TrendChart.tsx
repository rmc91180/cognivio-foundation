import React, { useMemo } from 'react';
import { clsx } from 'clsx';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { StatusColor, TrendDirection } from '@/types';

interface DataPoint {
  date: string;
  score: number;
  label?: string;
}

interface TrendChartProps {
  data: DataPoint[];
  height?: number;
  showGrid?: boolean;
  showLabels?: boolean;
  showTrendIndicator?: boolean;
  thresholds?: {
    greenMin: number;
    yellowMin: number;
  };
  className?: string;
}

const DEFAULT_THRESHOLDS = {
  greenMin: 80,
  yellowMin: 60,
};

export const TrendChart: React.FC<TrendChartProps> = ({
  data,
  height = 120,
  showGrid = true,
  showLabels = true,
  showTrendIndicator = true,
  thresholds = DEFAULT_THRESHOLDS,
  className,
}) => {
  const chartWidth = 300;
  const padding = { top: 10, right: 10, bottom: 20, left: 30 };
  const chartHeight = height - padding.top - padding.bottom;
  const innerWidth = chartWidth - padding.left - padding.right;

  const { points, trend, minScore, maxScore } = useMemo(() => {
    if (data.length === 0) {
      return { points: [], trend: 'stable' as TrendDirection, minScore: 0, maxScore: 100 };
    }

    // Calculate min/max for scaling (with some padding)
    const scores = data.map((d) => d.score);
    const min = Math.max(0, Math.min(...scores) - 10);
    const max = Math.min(100, Math.max(...scores) + 10);

    // Calculate points
    const xStep = data.length > 1 ? innerWidth / (data.length - 1) : innerWidth;
    const yScale = (score: number) => {
      const range = max - min || 1;
      return chartHeight - ((score - min) / range) * chartHeight;
    };

    const pts = data.map((d, i) => ({
      x: padding.left + i * xStep,
      y: padding.top + yScale(d.score),
      ...d,
    }));

    // Calculate trend
    let trendDir: TrendDirection = 'stable';
    if (data.length >= 2) {
      const first = data[0].score;
      const last = data[data.length - 1].score;
      const diff = last - first;
      if (diff > 5) trendDir = 'up';
      else if (diff < -5) trendDir = 'down';
    }

    return { points: pts, trend: trendDir, minScore: min, maxScore: max };
  }, [data, chartHeight, innerWidth]);

  const getColorForScore = (score: number): StatusColor => {
    if (score >= thresholds.greenMin) return 'green';
    if (score >= thresholds.yellowMin) return 'yellow';
    return 'red';
  };

  const colorMap: Record<StatusColor, string> = {
    green: '#22c55e',
    yellow: '#eab308',
    red: '#ef4444',
  };

  // Generate SVG path
  const linePath = useMemo(() => {
    if (points.length === 0) return '';
    return points.reduce((path, point, i) => {
      return path + (i === 0 ? `M ${point.x} ${point.y}` : ` L ${point.x} ${point.y}`);
    }, '');
  }, [points]);

  // Generate area path (for gradient fill)
  const areaPath = useMemo(() => {
    if (points.length === 0) return '';
    const firstPoint = points[0];
    const lastPoint = points[points.length - 1];
    return (
      linePath +
      ` L ${lastPoint.x} ${padding.top + chartHeight}` +
      ` L ${firstPoint.x} ${padding.top + chartHeight}` +
      ' Z'
    );
  }, [linePath, points, chartHeight]);

  const TrendIcon = ({ direction }: { direction: TrendDirection }) => {
    if (direction === 'up')
      return <TrendingUp className="w-4 h-4 text-green-600" />;
    if (direction === 'down')
      return <TrendingDown className="w-4 h-4 text-red-600" />;
    return <Minus className="w-4 h-4 text-gray-400" />;
  };

  if (data.length === 0) {
    return (
      <div
        className={clsx(
          'flex items-center justify-center text-sm text-gray-400',
          className
        )}
        style={{ height }}
      >
        No trend data available
      </div>
    );
  }

  return (
    <div className={clsx('relative', className)}>
      <svg
        viewBox={`0 0 ${chartWidth} ${height}`}
        className="w-full"
        style={{ height }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id="areaGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#4F46E5" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#4F46E5" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {showGrid && (
          <g className="stroke-gray-100">
            {/* Horizontal grid lines at threshold levels */}
            <line
              x1={padding.left}
              y1={padding.top + chartHeight * (1 - (thresholds.greenMin - minScore) / (maxScore - minScore))}
              x2={chartWidth - padding.right}
              y2={padding.top + chartHeight * (1 - (thresholds.greenMin - minScore) / (maxScore - minScore))}
              strokeDasharray="4 4"
              className="stroke-green-200"
            />
            <line
              x1={padding.left}
              y1={padding.top + chartHeight * (1 - (thresholds.yellowMin - minScore) / (maxScore - minScore))}
              x2={chartWidth - padding.right}
              y2={padding.top + chartHeight * (1 - (thresholds.yellowMin - minScore) / (maxScore - minScore))}
              strokeDasharray="4 4"
              className="stroke-yellow-200"
            />
          </g>
        )}

        {/* Area fill */}
        <path d={areaPath} fill="url(#areaGradient)" />

        {/* Line */}
        <path
          d={linePath}
          fill="none"
          stroke="#4F46E5"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Data points */}
        {points.map((point, i) => (
          <g key={i}>
            <circle
              cx={point.x}
              cy={point.y}
              r="4"
              fill={colorMap[getColorForScore(point.score)]}
              stroke="white"
              strokeWidth="2"
            />
            {/* Tooltip hover area */}
            <circle
              cx={point.x}
              cy={point.y}
              r="10"
              fill="transparent"
              className="cursor-pointer"
            >
              <title>
                {point.label || point.date}: {point.score}%
              </title>
            </circle>
          </g>
        ))}

        {/* Y-axis labels */}
        {showLabels && (
          <g className="fill-gray-400 text-xs">
            <text x={padding.left - 5} y={padding.top + 4} textAnchor="end">
              {Math.round(maxScore)}
            </text>
            <text
              x={padding.left - 5}
              y={padding.top + chartHeight}
              textAnchor="end"
            >
              {Math.round(minScore)}
            </text>
          </g>
        )}

        {/* X-axis labels (first and last) */}
        {showLabels && points.length > 1 && (
          <g className="fill-gray-400 text-xs">
            <text
              x={points[0].x}
              y={height - 4}
              textAnchor="start"
            >
              {formatDate(points[0].date)}
            </text>
            <text
              x={points[points.length - 1].x}
              y={height - 4}
              textAnchor="end"
            >
              {formatDate(points[points.length - 1].date)}
            </text>
          </g>
        )}
      </svg>

      {/* Trend indicator */}
      {showTrendIndicator && (
        <div className="absolute top-0 right-0 flex items-center gap-1 text-xs">
          <TrendIcon direction={trend} />
          <span
            className={clsx(
              trend === 'up' && 'text-green-600',
              trend === 'down' && 'text-red-600',
              trend === 'stable' && 'text-gray-500'
            )}
          >
            {trend === 'up' && 'Improving'}
            {trend === 'down' && 'Declining'}
            {trend === 'stable' && 'Stable'}
          </span>
        </div>
      )}
    </div>
  );
};

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

export default TrendChart;
