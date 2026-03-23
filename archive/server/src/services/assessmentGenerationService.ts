import { db } from '../utils/db';
import {
  VideoAnalysisResult,
  TokenUsage,
} from './aiAnalysisService';
import {
  ElementAnalysis,
  SynthesisResponse,
  KeyMoment,
} from './promptService';
import { v4 as uuidv4 } from 'uuid';

/**
 * Assessment record to be stored in the database
 */
export interface AIObservationRecord {
  id: string;
  video_id: string;
  element_id: string;
  confidence: number;
  score_estimate: number;
  start_ts?: Date;
  end_ts?: Date;
  summary: string;
  key_moments: KeyMoment[];
  status: string;
  model_version: string;
  raw_response?: object;
  detailed_analysis: string;
  executive_summary: string;
  domain_summary: string;
  evidence_timestamps: object[];
  recommendations: string[];
  processing_time_ms: number;
  token_count: number;
  frame_count: number;
  overall_justification: string;
  strengths: string[];
  growth_areas: string[];
}

/**
 * Video processing metadata record
 */
export interface VideoProcessingMetadataRecord {
  id: string;
  video_id: string;
  frame_extraction_started_at: Date;
  frame_extraction_completed_at: Date;
  frames_extracted: number;
  frames_requested: number;
  frame_timestamps: number[];
  ai_analysis_started_at: Date;
  ai_analysis_completed_at: Date;
  elements_analyzed: number;
  batches_processed: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens_used: number;
  estimated_cost_usd: number;
  model_used: string;
  model_version: string;
  status: string;
  retry_count: number;
  average_confidence: number;
  min_confidence: number;
  max_confidence: number;
}

/**
 * Complete assessment result combining observations and metadata
 */
export interface GeneratedAssessment {
  observations: AIObservationRecord[];
  metadata: VideoProcessingMetadataRecord;
  synthesis: SynthesisResponse;
}

/**
 * Service for generating and storing assessment records
 */
export class AssessmentGenerationService {
  /**
   * Convert element analysis to database observation record
   */
  private elementToObservationRecord(
    videoId: string,
    analysis: ElementAnalysis,
    synthesis: SynthesisResponse,
    videoAnalysis: VideoAnalysisResult,
    videoDuration: number
  ): AIObservationRecord {
    // Find domain summary for this element
    const domainSummary = synthesis.domain_summaries.find((ds) =>
      ds.domain_name.toLowerCase().includes(analysis.element_name.split(':')[0]?.toLowerCase() || '')
    );

    // Calculate timestamps from key moments
    const evidenceTimestamps = analysis.key_moments.map((km) => ({
      timestamp_seconds: km.estimated_timestamp_seconds,
      description: km.description,
      score_impact: km.score_impact,
    }));

    // Estimate start and end times based on key moments
    const moments = analysis.key_moments;
    const startTs = moments.length > 0
      ? new Date(Date.now() - videoDuration * 1000 + moments[0].estimated_timestamp_seconds * 1000)
      : undefined;
    const endTs = moments.length > 0
      ? new Date(Date.now() - videoDuration * 1000 + moments[moments.length - 1].estimated_timestamp_seconds * 1000)
      : undefined;

    return {
      id: uuidv4(),
      video_id: videoId,
      element_id: analysis.element_id,
      confidence: analysis.confidence / 100, // Convert to 0-1 scale
      score_estimate: analysis.score * 25, // Convert 1-4 to 25-100 scale
      start_ts: startTs,
      end_ts: endTs,
      summary: analysis.detailed_analysis,
      key_moments: analysis.key_moments,
      status: 'pending', // Pending human review
      model_version: videoAnalysis.model,
      detailed_analysis: analysis.detailed_analysis,
      executive_summary: synthesis.executive_summary,
      domain_summary: domainSummary?.summary || '',
      evidence_timestamps: evidenceTimestamps,
      recommendations: analysis.recommendations,
      processing_time_ms: Math.round(videoAnalysis.totalProcessingTimeMs / videoAnalysis.elementAnalyses.length),
      token_count: Math.round(videoAnalysis.totalTokenUsage.totalTokens / videoAnalysis.elementAnalyses.length),
      frame_count: videoAnalysis.frameCount,
      overall_justification: synthesis.overall_rating.justification,
      strengths: analysis.evidence.observed_behaviors.filter((b) =>
        analysis.key_moments.some((km) => km.score_impact === 'positive' && km.description.includes(b.substring(0, 20)))
      ),
      growth_areas: analysis.recommendations,
    };
  }

  /**
   * Create video processing metadata record
   */
  private createMetadataRecord(
    videoId: string,
    frameExtractionStart: Date,
    frameExtractionEnd: Date,
    framesExtracted: number,
    framesRequested: number,
    frameTimestamps: number[],
    aiAnalysisStart: Date,
    aiAnalysisEnd: Date,
    videoAnalysis: VideoAnalysisResult
  ): VideoProcessingMetadataRecord {
    // Calculate confidence stats
    const confidences = videoAnalysis.elementAnalyses.map((a) => a.confidence);
    const avgConfidence = confidences.reduce((sum, c) => sum + c, 0) / confidences.length;
    const minConfidence = Math.min(...confidences);
    const maxConfidence = Math.max(...confidences);

    return {
      id: uuidv4(),
      video_id: videoId,
      frame_extraction_started_at: frameExtractionStart,
      frame_extraction_completed_at: frameExtractionEnd,
      frames_extracted: framesExtracted,
      frames_requested: framesRequested,
      frame_timestamps: frameTimestamps,
      ai_analysis_started_at: aiAnalysisStart,
      ai_analysis_completed_at: aiAnalysisEnd,
      elements_analyzed: videoAnalysis.elementAnalyses.length,
      batches_processed: videoAnalysis.batchCount,
      total_input_tokens: videoAnalysis.totalTokenUsage.inputTokens,
      total_output_tokens: videoAnalysis.totalTokenUsage.outputTokens,
      total_tokens_used: videoAnalysis.totalTokenUsage.totalTokens,
      estimated_cost_usd: videoAnalysis.totalTokenUsage.estimatedCostUsd,
      model_used: videoAnalysis.model,
      model_version: videoAnalysis.model,
      status: 'completed',
      retry_count: 0,
      average_confidence: avgConfidence / 100,
      min_confidence: minConfidence / 100,
      max_confidence: maxConfidence / 100,
    };
  }

  /**
   * Generate complete assessment from video analysis results
   */
  generateAssessment(
    videoId: string,
    videoAnalysis: VideoAnalysisResult,
    videoDuration: number,
    frameExtractionStart: Date,
    frameExtractionEnd: Date,
    framesExtracted: number,
    framesRequested: number,
    frameTimestamps: number[],
    aiAnalysisStart: Date,
    aiAnalysisEnd: Date
  ): GeneratedAssessment {
    // Create observation records for each element
    const observations = videoAnalysis.elementAnalyses.map((analysis) =>
      this.elementToObservationRecord(
        videoId,
        analysis,
        videoAnalysis.synthesis,
        videoAnalysis,
        videoDuration
      )
    );

    // Create metadata record
    const metadata = this.createMetadataRecord(
      videoId,
      frameExtractionStart,
      frameExtractionEnd,
      framesExtracted,
      framesRequested,
      frameTimestamps,
      aiAnalysisStart,
      aiAnalysisEnd,
      videoAnalysis
    );

    return {
      observations,
      metadata,
      synthesis: videoAnalysis.synthesis,
    };
  }

  /**
   * Save assessment to database
   */
  async saveAssessment(assessment: GeneratedAssessment): Promise<void> {
    // Use a transaction for consistency
    await db.transaction(async (trx) => {
      // Insert all observations
      for (const obs of assessment.observations) {
        await trx('ai_observations').insert({
          id: obs.id,
          video_id: obs.video_id,
          element_id: obs.element_id,
          confidence: obs.confidence,
          score_estimate: obs.score_estimate,
          start_ts: obs.start_ts,
          end_ts: obs.end_ts,
          summary: obs.summary,
          key_moments: JSON.stringify(obs.key_moments),
          status: obs.status,
          model_version: obs.model_version,
          detailed_analysis: obs.detailed_analysis,
          executive_summary: obs.executive_summary,
          domain_summary: obs.domain_summary,
          evidence_timestamps: JSON.stringify(obs.evidence_timestamps),
          recommendations: obs.recommendations,
          processing_time_ms: obs.processing_time_ms,
          token_count: obs.token_count,
          frame_count: obs.frame_count,
          overall_justification: obs.overall_justification,
          strengths: JSON.stringify(obs.strengths),
          growth_areas: JSON.stringify(obs.growth_areas),
        });
      }

      // Insert metadata
      await trx('video_processing_metadata').insert({
        id: assessment.metadata.id,
        video_id: assessment.metadata.video_id,
        frame_extraction_started_at: assessment.metadata.frame_extraction_started_at,
        frame_extraction_completed_at: assessment.metadata.frame_extraction_completed_at,
        frames_extracted: assessment.metadata.frames_extracted,
        frames_requested: assessment.metadata.frames_requested,
        frame_timestamps: assessment.metadata.frame_timestamps,
        ai_analysis_started_at: assessment.metadata.ai_analysis_started_at,
        ai_analysis_completed_at: assessment.metadata.ai_analysis_completed_at,
        elements_analyzed: assessment.metadata.elements_analyzed,
        batches_processed: assessment.metadata.batches_processed,
        total_input_tokens: assessment.metadata.total_input_tokens,
        total_output_tokens: assessment.metadata.total_output_tokens,
        total_tokens_used: assessment.metadata.total_tokens_used,
        estimated_cost_usd: assessment.metadata.estimated_cost_usd,
        model_used: assessment.metadata.model_used,
        model_version: assessment.metadata.model_version,
        status: assessment.metadata.status,
        retry_count: assessment.metadata.retry_count,
        average_confidence: assessment.metadata.average_confidence,
        min_confidence: assessment.metadata.min_confidence,
        max_confidence: assessment.metadata.max_confidence,
      });

      // Update video processing status
      await trx('video_evidence')
        .where('id', assessment.metadata.video_id)
        .update({
          processing_status: 'completed',
          processed_at: new Date(),
        });
    });
  }

  /**
   * Get teacher assessment summary combining all observations
   */
  async getTeacherAssessmentSummary(teacherId: string): Promise<{
    totalVideos: number;
    averageScore: number;
    scoresByDomain: Record<string, number>;
    recentObservations: AIObservationRecord[];
    overallStrengths: string[];
    overallGrowthAreas: string[];
    performanceLevel: string;
  }> {
    // Get all videos for the teacher
    const videos = await db('video_evidence')
      .where('teacher_id', teacherId)
      .where('processing_status', 'completed');

    if (videos.length === 0) {
      return {
        totalVideos: 0,
        averageScore: 0,
        scoresByDomain: {},
        recentObservations: [],
        overallStrengths: [],
        overallGrowthAreas: [],
        performanceLevel: 'N/A',
      };
    }

    const videoIds = videos.map((v: any) => v.id);

    // Get all observations for these videos
    const observations = await db('ai_observations')
      .whereIn('video_id', videoIds)
      .orderBy('created_at', 'desc');

    // Calculate average score
    const scores = observations.map((o: any) => o.score_estimate);
    const averageScore = scores.reduce((sum: number, s: number) => sum + s, 0) / scores.length;

    // Group scores by domain (from element info)
    const elements = await db('rubric_elements')
      .join('rubric_domains', 'rubric_elements.domain_id', 'rubric_domains.id')
      .whereIn('rubric_elements.id', observations.map((o: any) => o.element_id))
      .select('rubric_elements.id', 'rubric_domains.name as domain_name');

    const elementDomainMap = new Map(elements.map((e: any) => [e.id, e.domain_name]));

    const scoresByDomain: Record<string, { sum: number; count: number }> = {};
    for (const obs of observations) {
      const domain = elementDomainMap.get(obs.element_id) || 'Unknown';
      if (!scoresByDomain[domain]) {
        scoresByDomain[domain] = { sum: 0, count: 0 };
      }
      scoresByDomain[domain].sum += obs.score_estimate;
      scoresByDomain[domain].count++;
    }

    const domainAverages: Record<string, number> = {};
    for (const [domain, data] of Object.entries(scoresByDomain)) {
      domainAverages[domain] = Math.round((data.sum / data.count) * 10) / 10;
    }

    // Get strengths and growth areas from recent observations
    const recentObs = observations.slice(0, 10);
    const allStrengths = recentObs.flatMap((o: any) => o.strengths || []);
    const allGrowthAreas = recentObs.flatMap((o: any) => o.growth_areas || []);

    // Determine performance level
    let performanceLevel = 'Basic';
    if (averageScore >= 87.5) performanceLevel = 'Distinguished';
    else if (averageScore >= 62.5) performanceLevel = 'Proficient';
    else if (averageScore >= 37.5) performanceLevel = 'Basic';
    else performanceLevel = 'Unsatisfactory';

    return {
      totalVideos: videos.length,
      averageScore: Math.round(averageScore * 10) / 10,
      scoresByDomain: domainAverages,
      recentObservations: recentObs,
      overallStrengths: [...new Set(allStrengths)].slice(0, 5),
      overallGrowthAreas: [...new Set(allGrowthAreas)].slice(0, 5),
      performanceLevel,
    };
  }

  /**
   * Generate formatted assessment report for display
   */
  formatAssessmentReport(assessment: GeneratedAssessment): string {
    const { synthesis, observations, metadata } = assessment;

    let report = '';

    // Executive Summary
    report += '# TEACHER ASSESSMENT REPORT\n\n';
    report += '## Executive Summary\n\n';
    report += synthesis.executive_summary + '\n\n';

    // Overall Rating
    report += '## Overall Rating\n\n';
    report += `**Score:** ${synthesis.overall_rating.score.toFixed(1)}/4\n`;
    report += `**Performance Level:** ${synthesis.overall_rating.performance_level}\n\n`;
    report += `**Justification:** ${synthesis.overall_rating.justification}\n\n`;

    // Domain Summaries
    report += '## Domain Analysis\n\n';
    for (const domain of synthesis.domain_summaries) {
      report += `### ${domain.domain_name}\n\n`;
      report += `**Average Score:** ${domain.average_score.toFixed(1)}/4\n\n`;
      report += domain.summary + '\n\n';
      if (domain.key_strengths.length > 0) {
        report += '**Strengths:**\n';
        domain.key_strengths.forEach((s) => (report += `- ${s}\n`));
        report += '\n';
      }
      if (domain.growth_areas.length > 0) {
        report += '**Growth Areas:**\n';
        domain.growth_areas.forEach((g) => (report += `- ${g}\n`));
        report += '\n';
      }
    }

    // Recommendations
    report += '## Prioritized Recommendations\n\n';
    for (const rec of synthesis.prioritized_recommendations) {
      report += `### ${rec.priority}. ${rec.recommendation}\n\n`;
      report += `**Target Areas:** ${rec.target_elements.join(', ')}\n`;
      report += `**Expected Impact:** ${rec.expected_impact}\n\n`;
    }

    // Processing Info
    report += '## Processing Details\n\n';
    report += `- **Frames Analyzed:** ${metadata.frames_extracted}\n`;
    report += `- **Elements Scored:** ${metadata.elements_analyzed}\n`;
    report += `- **AI Model:** ${metadata.model_used}\n`;
    report += `- **Confidence Range:** ${(metadata.min_confidence * 100).toFixed(0)}% - ${(metadata.max_confidence * 100).toFixed(0)}%\n`;
    report += `- **Processing Cost:** $${metadata.estimated_cost_usd.toFixed(4)}\n`;

    return report;
  }
}

// Export singleton instance
export const assessmentGenerationService = new AssessmentGenerationService();
