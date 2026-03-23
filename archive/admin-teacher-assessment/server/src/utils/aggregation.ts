import { StatusColor, ColorThresholds, AggregationMode } from '../types';

/**
 * Default color thresholds
 */
export const DEFAULT_THRESHOLDS: ColorThresholds = {
  greenMin: 80,
  yellowMin: 60,
};

/**
 * Convert numeric score to color based on thresholds
 */
export function colorFromScore(
  score: number,
  thresholds: ColorThresholds = DEFAULT_THRESHOLDS
): StatusColor {
  if (score >= thresholds.greenMin) return 'green';
  if (score >= thresholds.yellowMin) return 'yellow';
  return 'red';
}

/**
 * Weighted average aggregation
 */
export function weightedAverageAggregation(
  elementScores: { score: number; weight: number }[]
): number {
  if (elementScores.length === 0) return 0;

  const totalWeight = elementScores.reduce((sum, e) => sum + e.weight, 0);
  const weightedSum = elementScores.reduce(
    (sum, e) => sum + e.score * e.weight,
    0
  );

  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

/**
 * Worst score aggregation - returns the minimum score
 */
export function worstScoreAggregation(
  elementScores: { score: number }[]
): number {
  if (elementScores.length === 0) return 0;
  return Math.min(...elementScores.map((e) => e.score));
}

/**
 * Majority color aggregation - returns the most common color
 */
export function majorityColorAggregation(
  elementScores: { score: number }[],
  thresholds: ColorThresholds = DEFAULT_THRESHOLDS
): { color: StatusColor; score: number } {
  if (elementScores.length === 0) {
    return { color: 'red', score: 0 };
  }

  // Map each score to a color
  const colors = elementScores.map((e) => colorFromScore(e.score, thresholds));

  // Count each color
  const counts = {
    green: colors.filter((c) => c === 'green').length,
    yellow: colors.filter((c) => c === 'yellow').length,
    red: colors.filter((c) => c === 'red').length,
  };

  // Calculate average score
  const avgScore =
    elementScores.reduce((s, e) => s + e.score, 0) / elementScores.length;

  // Find majority
  const entries = Object.entries(counts) as [StatusColor, number][];
  entries.sort((a, b) => b[1] - a[1]);
  const majority = entries[0][0];

  // On tie, use weighted average to determine
  if (
    counts.green === counts.yellow ||
    counts.yellow === counts.red ||
    counts.green === counts.red
  ) {
    return {
      color: colorFromScore(avgScore, thresholds),
      score: avgScore,
    };
  }

  return { color: majority, score: avgScore };
}

/**
 * Compute column score based on aggregation mode
 */
export function computeColumnScore(
  elementScores: { score: number; weight: number }[],
  aggregationMode: AggregationMode,
  thresholds: ColorThresholds = DEFAULT_THRESHOLDS
): { numericScore: number; color: StatusColor } {
  if (elementScores.length === 0) {
    return { numericScore: 0, color: 'red' };
  }

  let numericScore: number;
  let color: StatusColor;

  switch (aggregationMode) {
    case 'worst':
      numericScore = worstScoreAggregation(elementScores);
      color = colorFromScore(numericScore, thresholds);
      break;

    case 'majority':
      const result = majorityColorAggregation(elementScores, thresholds);
      numericScore = result.score;
      color = result.color;
      break;

    case 'weighted':
    default:
      numericScore = weightedAverageAggregation(elementScores);
      color = colorFromScore(numericScore, thresholds);
      break;
  }

  return {
    numericScore: Math.round(numericScore * 100) / 100,
    color,
  };
}

/**
 * Calculate problem score for ranking problematic elements
 *
 * Formula:
 * problemScore = deficit * 1.2 + delta * 2 + log(1 + freq) * 5 + confidence * 0.2
 *
 * Where:
 * - deficit = (100 - currentScore) * weight
 * - delta = previousScore - currentScore (positive = regression)
 * - freq = observation count
 * - confidence = average AI confidence
 */
export function calculateProblemScore(
  currentScore: number,
  previousScore: number | null,
  weight: number = 1,
  observationCount: number = 0,
  avgAiConfidence: number = 0
): number {
  const previous = previousScore ?? currentScore;
  const delta = previous - currentScore; // positive = regression
  const deficit = (100 - currentScore) * weight;
  const freq = observationCount;

  const problemScore =
    deficit * 1.2 +
    delta * 2 +
    Math.log(1 + freq) * 5 +
    avgAiConfidence * 0.2;

  return Math.max(0, problemScore);
}

/**
 * Calculate recency weight for time-based weighting
 * Uses exponential decay with a half-life of 30 days
 */
export function calculateRecencyWeight(date: Date): number {
  const daysSince = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
  // Exponential decay: recent observations weighted higher
  // Half-life of 30 days
  return Math.pow(0.5, daysSince / 30);
}
