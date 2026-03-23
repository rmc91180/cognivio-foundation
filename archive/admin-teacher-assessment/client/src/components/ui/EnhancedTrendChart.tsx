import React, { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  ChevronDown,
} from 'lucide-react';
import type { TrendDirection, PeriodType, TrendDataPoint } from '@/types';

interface EnhancedTrendChartProps {
  data: TrendDataPoint[];
  schoolAverage?: number[];
  height?: number;
  showGrid?: boolean;
  showLabels?: boolean;
  showTrendIndicator?: boolean;
  showSchoolComparison?: boolean;
  showRegressionZones?: boolean;
  periodType?: PeriodType;
  onPeriodChange?: (period: PeriodType) => void;
  regressionThreshold?: number;
  progressThreshold?: number;
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

export const EnhancedTrendChart: React.FC<EnhancedTrendChartProps> = ({
  data,
  schoolAverage,
  height = 180,
  showGrid = true,
  showLabels = true,
  showTrendIndicator = true,
  showSchoolComparison = true,
  showRegressionZones = true,
  periodType = 'month',
  onPeriodChange,
  regressionThreshold = -10,
  progressThreshold = 10,
  thresholds = DEFAULT_THRESHOLDS,
  className,
}) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const chartWidth = 400;
  const padding = { top: 20, right: 20, bottom: 30, left: 40 };
  const chartHeight = height - padding.top - padding.bottom;
  const innerWidth = chartWidth - padding.left - padding.right;

  const { points, schoolPoints, trend, minScore, maxScore, regressionZones, progressZones } =
    useMemo(() => {
      if (data.length === 0) {
        return {
          points: [],
          schoolPoints: [],
          trend: 'stable' as TrendDirection,
          minScore: 0,
          maxScore: 100,
          regressionZones: [],
          progressZones: [],
        };
      }

      // Calculate min/max for scaling
      const scores = data.map((d) => d.averageScore);
      const allScores = schoolAverage ? [...scores, ...schoolAverage] : scores;
      const min = Math.max(0, Math.min(...allScores) - 10);
      const max = Math.min(100, Math.max(...allScores) + 10);

      // Calculate points
      const xStep = data.length > 1 ? innerWidth / (data.length - 1) : innerWidth;
      const yScale = (score: number) => {
        const range = max - min || 1;
        return chartHeight - ((score - min) / range) * chartHeight;
      };

      const pts = data.map((d, i) => ({
        x: padding.left + i * xStep,
        y: padding.top + yScale(d.averageScore),
        ...d,
      }));

      const schoolPts = schoolAverage
        ? schoolAverage.map((score, i) => ({
            x: padding.left + i * xStep,
            y: padding.top + yScale(score),
            score,
          }))
        : [];

      // Calculate trend
      let trendDir: TrendDirection = 'stable';
      if (data.length >= 2) {
        const first = data[0].averageScore;
        const last = data[data.length - 1].averageScore;
        const diff = last - first;
        if (diff > 5) trendDir = 'up';
        else if (diff < -5) trendDir = 'down';
      }

      // Identify regression and progress zones
      const regZones: { start: number; end: number }[] = [];
      const progZones: { start: number; end: number }[] = [];

      for (let i = 1; i < data.length; i++) {
        const change =
          ((data[i].averageScore - data[i - 1].averageScore) /
            data[i - 1].averageScore) *
          100;
        if (change <= regressionThreshold) {
          if (regZones.length > 0 && regZones[regZones.length - 1].end === i - 1) {
            regZones[regZones.length - 1].end = i;
          } else {
            regZones.push({ start: i - 1, end: i });
          }
        }
        if (change >= progressThreshold) {
          if (progZones.length > 0 && progZones[progZones.length - 1].end === i - 1) {
            progZones[progZones.length - 1].end = i;
          } else {
            progZones.push({ start: i - 1, end: i });
          }
        }
      }

      return {
        points: pts,
        schoolPoints: schoolPts,
        trend: trendDir,
        minScore: min,
        maxScore: max,
        regressionZones: regZones,
        progressZones: progZones,
      };
    }, [data, schoolAverage, chartHeight, innerWidth, regressionThreshold, progressThreshold]);

  // Generate SVG paths
  const linePath = useMemo(() => {
    if (points.length === 0) return '';
    return points.reduce((path, point, i) => {
      return path + (i === 0 ? `M ${point.x} ${point.y}` : ` L ${point.x} ${point.y}`);
    }, '');
  }, [points]);

  const schoolLinePath = useMemo(() => {
    if (schoolPoints.length === 0) return '';
    return schoolPoints.reduce((path, point, i) => {
      return path + (i === 0 ? `M ${point.x} ${point.y}` : ` L ${point.x} ${point.y}`);
    }, '');
  }, [schoolPoints]);

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

  const getColorForScore = (score: number): string => {
    if (score >= thresholds.greenMin) return '#22c55e';
    if (score >= thresholds.yellowMin) return '#eab308';
    return '#ef4444';
  };

  const periodOptions: { value: PeriodType; label: string }[] = [
    { value: 'week', label: 'Weekly' },
    { value: 'month', label: 'Monthly' },
    { value: 'quarter', label: 'Quarterly' },
    { value: 'year', label: 'Yearly' },
  ];

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
      {/* Period selector and trend indicator */}
      <div className="flex items-center justify-between mb-2">
        {onPeriodChange && (
          <div className="relative">
            <select
              value={periodType}
              onChange={(e) => onPeriodChange(e.target.value as PeriodType)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 pr-8 appearance-none bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {periodOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        )}

        {showTrendIndicator && (
          <div className="flex items-center gap-1 text-sm">
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

      {/* Chart */}
      <svg
        viewBox={`0 0 ${chartWidth} ${height}`}
        className="w-full"
        style={{ height }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id="enhancedAreaGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#4F46E5" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#4F46E5" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {showGrid && (
          <g className="stroke-gray-100">
            {/* Horizontal grid lines */}
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
              <line
                key={ratio}
                x1={padding.left}
                y1={padding.top + chartHeight * ratio}
                x2={chartWidth - padding.right}
                y2={padding.top + chartHeight * ratio}
                strokeDasharray="4 4"
              />
            ))}
            {/* Threshold lines */}
            <line
              x1={padding.left}
              y1={
                padding.top +
                chartHeight * (1 - (thresholds.greenMin - minScore) / (maxScore - minScore))
              }
              x2={chartWidth - padding.right}
              y2={
                padding.top +
                chartHeight * (1 - (thresholds.greenMin - minScore) / (maxScore - minScore))
              }
              strokeDasharray="4 4"
              className="stroke-green-200"
            />
            <line
              x1={padding.left}
              y1={
                padding.top +
                chartHeight * (1 - (thresholds.yellowMin - minScore) / (maxScore - minScore))
              }
              x2={chartWidth - padding.right}
              y2={
                padding.top +
                chartHeight * (1 - (thresholds.yellowMin - minScore) / (maxScore - minScore))
              }
              strokeDasharray="4 4"
              className="stroke-yellow-200"
            />
          </g>
        )}

        {/* Regression zones */}
        {showRegressionZones &&
          regressionZones.map((zone, i) => (
            <rect
              key={`reg-${i}`}
              x={points[zone.start].x}
              y={padding.top}
              width={points[zone.end].x - points[zone.start].x}
              height={chartHeight}
              fill="#fee2e2"
              opacity="0.5"
            />
          ))}

        {/* Progress zones */}
        {showRegressionZones &&
          progressZones.map((zone, i) => (
            <rect
              key={`prog-${i}`}
              x={points[zone.start].x}
              y={padding.top}
              width={points[zone.end].x - points[zone.start].x}
              height={chartHeight}
              fill="#dcfce7"
              opacity="0.5"
            />
          ))}

        {/* Area fill */}
        <path d={areaPath} fill="url(#enhancedAreaGradient)" />

        {/* School average line */}
        {showSchoolComparison && schoolLinePath && (
          <path
            d={schoolLinePath}
            fill="none"
            stroke="#9CA3AF"
            strokeWidth="2"
            strokeDasharray="6 4"
            strokeLinecap="round"
          />
        )}

        {/* Main line */}
        <path
          d={linePath}
          fill="none"
          stroke="#4F46E5"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Data points */}
        {points.map((point, i) => (
          <g
            key={i}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            <circle
              cx={point.x}
              cy={point.y}
              r={hoveredIndex === i ? 6 : 4}
              fill={getColorForScore(point.averageScore)}
              stroke="white"
              strokeWidth="2"
              className="transition-all"
            />
            {/* Hover target */}
            <circle
              cx={point.x}
              cy={point.y}
              r="12"
              fill="transparent"
              className="cursor-pointer"
            />
          </g>
        ))}

        {/* School average points */}
        {showSchoolComparison &&
          schoolPoints.map((point, i) => (
            <circle
              key={`school-${i}`}
              cx={point.x}
              cy={point.y}
              r="3"
              fill="#9CA3AF"
              stroke="white"
              strokeWidth="1"
            />
          ))}

        {/* Y-axis labels */}
        {showLabels && (
          <g className="fill-gray-400 text-xs">
            <text x={padding.left - 8} y={padding.top + 4} textAnchor="end">
              {Math.round(maxScore)}
            </text>
            <text
              x={padding.left - 8}
              y={padding.top + chartHeight / 2}
              textAnchor="end"
            >
              {Math.round((maxScore + minScore) / 2)}
            </text>
            <text x={padding.left - 8} y={padding.top + chartHeight} textAnchor="end">
              {Math.round(minScore)}
            </text>
          </g>
        )}

        {/* X-axis labels */}
        {showLabels && points.length > 1 && (
          <g className="fill-gray-400 text-xs">
            <text x={points[0].x} y={height - 8} textAnchor="start">
              {formatPeriod(points[0].periodStart, periodType)}
            </text>
            {points.length > 2 && (
              <text
                x={points[Math.floor(points.length / 2)].x}
                y={height - 8}
                textAnchor="middle"
              >
                {formatPeriod(points[Math.floor(points.length / 2)].periodStart, periodType)}
              </text>
            )}
            <text x={points[points.length - 1].x} y={height - 8} textAnchor="end">
              {formatPeriod(points[points.length - 1].periodStart, periodType)}
            </text>
          </g>
        )}

        {/* Hover tooltip */}
        {hoveredIndex !== null && (
          <g>
            <rect
              x={points[hoveredIndex].x - 50}
              y={points[hoveredIndex].y - 45}
              width="100"
              height="40"
              rx="4"
              fill="white"
              stroke="#E5E7EB"
              strokeWidth="1"
              filter="drop-shadow(0 2px 4px rgba(0,0,0,0.1))"
            />
            <text
              x={points[hoveredIndex].x}
              y={points[hoveredIndex].y - 28}
              textAnchor="middle"
              className="text-xs fill-gray-500"
            >
              {formatPeriod(points[hoveredIndex].periodStart, periodType)}
            </text>
            <text
              x={points[hoveredIndex].x}
              y={points[hoveredIndex].y - 12}
              textAnchor="middle"
              className="text-sm font-semibold fill-gray-900"
            >
              {points[hoveredIndex].averageScore.toFixed(1)}%
            </text>
          </g>
        )}
      </svg>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 mt-2 text-xs text-gray-500">
        <div className="flex items-center gap-1">
          <div className="w-3 h-0.5 bg-primary-600 rounded" />
          <span>Teacher</span>
        </div>
        {showSchoolComparison && schoolAverage && schoolAverage.length > 0 && (
          <div className="flex items-center gap-1">
            <div
              className="w-3 h-0.5 bg-gray-400 rounded"
              style={{ borderStyle: 'dashed' }}
            />
            <span>School Avg</span>
          </div>
        )}
        {showRegressionZones && (
          <>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 bg-red-100 rounded" />
              <span>Decline</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 bg-green-100 rounded" />
              <span>Growth</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

function formatPeriod(dateStr: string, periodType: PeriodType): string {
  try {
    const date = new Date(dateStr);
    switch (periodType) {
      case 'week':
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      case 'month':
        return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      case 'quarter':
        const quarter = Math.floor(date.getMonth() / 3) + 1;
        return `Q${quarter} '${date.getFullYear().toString().slice(-2)}`;
      case 'year':
        return date.getFullYear().toString();
      default:
        return date.toLocaleDateString('en-US', { month: 'short' });
    }
  } catch {
    return dateStr;
  }
}

export default EnhancedTrendChart;
