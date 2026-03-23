import {
  colorFromScore,
  aggregateScores,
  calculateProblemScore,
  DEFAULT_COLOR_THRESHOLDS,
} from '../../src/utils/aggregation';

describe('Aggregation Utils', () => {
  describe('colorFromScore', () => {
    it('returns green for scores >= 80', () => {
      expect(colorFromScore(80, DEFAULT_COLOR_THRESHOLDS)).toBe('green');
      expect(colorFromScore(90, DEFAULT_COLOR_THRESHOLDS)).toBe('green');
      expect(colorFromScore(100, DEFAULT_COLOR_THRESHOLDS)).toBe('green');
    });

    it('returns yellow for scores >= 60 and < 80', () => {
      expect(colorFromScore(60, DEFAULT_COLOR_THRESHOLDS)).toBe('yellow');
      expect(colorFromScore(70, DEFAULT_COLOR_THRESHOLDS)).toBe('yellow');
      expect(colorFromScore(79.9, DEFAULT_COLOR_THRESHOLDS)).toBe('yellow');
    });

    it('returns red for scores < 60', () => {
      expect(colorFromScore(59.9, DEFAULT_COLOR_THRESHOLDS)).toBe('red');
      expect(colorFromScore(50, DEFAULT_COLOR_THRESHOLDS)).toBe('red');
      expect(colorFromScore(0, DEFAULT_COLOR_THRESHOLDS)).toBe('red');
    });

    it('works with custom thresholds', () => {
      const customThresholds = { greenMin: 90, yellowMin: 70, redMax: 70 };
      expect(colorFromScore(95, customThresholds)).toBe('green');
      expect(colorFromScore(85, customThresholds)).toBe('yellow');
      expect(colorFromScore(65, customThresholds)).toBe('red');
    });
  });

  describe('aggregateScores', () => {
    const testScores = [
      { score: 90, weight: 1 },
      { score: 80, weight: 1 },
      { score: 50, weight: 1 },
    ];

    describe('weighted mode', () => {
      it('calculates weighted average correctly', () => {
        const result = aggregateScores(testScores, 'weighted');
        expect(result.score).toBeCloseTo(73.33, 1);
      });

      it('respects weights', () => {
        const weightedScores = [
          { score: 100, weight: 2 },
          { score: 50, weight: 1 },
        ];
        const result = aggregateScores(weightedScores, 'weighted');
        expect(result.score).toBeCloseTo(83.33, 1);
      });
    });

    describe('worst_score mode', () => {
      it('returns the lowest score', () => {
        const result = aggregateScores(testScores, 'worst_score');
        expect(result.score).toBe(50);
        expect(result.color).toBe('red');
      });
    });

    describe('majority_color mode', () => {
      it('returns the most common color', () => {
        const scores = [
          { score: 85, weight: 1 }, // green
          { score: 82, weight: 1 }, // green
          { score: 55, weight: 1 }, // red
        ];
        const result = aggregateScores(scores, 'majority_color');
        expect(result.color).toBe('green');
      });

      it('returns worst color on tie', () => {
        const scores = [
          { score: 85, weight: 1 }, // green
          { score: 55, weight: 1 }, // red
        ];
        const result = aggregateScores(scores, 'majority_color');
        expect(result.color).toBe('red');
      });
    });

    it('returns gray for empty scores', () => {
      const result = aggregateScores([], 'weighted');
      expect(result.color).toBe('gray');
      expect(result.score).toBe(0);
    });
  });

  describe('calculateProblemScore', () => {
    it('returns higher score for red status', () => {
      const redScore = calculateProblemScore(50, 'red', false, null);
      const yellowScore = calculateProblemScore(65, 'yellow', false, null);
      const greenScore = calculateProblemScore(85, 'green', false, null);

      expect(redScore).toBeGreaterThan(yellowScore);
      expect(yellowScore).toBeGreaterThan(greenScore);
    });

    it('returns higher score for lower scores within same color', () => {
      const lowerScore = calculateProblemScore(45, 'red', false, null);
      const higherScore = calculateProblemScore(55, 'red', false, null);

      expect(lowerScore).toBeGreaterThan(higherScore);
    });

    it('boosts score for declining trend', () => {
      const decliningScore = calculateProblemScore(70, 'yellow', false, 'declining');
      const stableScore = calculateProblemScore(70, 'yellow', false, 'stable');

      expect(decliningScore).toBeGreaterThan(stableScore);
    });

    it('includes gradebook flag bonus', () => {
      const withGradebook = calculateProblemScore(70, 'yellow', true, null);
      const withoutGradebook = calculateProblemScore(70, 'yellow', false, null);

      expect(withGradebook).toBeGreaterThan(withoutGradebook);
    });
  });
});
