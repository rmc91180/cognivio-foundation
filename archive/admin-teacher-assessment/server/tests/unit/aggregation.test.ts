import {
  colorFromScore,
  computeColumnScore,
  calculateProblemScore,
  weightedAverageAggregation,
  worstScoreAggregation,
  majorityColorAggregation,
  DEFAULT_THRESHOLDS,
} from '../../src/utils/aggregation';

describe('Aggregation Utils', () => {
  describe('colorFromScore', () => {
    it('returns green for scores >= 80', () => {
      expect(colorFromScore(80, DEFAULT_THRESHOLDS)).toBe('green');
      expect(colorFromScore(90, DEFAULT_THRESHOLDS)).toBe('green');
      expect(colorFromScore(100, DEFAULT_THRESHOLDS)).toBe('green');
    });

    it('returns yellow for scores >= 60 and < 80', () => {
      expect(colorFromScore(60, DEFAULT_THRESHOLDS)).toBe('yellow');
      expect(colorFromScore(70, DEFAULT_THRESHOLDS)).toBe('yellow');
      expect(colorFromScore(79.9, DEFAULT_THRESHOLDS)).toBe('yellow');
    });

    it('returns red for scores < 60', () => {
      expect(colorFromScore(59.9, DEFAULT_THRESHOLDS)).toBe('red');
      expect(colorFromScore(50, DEFAULT_THRESHOLDS)).toBe('red');
      expect(colorFromScore(0, DEFAULT_THRESHOLDS)).toBe('red');
    });

    it('works with custom thresholds', () => {
      const customThresholds = { greenMin: 90, yellowMin: 70 };
      expect(colorFromScore(95, customThresholds)).toBe('green');
      expect(colorFromScore(85, customThresholds)).toBe('yellow');
      expect(colorFromScore(65, customThresholds)).toBe('red');
    });
  });

  describe('weightedAverageAggregation', () => {
    it('calculates weighted average correctly', () => {
      const scores = [
        { score: 90, weight: 1 },
        { score: 80, weight: 1 },
        { score: 50, weight: 1 },
      ];
      const result = weightedAverageAggregation(scores);
      expect(result).toBeCloseTo(73.33, 1);
    });

    it('respects weights', () => {
      const weightedScores = [
        { score: 100, weight: 2 },
        { score: 50, weight: 1 },
      ];
      const result = weightedAverageAggregation(weightedScores);
      expect(result).toBeCloseTo(83.33, 1);
    });

    it('returns 0 for empty scores', () => {
      const result = weightedAverageAggregation([]);
      expect(result).toBe(0);
    });
  });

  describe('worstScoreAggregation', () => {
    it('returns the lowest score', () => {
      const scores = [
        { score: 90 },
        { score: 80 },
        { score: 50 },
      ];
      const result = worstScoreAggregation(scores);
      expect(result).toBe(50);
    });

    it('returns 0 for empty scores', () => {
      const result = worstScoreAggregation([]);
      expect(result).toBe(0);
    });
  });

  describe('majorityColorAggregation', () => {
    it('returns the most common color', () => {
      const scores = [
        { score: 85 }, // green
        { score: 82 }, // green
        { score: 55 }, // red
      ];
      const result = majorityColorAggregation(scores);
      expect(result.color).toBe('green');
    });

    it('uses average score color on tie', () => {
      const scores = [
        { score: 85 }, // green
        { score: 55 }, // red
      ];
      const result = majorityColorAggregation(scores);
      // Average is 70, which is yellow
      expect(result.color).toBe('yellow');
    });

    it('returns red for empty scores', () => {
      const result = majorityColorAggregation([]);
      expect(result.color).toBe('red');
      expect(result.score).toBe(0);
    });
  });

  describe('computeColumnScore', () => {
    const testScores = [
      { score: 90, weight: 1 },
      { score: 80, weight: 1 },
      { score: 50, weight: 1 },
    ];

    it('calculates weighted aggregation by default', () => {
      const result = computeColumnScore(testScores, 'weighted');
      expect(result.numericScore).toBeCloseTo(73.33, 1);
      expect(result.color).toBe('yellow');
    });

    it('calculates worst score aggregation', () => {
      const result = computeColumnScore(testScores, 'worst');
      expect(result.numericScore).toBe(50);
      expect(result.color).toBe('red');
    });

    it('calculates majority color aggregation', () => {
      const scores = [
        { score: 85, weight: 1 }, // green
        { score: 82, weight: 1 }, // green
        { score: 55, weight: 1 }, // red
      ];
      const result = computeColumnScore(scores, 'majority');
      expect(result.color).toBe('green');
    });

    it('returns red and 0 for empty scores', () => {
      const result = computeColumnScore([], 'weighted');
      expect(result.color).toBe('red');
      expect(result.numericScore).toBe(0);
    });
  });

  describe('calculateProblemScore', () => {
    it('returns higher score for lower current scores', () => {
      const lowScore = calculateProblemScore(40, null, 1, 0, 0);
      const highScore = calculateProblemScore(80, null, 1, 0, 0);

      expect(lowScore).toBeGreaterThan(highScore);
    });

    it('returns higher score when there is regression', () => {
      // Regression: previous was 80, now is 60
      const regressionScore = calculateProblemScore(60, 80, 1, 0, 0);
      // No regression: previous was 60, now is 60
      const stableScore = calculateProblemScore(60, 60, 1, 0, 0);

      expect(regressionScore).toBeGreaterThan(stableScore);
    });

    it('considers weight in calculation', () => {
      const highWeight = calculateProblemScore(70, null, 2, 0, 0);
      const lowWeight = calculateProblemScore(70, null, 1, 0, 0);

      expect(highWeight).toBeGreaterThan(lowWeight);
    });

    it('considers observation count in calculation', () => {
      const manyObs = calculateProblemScore(70, null, 1, 10, 0);
      const fewObs = calculateProblemScore(70, null, 1, 1, 0);

      expect(manyObs).toBeGreaterThan(fewObs);
    });

    it('considers AI confidence in calculation', () => {
      const highConfidence = calculateProblemScore(70, null, 1, 0, 0.9);
      const lowConfidence = calculateProblemScore(70, null, 1, 0, 0.1);

      expect(highConfidence).toBeGreaterThan(lowConfidence);
    });

    it('returns non-negative values', () => {
      const score = calculateProblemScore(100, 100, 1, 0, 0);
      expect(score).toBeGreaterThanOrEqual(0);
    });
  });
});
