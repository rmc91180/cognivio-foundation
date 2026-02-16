import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../utils/db';
import { authenticateToken } from '../middleware/auth';
import { logAudit } from '../services/auditService';
import { notesService } from '../services/notesService';
import { feedbackService } from '../services/feedbackService';

const router = Router();

/**
 * POST /api/video/upload
 * Upload a video for AI analysis (stub - simulates upload)
 *
 * TODO: Implement real video upload with:
 * - Multipart file handling (multer)
 * - S3/GCS storage
 * - Presigned URL generation
 */
router.post('/upload', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { teacherId, classId, filename, anonymize } = req.body;
    const userId = req.user!.userId;
    const schoolId = req.user!.schoolId;

    if (!schoolId) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'User must be associated with a school',
        },
      });
    }

    if (!teacherId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'teacherId is required',
        },
      });
    }

    // Verify teacher exists
    const teacher = await db('teachers')
      .where('id', teacherId)
      .where('school_id', schoolId)
      .first();

    if (!teacher) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Teacher not found',
        },
      });
    }

    // Create video record (stub - no actual file upload)
    const videoId = uuidv4();
    const stubFilename = filename || `classroom_observation_${Date.now()}.mp4`;

    await db('video_evidence').insert({
      id: videoId,
      teacher_id: teacherId,
      class_id: classId || null,
      original_filename: stubFilename,
      clip_url: `https://stub-cdn.example.com/videos/${videoId}.mp4`,
      thumbnail_url: `https://stub-cdn.example.com/thumbs/${videoId}.jpg`,
      storage_path: `/uploads/${videoId}/${stubFilename}`,
      start_ts: new Date(),
      end_ts: new Date(Date.now() + 45 * 60 * 1000), // 45 min duration
      duration_seconds: 2700,
      file_size_bytes: 500000000, // ~500MB
      mime_type: 'video/mp4',
      anonymized: anonymize || false,
      processing_status: 'pending',
      uploaded_by: userId,
    });

    await logAudit({
      userId,
      action: 'video_upload',
      targetType: 'video_evidence',
      targetId: videoId,
      details: { teacherId, filename: stubFilename },
    });

    // In a real implementation, this would trigger a background job
    // For the stub, we'll mark it as processing
    setTimeout(async () => {
      await db('video_evidence')
        .where('id', videoId)
        .update({ processing_status: 'processing' });
    }, 1000);

    return res.status(202).json({
      success: true,
      data: {
        videoId,
        status: 'pending',
        estimatedCompletion: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        uploadedAt: new Date().toISOString(),
        message: 'Video upload simulated. Run `npm run worker` to process and generate AI observations.',
      },
    });
  } catch (error) {
    console.error('Video upload error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An error occurred',
      },
    });
  }
});

/**
 * GET /api/video/:videoId/status
 * Check video processing status
 */
router.get('/:videoId/status', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { videoId } = req.params;
    const schoolId = req.user!.schoolId;
    if (!schoolId) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'User must be associated with a school',
        },
      });
    }

    const video = await db('video_evidence as v')
      .join('teachers as t', 'v.teacher_id', 't.id')
      .where('v.id', videoId)
      .where('t.school_id', schoolId)
      .select('v.*')
      .first();

    if (!video) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Video not found',
        },
      });
    }

    // Get AI observation count
    const aiCount = await db('ai_observations')
      .where('video_id', videoId)
      .count('id as count')
      .first();

    return res.json({
      success: true,
      data: {
        videoId,
        status: video.processing_status,
        clipUrl: video.clip_url,
        thumbnailUrl: video.thumbnail_url,
        aiObservationCount: parseInt(aiCount?.count as string) || 0,
        processingError: video.processing_error,
        processedAt: video.processed_at?.toISOString(),
        uploadedAt: video.created_at.toISOString(),
      },
    });
  } catch (error) {
    console.error('Get video status error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An error occurred',
      },
    });
  }
});

/**
 * GET /api/video/:videoId
 * Get video details
 */
router.get('/:videoId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { videoId } = req.params;
    const schoolId = req.user!.schoolId;
    if (!schoolId) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'User must be associated with a school',
        },
      });
    }

    const video = await db('video_evidence as v')
      .join('teachers as t', 'v.teacher_id', 't.id')
      .where('v.id', videoId)
      .where('t.school_id', schoolId)
      .select('v.*')
      .first();

    if (!video) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Video not found',
        },
      });
    }

    // Get AI observations
    const observations = await db('ai_observations')
      .where('video_id', videoId)
      .orderBy('start_ts');

    return res.json({
      success: true,
      data: {
        video,
        observations,
      },
    });
  } catch (error) {
    console.error('Get video error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An error occurred',
      },
    });
  }
});

/**
 * GET /api/video/:videoId/analysis
 * Get comprehensive AI analysis for a video
 *
 * Returns:
 * - Executive summary
 * - Domain-level summaries
 * - Element-level scores with evidence
 * - Recommendations
 * - Processing metadata
 */
router.get('/:videoId/analysis', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { videoId } = req.params;
    const schoolId = req.user!.schoolId;
    if (!schoolId) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'User must be associated with a school',
        },
      });
    }

    // Get video with teacher info
    const video = await db('video_evidence as v')
      .join('teachers as t', 'v.teacher_id', 't.id')
      .where('v.id', videoId)
      .where('t.school_id', schoolId)
      .select('v.*', 't.name as teacher_name', 't.subjects', 't.grades')
      .first();

    if (!video) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Video not found',
        },
      });
    }

    if (video.processing_status !== 'completed') {
      return res.json({
        success: true,
        data: {
          status: video.processing_status,
          message: video.processing_status === 'pending'
            ? 'Video is queued for analysis. Run `npm run worker` to process.'
            : video.processing_status === 'processing'
            ? 'Video analysis is in progress...'
            : `Video processing failed: ${video.processing_error}`,
        },
      });
    }

    // Get all observations with element details
    const observations = await db('ai_observations as o')
      .join('rubric_elements as e', 'o.element_id', 'e.id')
      .join('rubric_domains as d', 'e.domain_id', 'd.id')
      .where('o.video_id', videoId)
      .select(
        'o.*',
        'e.name as element_name',
        'e.description as element_description',
        'd.name as domain_name',
        'd.id as domain_id'
      )
      .orderBy('d.sort_order')
      .orderBy('e.sort_order');

    if (observations.length === 0) {
      return res.json({
        success: true,
        data: {
          status: 'no_observations',
          message: 'No AI observations found for this video.',
        },
      });
    }

    // Get processing metadata
    const metadata = await db('video_processing_metadata')
      .where('video_id', videoId)
      .first();

    // Group observations by domain
    const domainMap = new Map<string, any[]>();
    for (const obs of observations) {
      const domainName = obs.domain_name || 'Unknown';
      if (!domainMap.has(domainName)) {
        domainMap.set(domainName, []);
      }
      domainMap.get(domainName)!.push(obs);
    }

    // Build domain summaries
    const domainSummaries = Array.from(domainMap.entries()).map(([domainName, domainObs]) => {
      const scores = domainObs.map((o) => o.score_estimate);
      const avgScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
      const avgConfidence = domainObs.reduce((sum, o) => sum + (o.confidence || 0), 0) / domainObs.length;

      // Get the first observation's domain_summary (they should all be the same for a domain)
      const domainSummary = domainObs[0]?.domain_summary || '';

      // Collect strengths and growth areas
      const strengths = domainObs
        .filter((o) => o.score_estimate >= 75)
        .map((o) => o.element_name);
      const growthAreas = domainObs
        .filter((o) => o.score_estimate < 62.5)
        .map((o) => o.element_name);

      return {
        domain_name: domainName,
        average_score: Math.round(avgScore * 10) / 10,
        average_confidence: Math.round(avgConfidence * 100) / 100,
        summary: domainSummary,
        element_count: domainObs.length,
        strengths,
        growth_areas: growthAreas,
        elements: domainObs.map((o) => ({
          id: o.element_id,
          name: o.element_name,
          description: o.element_description,
          score: o.score_estimate,
          confidence: o.confidence,
          summary: o.summary,
          detailed_analysis: o.detailed_analysis,
          key_moments: o.key_moments,
          recommendations: o.recommendations,
          evidence_timestamps: o.evidence_timestamps,
        })),
      };
    });

    // Calculate overall metrics
    const allScores = observations.map((o: any) => o.score_estimate);
    const overallScore = allScores.reduce((sum: number, s: number) => sum + s, 0) / allScores.length;
    const overallConfidence =
      observations.reduce((sum: number, o: any) => sum + (o.confidence || 0), 0) / observations.length;

    // Determine performance level
    let performanceLevel = 'Basic';
    if (overallScore >= 87.5) performanceLevel = 'Distinguished';
    else if (overallScore >= 62.5) performanceLevel = 'Proficient';
    else if (overallScore >= 37.5) performanceLevel = 'Basic';
    else performanceLevel = 'Unsatisfactory';

    // Get executive summary (from first observation - they should all have the same)
    const executiveSummary = observations[0]?.executive_summary || '';
    const overallJustification = observations[0]?.overall_justification || '';

    // Collect all recommendations and deduplicate
    const allRecommendations = observations
      .flatMap((o: any) => o.recommendations || [])
      .filter((r: string, idx: number, arr: string[]) => arr.indexOf(r) === idx)
      .slice(0, 10);

    // Collect strengths and growth areas
    const topStrengths = observations
      .filter((o: any) => o.score_estimate >= 75)
      .sort((a: any, b: any) => b.score_estimate - a.score_estimate)
      .slice(0, 5)
      .map((o: any) => o.element_name);

    const topGrowthAreas = observations
      .filter((o: any) => o.score_estimate < 62.5)
      .sort((a: any, b: any) => a.score_estimate - b.score_estimate)
      .slice(0, 5)
      .map((o: any) => o.element_name);

    // Get notes for observations on this video
    const observationIds = observations.map((o: any) => o.id);
    let userNotes: any[] = [];
    let noteCounts: Record<string, number> = {};
    let feedback: any[] = [];

    if (observationIds.length > 0) {
      // Get notes for all observations
      const notesResult = await notesService.getNotes(
        { videoId, page: 1, pageSize: 100 },
        req.user!.userId
      );
      userNotes = notesResult.notes;

      // Get feedback for first observation (represents the video analysis)
      if (observationIds[0]) {
        feedback = await feedbackService.getFeedbackForObservation(observationIds[0]);
      }

      // Get note counts by type
      if (observationIds[0]) {
        noteCounts = await notesService.getNoteCountsByType(observationIds[0]);
      }
    }

    return res.json({
      success: true,
      data: {
        video: {
          id: video.id,
          teacher_name: video.teacher_name,
          subjects: video.subjects,
          grades: video.grades,
          duration_seconds: video.duration_seconds,
          processed_at: video.processed_at,
        },
        analysis: {
          executive_summary: executiveSummary,
          overall_rating: {
            score: Math.round(overallScore * 10) / 10,
            score_4_scale: Math.round((overallScore / 25) * 10) / 10,
            performance_level: performanceLevel,
            confidence: Math.round(overallConfidence * 100) / 100,
            justification: overallJustification,
          },
          domain_summaries: domainSummaries,
          top_strengths: topStrengths,
          top_growth_areas: topGrowthAreas,
          recommendations: allRecommendations,
          total_elements_analyzed: observations.length,
        },
        processing: metadata
          ? {
              frames_analyzed: metadata.frames_extracted,
              tokens_used: metadata.total_tokens_used,
              cost_usd: metadata.estimated_cost_usd,
              model: metadata.model_used,
              processing_time_ms:
                metadata.ai_analysis_completed_at && metadata.ai_analysis_started_at
                  ? new Date(metadata.ai_analysis_completed_at).getTime() -
                    new Date(metadata.ai_analysis_started_at).getTime()
                  : null,
            }
          : null,
        // User notes and feedback
        notes: {
          items: userNotes,
          counts: noteCounts,
          total: userNotes.length,
        },
        feedback: {
          items: feedback,
          total: feedback.length,
          has_user_feedback: feedback.some((f: any) => f.userId === req.user!.userId),
        },
      },
    });
  } catch (error) {
    console.error('Get video analysis error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An error occurred',
      },
    });
  }
});

/**
 * GET /api/video/:videoId/report
 * Get formatted assessment report for a video
 */
router.get('/:videoId/report', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { videoId } = req.params;
    const { format } = req.query; // 'json' or 'text' (default: json)
    const schoolId = req.user!.schoolId;
    if (!schoolId) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'User must be associated with a school',
        },
      });
    }

    // Get video with teacher info
    const video = await db('video_evidence as v')
      .join('teachers as t', 'v.teacher_id', 't.id')
      .where('v.id', videoId)
      .where('t.school_id', schoolId)
      .where('v.processing_status', 'completed')
      .select('v.*', 't.name as teacher_name')
      .first();

    if (!video) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Completed video analysis not found',
        },
      });
    }

    // Get observations
    const observations = await db('ai_observations as o')
      .join('rubric_elements as e', 'o.element_id', 'e.id')
      .join('rubric_domains as d', 'e.domain_id', 'd.id')
      .where('o.video_id', videoId)
      .select('o.*', 'e.name as element_name', 'd.name as domain_name')
      .orderBy('d.sort_order')
      .orderBy('e.sort_order');

    if (observations.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NO_OBSERVATIONS',
          message: 'No AI observations found for this video',
        },
      });
    }

    // Calculate overall score
    const overallScore =
      observations.reduce((sum: number, o: any) => sum + o.score_estimate, 0) / observations.length;

    let performanceLevel = 'Basic';
    if (overallScore >= 87.5) performanceLevel = 'Distinguished';
    else if (overallScore >= 62.5) performanceLevel = 'Proficient';
    else if (overallScore >= 37.5) performanceLevel = 'Basic';
    else performanceLevel = 'Unsatisfactory';

    if (format === 'text') {
      // Generate text report
      let report = `# TEACHER ASSESSMENT REPORT\n\n`;
      report += `**Teacher:** ${video.teacher_name}\n`;
      report += `**Date:** ${new Date(video.processed_at).toLocaleDateString()}\n`;
      report += `**Video Duration:** ${Math.round(video.duration_seconds / 60)} minutes\n\n`;

      report += `## Executive Summary\n\n`;
      report += observations[0]?.executive_summary || 'No summary available.\n';
      report += '\n\n';

      report += `## Overall Rating\n\n`;
      report += `**Score:** ${overallScore.toFixed(1)}/100 (${(overallScore / 25).toFixed(1)}/4)\n`;
      report += `**Performance Level:** ${performanceLevel}\n\n`;
      report += `**Justification:** ${observations[0]?.overall_justification || 'N/A'}\n\n`;

      // Domain sections
      const domainMap = new Map<string, any[]>();
      for (const obs of observations) {
        const domain = obs.domain_name || 'Unknown';
        if (!domainMap.has(domain)) domainMap.set(domain, []);
        domainMap.get(domain)!.push(obs);
      }

      report += `## Domain Analysis\n\n`;
      for (const [domain, domainObs] of domainMap) {
        const domainAvg = domainObs.reduce((s: number, o: any) => s + o.score_estimate, 0) / domainObs.length;
        report += `### ${domain}\n\n`;
        report += `**Average Score:** ${domainAvg.toFixed(1)}/100\n\n`;
        if (domainObs[0]?.domain_summary) {
          report += domainObs[0].domain_summary + '\n\n';
        }
        report += '**Elements:**\n';
        for (const obs of domainObs) {
          report += `- ${obs.element_name}: ${obs.score_estimate.toFixed(0)}/100\n`;
        }
        report += '\n';
      }

      // Recommendations
      const recommendations = observations
        .flatMap((o: any) => o.recommendations || [])
        .filter((r: string, i: number, a: string[]) => a.indexOf(r) === i)
        .slice(0, 5);

      if (recommendations.length > 0) {
        report += `## Recommendations\n\n`;
        recommendations.forEach((rec: string, idx: number) => {
          report += `${idx + 1}. ${rec}\n`;
        });
      }

      res.setHeader('Content-Type', 'text/plain');
      return res.send(report);
    }

    // Default: JSON format
    return res.json({
      success: true,
      data: {
        teacher_name: video.teacher_name,
        video_date: video.processed_at,
        video_duration_minutes: Math.round(video.duration_seconds / 60),
        overall_score: Math.round(overallScore * 10) / 10,
        performance_level: performanceLevel,
        executive_summary: observations[0]?.executive_summary,
        overall_justification: observations[0]?.overall_justification,
        elements_analyzed: observations.length,
        observations: observations.map((o: any) => ({
          domain: o.domain_name,
          element: o.element_name,
          score: o.score_estimate,
          confidence: o.confidence,
          summary: o.summary,
          recommendations: o.recommendations,
        })),
      },
    });
  } catch (error) {
    console.error('Get video report error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An error occurred',
      },
    });
  }
});

export default router;
