import { db } from '../utils/db';
import { v4 as uuidv4 } from 'uuid';
import { DEFAULT_THRESHOLDS, colorFromScore } from '../utils/aggregation';

// ===========================================
// Types
// ===========================================

export type PeriodType = 'week' | 'month' | 'quarter' | 'year';
export type TrendDirection = 'up' | 'down' | 'stable';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface TrendDataPoint {
  id: string;
  teacherId: string;
  elementId?: string;
  templateId?: string;
  periodStart: Date;
  periodEnd: Date;
  periodType: PeriodType;
  averageScore: number;
  scoreChange: number;
  trendDirection: TrendDirection;
  observationCount: number;
  minScore: number;
  maxScore: number;
  stdDeviation: number;
  confidenceAverage: number;
  schoolAverage: number;
  percentileRank: number;
  riskLevel?: RiskLevel;
  predictedFutureRisk?: number;
  riskFactors: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface RegressionAlert {
  teacherId: string;
  teacherName: string;
  elementId?: string;
  elementName?: string;
  domainName?: string;
  severity: 'critical' | 'warning';
  previousScore: number;
  currentScore: number;
  decline: number;
  declinePercent: number;
  periodsAffected: number;
  trendDirection: TrendDirection;
  riskLevel: RiskLevel;
  recommendedAction: string;
  createdAt: Date;
}

export interface ProgressReport {
  teacherId: string;
  teacherName: string;
  elementId?: string;
  elementName?: string;
  domainName?: string;
  previousScore: number;
  currentScore: number;
  improvement: number;
  improvementPercent: number;
  periodsOfGrowth: number;
  consistency: number;
  createdAt: Date;
}

export interface TrendParams {
  teacherId: string;
  templateId?: string;
  elementId?: string;
  periodType?: PeriodType;
  startDate?: Date;
  endDate?: Date;
}

export interface SchoolTrendSummary {
  schoolId: string;
  schoolName: string;
  periodStart: Date;
  periodEnd: Date;
  overallAverage: number;
  teacherCount: number;
  improvingCount: number;
  decliningCount: number;
  stableCount: number;
  atRiskCount: number;
  topPerformers: Array<{ teacherId: string; teacherName: string; score: number }>;
  needsAttention: Array<{ teacherId: string; teacherName: string; score: number; riskLevel: RiskLevel }>;
  domainAverages: Array<{ domainId: string; domainName: string; average: number; trend: TrendDirection }>;
}

// ===========================================
// Trend Analysis Service
// ===========================================

export const trendAnalysisService = {
  /**
   * Calculate and store trends for a teacher
   */
  async calculateTrends(
    teacherId: string,
    templateId: string,
    periodType: PeriodType = 'month'
  ): Promise<TrendDataPoint[]> {
    const teacher = await db('teachers').where('id', teacherId).first();
    if (!teacher) {
      throw new Error('Teacher not found');
    }

    // Get period boundaries
    const { periodStart, periodEnd } = this.getPeriodBoundaries(periodType);

    // Get all observations for this teacher in the period
    const observations = await db('ai_observations as o')
      .leftJoin('video_evidence as v', 'o.video_id', 'v.id')
      .leftJoin('rubric_elements as e', 'o.element_id', 'e.id')
      .leftJoin('rubric_domains as d', 'e.domain_id', 'd.id')
      .where('v.teacher_id', teacherId)
      .where('o.status', 'accepted')
      .where('o.created_at', '>=', periodStart)
      .where('o.created_at', '<=', periodEnd)
      .modify((qb) => {
        if (templateId) {
          qb.where('d.template_id', templateId);
        }
      })
      .select(
        'o.element_id',
        'o.score_estimate',
        'o.confidence',
        'o.created_at',
        'e.name as element_name',
        'd.id as domain_id',
        'd.name as domain_name',
        'd.template_id'
      );

    if (observations.length === 0) {
      return [];
    }

    // Group observations by element
    const elementGroups: Record<string, typeof observations> = {};
    for (const obs of observations) {
      if (!elementGroups[obs.element_id]) {
        elementGroups[obs.element_id] = [];
      }
      elementGroups[obs.element_id].push(obs);
    }

    // Get previous period for comparison
    const prevPeriod = this.getPreviousPeriod(periodType, periodStart);

    // Get school average for comparison
    const schoolAvg = await this.getSchoolAverage(teacher.school_id, periodStart, periodEnd);

    // Calculate trends for each element
    const trends: TrendDataPoint[] = [];

    for (const [elementId, elementObs] of Object.entries(elementGroups)) {
      const scores = elementObs.map(o => parseFloat(o.score_estimate) || 0);
      const confidences = elementObs.map(o => parseFloat(o.confidence) || 0);

      const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
      const minScore = Math.min(...scores);
      const maxScore = Math.max(...scores);
      const stdDev = Math.sqrt(scores.map(s => Math.pow(s - avgScore, 2)).reduce((a, b) => a + b, 0) / scores.length);
      const avgConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;

      // Get previous period score
      const prevTrend = await db('teacher_performance_trends')
        .where('teacher_id', teacherId)
        .where('element_id', elementId)
        .where('period_start', prevPeriod.start)
        .where('period_end', prevPeriod.end)
        .first();

      const previousScore = prevTrend ? parseFloat(prevTrend.average_score) : avgScore;
      const scoreChange = avgScore - previousScore;
      const trendDirection = this.calculateTrendDirection(scoreChange);

      // Calculate percentile rank
      const percentileRank = await this.calculatePercentileRank(teacherId, elementId, avgScore, periodStart, periodEnd);

      // Calculate risk level and prediction
      const { riskLevel, predictedRisk, riskFactors } = await this.assessRisk(
        teacherId,
        elementId,
        avgScore,
        scoreChange,
        stdDev,
        observations.length
      );

      // Upsert trend record
      const trendId = uuidv4();
      const existingTrend = await db('teacher_performance_trends')
        .where('teacher_id', teacherId)
        .where('element_id', elementId)
        .where('period_start', periodStart)
        .where('period_end', periodEnd)
        .first();

      const trendData = {
        teacher_id: teacherId,
        element_id: elementId,
        template_id: elementObs[0].template_id,
        period_start: periodStart,
        period_end: periodEnd,
        period_type: periodType,
        average_score: avgScore,
        score_change: scoreChange,
        trend_direction: trendDirection,
        observation_count: scores.length,
        min_score: minScore,
        max_score: maxScore,
        std_deviation: stdDev,
        confidence_average: avgConfidence,
        school_average: schoolAvg,
        percentile_rank: percentileRank,
        risk_level: riskLevel,
        predicted_future_risk: predictedRisk,
        risk_factors: JSON.stringify(riskFactors),
        updated_at: new Date(),
      };

      if (existingTrend) {
        await db('teacher_performance_trends')
          .where('id', existingTrend.id)
          .update(trendData);
        trends.push(await this.getTrendById(existingTrend.id));
      } else {
        await db('teacher_performance_trends').insert({
          id: trendId,
          ...trendData,
        });
        trends.push(await this.getTrendById(trendId));
      }
    }

    return trends;
  },

  /**
   * Get trend data for charts
   */
  async getTrendData(params: TrendParams): Promise<TrendDataPoint[]> {
    let query = db('teacher_performance_trends as t')
      .where('t.teacher_id', params.teacherId);

    if (params.templateId) {
      query = query.where('t.template_id', params.templateId);
    }
    if (params.elementId) {
      query = query.where('t.element_id', params.elementId);
    }
    if (params.periodType) {
      query = query.where('t.period_type', params.periodType);
    }
    if (params.startDate) {
      query = query.where('t.period_start', '>=', params.startDate);
    }
    if (params.endDate) {
      query = query.where('t.period_end', '<=', params.endDate);
    }

    const trends = await query.orderBy('t.period_start', 'asc');

    return trends.map((row: any) => this.formatTrend(row));
  },

  /**
   * Detect regression alerts for a teacher
   */
  async detectRegressions(teacherId: string): Promise<RegressionAlert[]> {
    const alerts: RegressionAlert[] = [];

    // Get teacher info
    const teacher = await db('teachers').where('id', teacherId).first();
    if (!teacher) return alerts;

    // Get recent trends (last 3 periods)
    const recentTrends = await db('teacher_performance_trends as t')
      .leftJoin('rubric_elements as e', 't.element_id', 'e.id')
      .leftJoin('rubric_domains as d', 'e.domain_id', 'd.id')
      .where('t.teacher_id', teacherId)
      .where('t.period_start', '>=', db.raw("NOW() - INTERVAL '90 days'"))
      .select('t.*', 'e.name as element_name', 'd.name as domain_name')
      .orderBy('t.element_id')
      .orderBy('t.period_start', 'desc');

    // Group by element
    const elementTrends: Record<string, typeof recentTrends> = {};
    for (const trend of recentTrends) {
      if (!elementTrends[trend.element_id]) {
        elementTrends[trend.element_id] = [];
      }
      elementTrends[trend.element_id].push(trend);
    }

    // Analyze each element for regression
    for (const [elementId, trends] of Object.entries(elementTrends)) {
      if (trends.length < 2) continue;

      const current = trends[0]; // Most recent
      const previous = trends[1];

      const decline = previous.average_score - current.average_score;
      const declinePercent = (decline / previous.average_score) * 100;

      // Alert if decline > 10% or score dropped below threshold
      if (declinePercent > 10 || (previous.average_score >= 60 && current.average_score < 60)) {
        const severity = declinePercent > 20 || current.average_score < 50 ? 'critical' : 'warning';

        alerts.push({
          teacherId,
          teacherName: teacher.name,
          elementId,
          elementName: current.element_name,
          domainName: current.domain_name,
          severity,
          previousScore: parseFloat(previous.average_score),
          currentScore: parseFloat(current.average_score),
          decline,
          declinePercent,
          periodsAffected: trends.filter(t => t.trend_direction === 'down').length,
          trendDirection: current.trend_direction,
          riskLevel: current.risk_level || 'medium',
          recommendedAction: this.getRecommendedAction(severity, decline, current.average_score),
          createdAt: new Date(),
        });
      }
    }

    // Sort by severity
    return alerts.sort((a, b) => {
      if (a.severity === 'critical' && b.severity !== 'critical') return -1;
      if (b.severity === 'critical' && a.severity !== 'critical') return 1;
      return b.decline - a.decline;
    });
  },

  /**
   * Detect progress for a teacher
   */
  async detectProgress(teacherId: string): Promise<ProgressReport[]> {
    const reports: ProgressReport[] = [];

    const teacher = await db('teachers').where('id', teacherId).first();
    if (!teacher) return reports;

    // Get trends showing improvement
    const improvingTrends = await db('teacher_performance_trends as t')
      .leftJoin('rubric_elements as e', 't.element_id', 'e.id')
      .leftJoin('rubric_domains as d', 'e.domain_id', 'd.id')
      .where('t.teacher_id', teacherId)
      .where('t.trend_direction', 'up')
      .where('t.score_change', '>', 5)
      .where('t.period_start', '>=', db.raw("NOW() - INTERVAL '90 days'"))
      .select('t.*', 'e.name as element_name', 'd.name as domain_name')
      .orderBy('t.score_change', 'desc');

    for (const trend of improvingTrends) {
      // Count consecutive periods of growth
      const growthPeriods = await db('teacher_performance_trends')
        .where('teacher_id', teacherId)
        .where('element_id', trend.element_id)
        .where('trend_direction', 'up')
        .where('period_end', '<=', trend.period_end)
        .count('id as count')
        .first();

      const previousScore = parseFloat(trend.average_score) - parseFloat(trend.score_change);

      reports.push({
        teacherId,
        teacherName: teacher.name,
        elementId: trend.element_id,
        elementName: trend.element_name,
        domainName: trend.domain_name,
        previousScore,
        currentScore: parseFloat(trend.average_score),
        improvement: parseFloat(trend.score_change),
        improvementPercent: (parseFloat(trend.score_change) / previousScore) * 100,
        periodsOfGrowth: parseInt(growthPeriods?.count as string) || 1,
        consistency: 1 - (parseFloat(trend.std_deviation) / 100),
        createdAt: new Date(),
      });
    }

    return reports;
  },

  /**
   * Predict future risk for a teacher (MUST ADD)
   */
  async predictFutureRisk(teacherId: string, elementId?: string): Promise<{
    overallRisk: number;
    riskLevel: RiskLevel;
    contributingFactors: string[];
    projectedScore: number;
    confidence: number;
    recommendations: string[];
  }> {
    // Get historical trends
    const trends = await db('teacher_performance_trends')
      .where('teacher_id', teacherId)
      .modify((qb) => {
        if (elementId) qb.where('element_id', elementId);
      })
      .orderBy('period_start', 'desc')
      .limit(6);

    if (trends.length < 2) {
      return {
        overallRisk: 0.2,
        riskLevel: 'low',
        contributingFactors: ['Insufficient data for accurate prediction'],
        projectedScore: 75,
        confidence: 0.3,
        recommendations: ['Continue regular observations to build data history'],
      };
    }

    // Calculate velocity (rate of change)
    const recentTrends = trends.slice(0, 3);
    const avgChange = recentTrends.reduce((sum, t) => sum + parseFloat(t.score_change || 0), 0) / recentTrends.length;
    const currentScore = parseFloat(trends[0].average_score);
    const stdDev = parseFloat(trends[0].std_deviation || 0);

    // Project future score
    const projectedScore = Math.max(0, Math.min(100, currentScore + avgChange));

    // Calculate risk factors
    const contributingFactors: string[] = [];
    let riskScore = 0;

    // Factor 1: Current score below threshold
    if (currentScore < 60) {
      riskScore += 0.3;
      contributingFactors.push('Current score below proficiency threshold');
    } else if (currentScore < 70) {
      riskScore += 0.15;
      contributingFactors.push('Current score approaching warning threshold');
    }

    // Factor 2: Declining trend
    if (avgChange < -5) {
      riskScore += 0.25;
      contributingFactors.push('Consistent declining trend');
    } else if (avgChange < 0) {
      riskScore += 0.1;
      contributingFactors.push('Slight downward trend');
    }

    // Factor 3: High volatility
    if (stdDev > 15) {
      riskScore += 0.15;
      contributingFactors.push('High score variability');
    }

    // Factor 4: Below school average
    const schoolAvg = parseFloat(trends[0].school_average || 75);
    if (currentScore < schoolAvg - 10) {
      riskScore += 0.1;
      contributingFactors.push('Significantly below school average');
    }

    // Factor 5: Low percentile
    const percentile = parseFloat(trends[0].percentile_rank || 50);
    if (percentile < 25) {
      riskScore += 0.1;
      contributingFactors.push('Bottom quartile performance');
    }

    // Normalize risk score
    const overallRisk = Math.min(1, Math.max(0, riskScore));
    const riskLevel: RiskLevel = overallRisk >= 0.7 ? 'critical' :
      overallRisk >= 0.5 ? 'high' :
        overallRisk >= 0.3 ? 'medium' : 'low';

    // Generate recommendations
    const recommendations = this.generateRiskRecommendations(riskLevel, contributingFactors, currentScore);

    // Calculate confidence based on data quality
    const confidence = Math.min(0.9, 0.5 + (trends.length * 0.05) + (1 - stdDev / 50) * 0.2);

    return {
      overallRisk,
      riskLevel,
      contributingFactors,
      projectedScore,
      confidence,
      recommendations,
    };
  },

  /**
   * Get school-wide trend overview
   */
  async getSchoolOverview(schoolId: string): Promise<SchoolTrendSummary> {
    const school = await db('schools').where('id', schoolId).first();
    if (!school) {
      throw new Error('School not found');
    }

    const { periodStart, periodEnd } = this.getPeriodBoundaries('month');

    // Get all teachers in school
    const teachers = await db('teachers').where('school_id', schoolId).where('status', 'active');
    const teacherIds = teachers.map(t => t.id);

    // Get latest trends for all teachers
    const trends = await db('teacher_performance_trends')
      .whereIn('teacher_id', teacherIds)
      .where('period_start', '>=', periodStart)
      .where('period_end', '<=', periodEnd);

    // Aggregate by teacher
    const teacherScores: Record<string, { scores: number[]; direction: TrendDirection; riskLevel: RiskLevel }> = {};

    for (const trend of trends) {
      if (!teacherScores[trend.teacher_id]) {
        teacherScores[trend.teacher_id] = { scores: [], direction: 'stable', riskLevel: 'low' };
      }
      teacherScores[trend.teacher_id].scores.push(parseFloat(trend.average_score));
      teacherScores[trend.teacher_id].direction = trend.trend_direction;
      teacherScores[trend.teacher_id].riskLevel = trend.risk_level || 'low';
    }

    // Calculate overall stats
    let improvingCount = 0, decliningCount = 0, stableCount = 0, atRiskCount = 0;
    const topPerformers: Array<{ teacherId: string; teacherName: string; score: number }> = [];
    const needsAttention: Array<{ teacherId: string; teacherName: string; score: number; riskLevel: RiskLevel }> = [];

    for (const teacher of teachers) {
      const data = teacherScores[teacher.id];
      if (!data || data.scores.length === 0) continue;

      const avgScore = data.scores.reduce((a, b) => a + b, 0) / data.scores.length;

      if (data.direction === 'up') improvingCount++;
      else if (data.direction === 'down') decliningCount++;
      else stableCount++;

      if (data.riskLevel === 'high' || data.riskLevel === 'critical') {
        atRiskCount++;
        needsAttention.push({ teacherId: teacher.id, teacherName: teacher.name, score: avgScore, riskLevel: data.riskLevel });
      }

      if (avgScore >= 85) {
        topPerformers.push({ teacherId: teacher.id, teacherName: teacher.name, score: avgScore });
      }
    }

    // Sort top performers and needs attention
    topPerformers.sort((a, b) => b.score - a.score);
    needsAttention.sort((a, b) => {
      if (a.riskLevel === 'critical' && b.riskLevel !== 'critical') return -1;
      if (b.riskLevel === 'critical' && a.riskLevel !== 'critical') return 1;
      return a.score - b.score;
    });

    // Get domain averages
    const domainAverages = await db('teacher_performance_trends as t')
      .leftJoin('rubric_elements as e', 't.element_id', 'e.id')
      .leftJoin('rubric_domains as d', 'e.domain_id', 'd.id')
      .whereIn('t.teacher_id', teacherIds)
      .where('t.period_start', '>=', periodStart)
      .groupBy('d.id', 'd.name')
      .select(
        'd.id as domain_id',
        'd.name as domain_name',
        db.raw('AVG(t.average_score) as average'),
        db.raw("MODE() WITHIN GROUP (ORDER BY t.trend_direction) as trend")
      );

    const overallAverage = Object.values(teacherScores)
      .flatMap(ts => ts.scores)
      .reduce((sum, s, _, arr) => sum + s / arr.length, 0);

    return {
      schoolId,
      schoolName: school.name,
      periodStart,
      periodEnd,
      overallAverage,
      teacherCount: teachers.length,
      improvingCount,
      decliningCount,
      stableCount,
      atRiskCount,
      topPerformers: topPerformers.slice(0, 5),
      needsAttention: needsAttention.slice(0, 5),
      domainAverages: domainAverages.map((d: any) => ({
        domainId: d.domain_id,
        domainName: d.domain_name,
        average: parseFloat(d.average) || 0,
        trend: d.trend || 'stable',
      })),
    };
  },

  // ===========================================
  // Helper Methods
  // ===========================================

  getPeriodBoundaries(periodType: PeriodType): { periodStart: Date; periodEnd: Date } {
    const now = new Date();
    const periodEnd = new Date(now);
    let periodStart: Date;

    switch (periodType) {
      case 'week':
        periodStart = new Date(now);
        periodStart.setDate(now.getDate() - 7);
        break;
      case 'month':
        periodStart = new Date(now);
        periodStart.setMonth(now.getMonth() - 1);
        break;
      case 'quarter':
        periodStart = new Date(now);
        periodStart.setMonth(now.getMonth() - 3);
        break;
      case 'year':
        periodStart = new Date(now);
        periodStart.setFullYear(now.getFullYear() - 1);
        break;
    }

    return { periodStart, periodEnd };
  },

  getPreviousPeriod(periodType: PeriodType, currentStart: Date): { start: Date; end: Date } {
    const end = new Date(currentStart);
    end.setDate(end.getDate() - 1);
    const start = new Date(end);

    switch (periodType) {
      case 'week':
        start.setDate(end.getDate() - 6);
        break;
      case 'month':
        start.setMonth(end.getMonth() - 1);
        break;
      case 'quarter':
        start.setMonth(end.getMonth() - 3);
        break;
      case 'year':
        start.setFullYear(end.getFullYear() - 1);
        break;
    }

    return { start, end };
  },

  calculateTrendDirection(scoreChange: number): TrendDirection {
    if (scoreChange > 3) return 'up';
    if (scoreChange < -3) return 'down';
    return 'stable';
  },

  async getSchoolAverage(schoolId: string, periodStart: Date, periodEnd: Date): Promise<number> {
    const result = await db('teacher_performance_trends as t')
      .leftJoin('teachers as te', 't.teacher_id', 'te.id')
      .where('te.school_id', schoolId)
      .where('t.period_start', '>=', periodStart)
      .where('t.period_end', '<=', periodEnd)
      .avg('t.average_score as avg')
      .first();

    return parseFloat(result?.avg) || 75;
  },

  async calculatePercentileRank(
    teacherId: string,
    elementId: string,
    score: number,
    periodStart: Date,
    periodEnd: Date
  ): Promise<number> {
    // Get teacher's school
    const teacher = await db('teachers').where('id', teacherId).first();
    if (!teacher?.school_id) return 50;

    // Get all scores for this element in the school
    const allScores = await db('teacher_performance_trends as t')
      .leftJoin('teachers as te', 't.teacher_id', 'te.id')
      .where('te.school_id', teacher.school_id)
      .where('t.element_id', elementId)
      .where('t.period_start', '>=', periodStart)
      .where('t.period_end', '<=', periodEnd)
      .pluck('t.average_score');

    if (allScores.length === 0) return 50;

    const numericScores = allScores.map(s => parseFloat(s) || 0).sort((a, b) => a - b);
    const rank = numericScores.filter(s => s < score).length;

    return (rank / numericScores.length) * 100;
  },

  async assessRisk(
    teacherId: string,
    elementId: string,
    currentScore: number,
    scoreChange: number,
    stdDev: number,
    observationCount: number
  ): Promise<{ riskLevel: RiskLevel; predictedRisk: number; riskFactors: string[] }> {
    const riskFactors: string[] = [];
    let riskScore = 0;

    if (currentScore < 50) {
      riskScore += 0.4;
      riskFactors.push('Score below 50');
    } else if (currentScore < 60) {
      riskScore += 0.25;
      riskFactors.push('Score below proficiency');
    }

    if (scoreChange < -10) {
      riskScore += 0.25;
      riskFactors.push('Significant score decline');
    } else if (scoreChange < -5) {
      riskScore += 0.1;
      riskFactors.push('Moderate score decline');
    }

    if (stdDev > 20) {
      riskScore += 0.15;
      riskFactors.push('High score variability');
    }

    if (observationCount < 3) {
      riskScore += 0.1;
      riskFactors.push('Limited observation data');
    }

    const predictedRisk = Math.min(1, Math.max(0, riskScore));
    const riskLevel: RiskLevel = predictedRisk >= 0.6 ? 'critical' :
      predictedRisk >= 0.4 ? 'high' :
        predictedRisk >= 0.2 ? 'medium' : 'low';

    return { riskLevel, predictedRisk, riskFactors };
  },

  getRecommendedAction(severity: 'critical' | 'warning', decline: number, currentScore: number): string {
    if (severity === 'critical') {
      return 'Immediate intervention required. Schedule meeting with teacher and develop improvement plan.';
    }
    if (currentScore < 60) {
      return 'Performance below expectations. Consider coaching support and targeted professional development.';
    }
    return 'Monitor closely. Schedule observation to identify areas for support.';
  },

  generateRiskRecommendations(riskLevel: RiskLevel, factors: string[], currentScore: number): string[] {
    const recommendations: string[] = [];

    if (riskLevel === 'critical' || riskLevel === 'high') {
      recommendations.push('Schedule immediate coaching intervention');
      recommendations.push('Develop targeted improvement plan with measurable goals');
    }

    if (factors.includes('Consistent declining trend')) {
      recommendations.push('Conduct root cause analysis through teacher conversation');
    }

    if (factors.includes('High score variability')) {
      recommendations.push('Review for consistency factors (class composition, time of day)');
    }

    if (currentScore < 60) {
      recommendations.push('Assign mentor teacher for peer support');
      recommendations.push('Identify specific professional development opportunities');
    }

    if (recommendations.length === 0) {
      recommendations.push('Continue regular observation schedule');
      recommendations.push('Provide positive reinforcement for maintained performance');
    }

    return recommendations;
  },

  async getTrendById(trendId: string): Promise<TrendDataPoint> {
    const trend = await db('teacher_performance_trends').where('id', trendId).first();
    if (!trend) throw new Error('Trend not found');
    return this.formatTrend(trend);
  },

  formatTrend(row: any): TrendDataPoint {
    return {
      id: row.id,
      teacherId: row.teacher_id,
      elementId: row.element_id,
      templateId: row.template_id,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      periodType: row.period_type,
      averageScore: parseFloat(row.average_score) || 0,
      scoreChange: parseFloat(row.score_change) || 0,
      trendDirection: row.trend_direction,
      observationCount: row.observation_count || 0,
      minScore: parseFloat(row.min_score) || 0,
      maxScore: parseFloat(row.max_score) || 0,
      stdDeviation: parseFloat(row.std_deviation) || 0,
      confidenceAverage: parseFloat(row.confidence_average) || 0,
      schoolAverage: parseFloat(row.school_average) || 0,
      percentileRank: parseFloat(row.percentile_rank) || 0,
      riskLevel: row.risk_level,
      predictedFutureRisk: row.predicted_future_risk ? parseFloat(row.predicted_future_risk) : undefined,
      riskFactors: typeof row.risk_factors === 'string' ? JSON.parse(row.risk_factors) : row.risk_factors || [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  },
};

export default trendAnalysisService;
