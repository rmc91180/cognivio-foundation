/**
 * Trend Analysis Service Unit Tests
 */

describe('Trend Analysis Service', () => {
  describe('Period Grouping', () => {
    const observations = [
      { date: '2024-01-15', score: 80 },
      { date: '2024-01-20', score: 85 },
      { date: '2024-02-10', score: 75 },
      { date: '2024-02-25', score: 78 },
      { date: '2024-03-05', score: 82 },
    ];

    it('groups observations by month', () => {
      const byMonth = observations.reduce((acc, obs) => {
        const month = obs.date.substring(0, 7); // YYYY-MM
        if (!acc[month]) acc[month] = [];
        acc[month].push(obs);
        return acc;
      }, {} as Record<string, typeof observations>);

      expect(Object.keys(byMonth).length).toBe(3);
      expect(byMonth['2024-01'].length).toBe(2);
      expect(byMonth['2024-02'].length).toBe(2);
      expect(byMonth['2024-03'].length).toBe(1);
    });

    it('calculates period boundaries correctly', () => {
      const getPeriodBoundaries = (date: string, periodType: string) => {
        const d = new Date(date);
        let start: Date, end: Date;

        switch (periodType) {
          case 'week':
            const dayOfWeek = d.getDay();
            start = new Date(d);
            start.setDate(d.getDate() - dayOfWeek);
            end = new Date(start);
            end.setDate(start.getDate() + 6);
            break;
          case 'month':
            start = new Date(d.getFullYear(), d.getMonth(), 1);
            end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
            break;
          case 'quarter':
            const quarter = Math.floor(d.getMonth() / 3);
            start = new Date(d.getFullYear(), quarter * 3, 1);
            end = new Date(d.getFullYear(), quarter * 3 + 3, 0);
            break;
          case 'year':
            start = new Date(d.getFullYear(), 0, 1);
            end = new Date(d.getFullYear(), 11, 31);
            break;
          default:
            start = end = d;
        }

        return { start, end };
      };

      const jan = getPeriodBoundaries('2024-01-15', 'month');
      expect(jan.start.getDate()).toBe(1);
      expect(jan.end.getDate()).toBe(31);

      const q1 = getPeriodBoundaries('2024-02-15', 'quarter');
      expect(q1.start.getMonth()).toBe(0); // January
      expect(q1.end.getMonth()).toBe(2); // March
    });
  });

  describe('Score Aggregation', () => {
    const periodScores = [75, 80, 85, 70, 90];

    it('calculates average score', () => {
      const avg = periodScores.reduce((a, b) => a + b, 0) / periodScores.length;
      expect(avg).toBe(80);
    });

    it('calculates min and max scores', () => {
      const min = Math.min(...periodScores);
      const max = Math.max(...periodScores);

      expect(min).toBe(70);
      expect(max).toBe(90);
    });

    it('calculates standard deviation', () => {
      const mean = periodScores.reduce((a, b) => a + b, 0) / periodScores.length;
      const variance =
        periodScores.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / periodScores.length;
      const stdDev = Math.sqrt(variance);

      expect(stdDev).toBeCloseTo(7.07, 1);
    });
  });

  describe('Trend Direction Calculation', () => {
    it('identifies upward trend', () => {
      const previousAvg = 70;
      const currentAvg = 80;
      const threshold = 5;

      const diff = currentAvg - previousAvg;
      const direction = diff > threshold ? 'up' : diff < -threshold ? 'down' : 'stable';

      expect(direction).toBe('up');
    });

    it('identifies downward trend', () => {
      const previousAvg = 80;
      const currentAvg = 65;
      const threshold = 5;

      const diff = currentAvg - previousAvg;
      const direction = diff > threshold ? 'up' : diff < -threshold ? 'down' : 'stable';

      expect(direction).toBe('down');
    });

    it('identifies stable trend', () => {
      const previousAvg = 75;
      const currentAvg = 77;
      const threshold = 5;

      const diff = currentAvg - previousAvg;
      const direction = diff > threshold ? 'up' : diff < -threshold ? 'down' : 'stable';

      expect(direction).toBe('stable');
    });
  });

  describe('Regression Detection', () => {
    const trends = [
      { periodStart: '2024-01', averageScore: 85, scoreChange: 0 },
      { periodStart: '2024-02', averageScore: 80, scoreChange: -5 },
      { periodStart: '2024-03', averageScore: 72, scoreChange: -8 },
      { periodStart: '2024-04', averageScore: 70, scoreChange: -2 },
    ];

    it('detects regression when decline exceeds threshold', () => {
      const regressionThreshold = -10; // 10% decline
      const regressions: typeof trends = [];

      for (let i = 1; i < trends.length; i++) {
        const changePercent = ((trends[i].averageScore - trends[i - 1].averageScore) / trends[i - 1].averageScore) * 100;
        if (changePercent <= regressionThreshold) {
          regressions.push(trends[i]);
        }
      }

      expect(regressions.length).toBe(1);
      expect(regressions[0].periodStart).toBe('2024-03');
    });

    it('calculates cumulative decline', () => {
      const firstScore = trends[0].averageScore;
      const lastScore = trends[trends.length - 1].averageScore;
      const totalDecline = ((lastScore - firstScore) / firstScore) * 100;

      expect(totalDecline).toBeCloseTo(-17.65, 1);
    });

    it('identifies consecutive declining periods', () => {
      let consecutiveDeclines = 0;
      let maxConsecutive = 0;

      for (let i = 1; i < trends.length; i++) {
        if (trends[i].scoreChange < 0) {
          consecutiveDeclines++;
          maxConsecutive = Math.max(maxConsecutive, consecutiveDeclines);
        } else {
          consecutiveDeclines = 0;
        }
      }

      expect(maxConsecutive).toBe(3);
    });
  });

  describe('Progress Detection', () => {
    const trends = [
      { periodStart: '2024-01', averageScore: 60 },
      { periodStart: '2024-02', averageScore: 68 },
      { periodStart: '2024-03', averageScore: 75 },
      { periodStart: '2024-04', averageScore: 82 },
    ];

    it('detects consistent improvement', () => {
      let improvingPeriods = 0;

      for (let i = 1; i < trends.length; i++) {
        if (trends[i].averageScore > trends[i - 1].averageScore) {
          improvingPeriods++;
        }
      }

      expect(improvingPeriods).toBe(3);
    });

    it('calculates improvement rate', () => {
      const firstScore = trends[0].averageScore;
      const lastScore = trends[trends.length - 1].averageScore;
      const improvementRate = ((lastScore - firstScore) / firstScore) * 100;

      expect(improvementRate).toBeCloseTo(36.67, 1);
    });
  });

  describe('Risk Prediction', () => {
    it('calculates risk level based on factors', () => {
      const factors = {
        recentTrend: 'down',
        averageScore: 65,
        volatility: 15, // standard deviation
        missedObservations: 2,
      };

      let riskScore = 0;

      // Trend factor
      if (factors.recentTrend === 'down') riskScore += 30;
      else if (factors.recentTrend === 'stable') riskScore += 10;

      // Score factor
      if (factors.averageScore < 60) riskScore += 40;
      else if (factors.averageScore < 70) riskScore += 25;
      else if (factors.averageScore < 80) riskScore += 10;

      // Volatility factor
      if (factors.volatility > 20) riskScore += 20;
      else if (factors.volatility > 10) riskScore += 10;

      // Missed observations factor
      riskScore += factors.missedObservations * 5;

      const riskLevel = riskScore >= 60 ? 'high' : riskScore >= 30 ? 'medium' : 'low';

      expect(riskScore).toBe(75); // 30 + 25 + 10 + 10
      expect(riskLevel).toBe('high');
    });

    it('predicts future score based on trend', () => {
      const recentScores = [70, 72, 74, 76];
      const n = recentScores.length;

      // Simple linear regression
      const sumX = (n * (n - 1)) / 2;
      const sumY = recentScores.reduce((a, b) => a + b, 0);
      const sumXY = recentScores.reduce((sum, y, x) => sum + x * y, 0);
      const sumXX = Array.from({ length: n }, (_, i) => i * i).reduce((a, b) => a + b, 0);

      const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
      const intercept = (sumY - slope * sumX) / n;

      // Predict next period (x = n)
      const predictedScore = slope * n + intercept;

      expect(slope).toBe(2); // +2 per period
      expect(predictedScore).toBe(78);
    });
  });

  describe('School Comparison', () => {
    const teacherScore = 75;
    const schoolScores = [65, 70, 72, 75, 78, 80, 85, 90];

    it('calculates percentile rank', () => {
      const belowCount = schoolScores.filter((s) => s < teacherScore).length;
      const percentile = (belowCount / schoolScores.length) * 100;

      expect(percentile).toBe(37.5);
    });

    it('calculates school average', () => {
      const schoolAvg = schoolScores.reduce((a, b) => a + b, 0) / schoolScores.length;

      expect(schoolAvg).toBe(76.875);
    });

    it('identifies position relative to school average', () => {
      const schoolAvg = schoolScores.reduce((a, b) => a + b, 0) / schoolScores.length;
      const position = teacherScore >= schoolAvg ? 'above' : 'below';

      expect(position).toBe('below');
    });
  });
});
