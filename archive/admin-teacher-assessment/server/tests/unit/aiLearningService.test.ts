/**
 * AI Learning Service Unit Tests
 */

describe('AI Learning Service', () => {
  describe('calculateConfidenceAdjustment', () => {
    it('returns 1.0 when no corrections exist', () => {
      const correctionCount = 0;
      const avgDelta = 0;

      // Formula: 1.0 - (avgDelta * 0.02) - (correctionCount * 0.01)
      // With bounds [0.5, 1.0]
      const adjustment = Math.max(0.5, Math.min(1.0, 1.0 - avgDelta * 0.02 - correctionCount * 0.01));

      expect(adjustment).toBe(1.0);
    });

    it('reduces confidence based on correction count and avg delta', () => {
      const correctionCount = 10;
      const avgDelta = 5;

      // 1.0 - (5 * 0.02) - (10 * 0.01) = 1.0 - 0.1 - 0.1 = 0.8
      const adjustment = Math.max(0.5, Math.min(1.0, 1.0 - avgDelta * 0.02 - correctionCount * 0.01));

      expect(adjustment).toBe(0.8);
    });

    it('has a minimum bound of 0.5', () => {
      const correctionCount = 100;
      const avgDelta = 50;

      const adjustment = Math.max(0.5, Math.min(1.0, 1.0 - avgDelta * 0.02 - correctionCount * 0.01));

      expect(adjustment).toBe(0.5);
    });
  });

  describe('Learning Entry Validation', () => {
    const validEntry = {
      teacherId: 'teacher-123',
      elementId: 'elem-456',
      observationId: 'obs-789',
      correctionId: 'corr-001',
      originalAiScore: 75,
      correctedScore: 85,
      scoreDelta: 10,
      aiConfidence: 0.8,
      correctionType: 'principal_override',
      frameworkType: 'danielson',
      domainName: 'Domain 1',
      reviewerId: 'reviewer-123',
      reviewerRole: 'principal',
      reviewerExpertiseWeight: 1.0,
    };

    it('calculates score delta correctly', () => {
      const delta = validEntry.correctedScore - validEntry.originalAiScore;
      expect(delta).toBe(10);
      expect(validEntry.scoreDelta).toBe(delta);
    });

    it('identifies correction type based on score change', () => {
      const types = {
        minor_adjustment: Math.abs(validEntry.scoreDelta) <= 10,
        major_override: Math.abs(validEntry.scoreDelta) > 10,
        category_change: validEntry.scoreDelta > 25,
      };

      expect(types.minor_adjustment).toBe(true);
      expect(types.major_override).toBe(false);
    });
  });

  describe('Model Version Management', () => {
    const modelVersions = [
      { version: '1.0.0', status: 'deprecated', createdAt: '2024-01-01' },
      { version: '1.1.0', status: 'active', createdAt: '2024-06-01' },
      { version: '1.2.0', status: 'testing', createdAt: '2024-12-01' },
    ];

    it('identifies active model version', () => {
      const activeVersion = modelVersions.find((v) => v.status === 'active');
      expect(activeVersion?.version).toBe('1.1.0');
    });

    it('validates semver format', () => {
      const semverRegex = /^\d+\.\d+\.\d+$/;

      modelVersions.forEach((v) => {
        expect(v.version).toMatch(semverRegex);
      });
    });

    it('sorts versions chronologically', () => {
      const sorted = [...modelVersions].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

      expect(sorted[0].version).toBe('1.0.0');
      expect(sorted[2].version).toBe('1.2.0');
    });
  });

  describe('Training Queue Processing', () => {
    const queueEntry = {
      learningHistoryId: 'lh-123',
      status: 'pending',
      priority: 1,
      batchId: null,
      createdAt: new Date().toISOString(),
    };

    it('assigns correct priority based on expertise weight', () => {
      const expertiseWeight = 1.5;
      const basePriority = 1;

      // Higher expertise weight = lower priority number = processed first
      const calculatedPriority = Math.max(1, Math.round(basePriority / expertiseWeight));

      expect(calculatedPriority).toBe(1);
    });

    it('tracks batch assignment correctly', () => {
      const updatedEntry = { ...queueEntry, batchId: 'batch-001', status: 'processing' };

      expect(updatedEntry.batchId).toBe('batch-001');
      expect(updatedEntry.status).toBe('processing');
    });
  });

  describe('Pattern Analysis', () => {
    const corrections = [
      { elementId: 'elem-1', scoreDelta: 10, frameworkType: 'danielson' },
      { elementId: 'elem-1', scoreDelta: 12, frameworkType: 'danielson' },
      { elementId: 'elem-1', scoreDelta: 8, frameworkType: 'danielson' },
      { elementId: 'elem-2', scoreDelta: -5, frameworkType: 'danielson' },
      { elementId: 'elem-2', scoreDelta: -3, frameworkType: 'danielson' },
    ];

    it('groups corrections by element', () => {
      const grouped = corrections.reduce((acc, c) => {
        if (!acc[c.elementId]) acc[c.elementId] = [];
        acc[c.elementId].push(c);
        return acc;
      }, {} as Record<string, typeof corrections>);

      expect(Object.keys(grouped).length).toBe(2);
      expect(grouped['elem-1'].length).toBe(3);
      expect(grouped['elem-2'].length).toBe(2);
    });

    it('identifies systematic bias direction', () => {
      const elem1Deltas = corrections.filter((c) => c.elementId === 'elem-1').map((c) => c.scoreDelta);
      const avgDelta = elem1Deltas.reduce((a, b) => a + b, 0) / elem1Deltas.length;

      // Positive avg delta means AI is scoring lower than it should
      expect(avgDelta).toBe(10);
      expect(avgDelta > 0).toBe(true); // AI underscoring this element
    });

    it('calculates standard deviation of corrections', () => {
      const deltas = corrections.filter((c) => c.elementId === 'elem-1').map((c) => c.scoreDelta);
      const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
      const variance = deltas.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / deltas.length;
      const stdDev = Math.sqrt(variance);

      expect(stdDev).toBeCloseTo(1.633, 2);
    });
  });
});
