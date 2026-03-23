/**
 * AI Learning Reinforcement Worker
 *
 * Processes the training queue and applies learning corrections:
 * 1. Monitors the ai_training_queue for pending entries
 * 2. Batches corrections for efficient processing
 * 3. Calculates pattern-based adjustments
 * 4. Updates confidence scores based on correction history
 * 5. Generates learning insights for reporting
 *
 * Usage: npx tsx src/workers/learningReinforcement.ts
 */

import 'dotenv/config';
import { db } from '../utils/db';
import { logAudit } from '../services/auditService';
import { v4 as uuidv4 } from 'uuid';

/**
 * Worker configuration
 */
interface LearningReinforcementConfig {
  pollIntervalMs: number;
  batchSize: number;
  minExpertiseWeight: number;
  maxBatchRetries: number;
  confidenceDecayFactor: number;
}

const DEFAULT_CONFIG: LearningReinforcementConfig = {
  pollIntervalMs: parseInt(process.env.LEARNING_POLL_INTERVAL_MS || '60000'), // 1 minute
  batchSize: parseInt(process.env.LEARNING_BATCH_SIZE || '50'),
  minExpertiseWeight: parseFloat(process.env.MIN_EXPERTISE_WEIGHT || '0.5'),
  maxBatchRetries: parseInt(process.env.MAX_BATCH_RETRIES || '3'),
  confidenceDecayFactor: parseFloat(process.env.CONFIDENCE_DECAY_FACTOR || '0.02'),
};

/**
 * Training queue entry
 */
interface QueueEntry {
  id: string;
  learningHistoryId: string;
  status: string;
  priority: number;
  retryCount: number;
  batchId: string | null;
}

/**
 * Learning correction data
 */
interface CorrectionData {
  id: string;
  teacherId: string;
  elementId: string;
  originalAiScore: number;
  correctedScore: number;
  scoreDelta: number;
  aiConfidence: number;
  frameworkType: string;
  domainName: string;
  reviewerExpertiseWeight: number;
  modelVersion: string;
}

/**
 * Pattern insight
 */
interface PatternInsight {
  elementId: string;
  frameworkType: string;
  avgDelta: number;
  sampleCount: number;
  direction: 'overscore' | 'underscore' | 'accurate';
  confidence: number;
  recommendation: string;
}

/**
 * Worker state
 */
let isShuttingDown = false;

/**
 * Get pending queue entries
 */
async function getPendingQueueEntries(limit: number): Promise<QueueEntry[]> {
  return await db('ai_training_queue')
    .where('status', 'pending')
    .orderBy('priority', 'asc')
    .orderBy('created_at', 'asc')
    .limit(limit);
}

/**
 * Get correction data for a learning history entry
 */
async function getCorrectionData(learningHistoryId: string): Promise<CorrectionData | null> {
  const entry = await db('ai_learning_history')
    .where('id', learningHistoryId)
    .first();

  if (!entry) return null;

  return {
    id: entry.id,
    teacherId: entry.teacher_id,
    elementId: entry.element_id,
    originalAiScore: entry.original_ai_score,
    correctedScore: entry.corrected_score,
    scoreDelta: entry.score_delta,
    aiConfidence: entry.ai_confidence,
    frameworkType: entry.framework_type,
    domainName: entry.domain_name,
    reviewerExpertiseWeight: entry.reviewer_expertise_weight,
    modelVersion: entry.model_version,
  };
}

/**
 * Create a new batch for processing
 */
async function createBatch(entries: QueueEntry[]): Promise<string> {
  const batchId = `batch_${Date.now()}_${uuidv4().substring(0, 8)}`;

  await db('ai_training_queue')
    .whereIn('id', entries.map(e => e.id))
    .update({
      status: 'processing',
      batch_id: batchId,
      processed_at: new Date(),
    });

  console.log(`Created batch ${batchId} with ${entries.length} entries`);
  return batchId;
}

/**
 * Process a batch of corrections
 */
async function processBatch(batchId: string, config: LearningReinforcementConfig): Promise<void> {
  const entries = await db('ai_training_queue')
    .where('batch_id', batchId)
    .where('status', 'processing');

  const corrections: CorrectionData[] = [];

  for (const entry of entries) {
    const data = await getCorrectionData(entry.learning_history_id);
    if (data && data.reviewerExpertiseWeight >= config.minExpertiseWeight) {
      corrections.push(data);
    }
  }

  if (corrections.length === 0) {
    console.log(`Batch ${batchId}: No valid corrections to process`);
    await markBatchComplete(batchId);
    return;
  }

  console.log(`Processing ${corrections.length} corrections in batch ${batchId}`);

  // Group corrections by element for pattern analysis
  const byElement = groupByElement(corrections);

  // Calculate and apply adjustments
  for (const [elementKey, elementCorrections] of Object.entries(byElement)) {
    await applyElementAdjustments(elementKey, elementCorrections, config);
  }

  // Update cumulative statistics
  await updateCumulativeStats(corrections);

  // Mark batch as complete
  await markBatchComplete(batchId);

  // Log audit
  await logAudit({
    userId: 'system',
    action: 'learning_batch_processed',
    targetType: 'ai_training_batch',
    targetId: batchId,
    details: {
      correctionCount: corrections.length,
      elementsAffected: Object.keys(byElement).length,
    },
  });
}

/**
 * Group corrections by element
 */
function groupByElement(corrections: CorrectionData[]): Record<string, CorrectionData[]> {
  const groups: Record<string, CorrectionData[]> = {};

  for (const correction of corrections) {
    const key = `${correction.frameworkType}:${correction.elementId}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(correction);
  }

  return groups;
}

/**
 * Apply adjustments for a specific element
 */
async function applyElementAdjustments(
  elementKey: string,
  corrections: CorrectionData[],
  config: LearningReinforcementConfig
): Promise<void> {
  // Calculate weighted average adjustment
  let totalWeight = 0;
  let weightedDelta = 0;

  for (const correction of corrections) {
    const weight = correction.reviewerExpertiseWeight;
    weightedDelta += correction.scoreDelta * weight;
    totalWeight += weight;
  }

  const avgDelta = totalWeight > 0 ? weightedDelta / totalWeight : 0;

  // Determine direction
  const direction: 'overscore' | 'underscore' | 'accurate' =
    avgDelta < -5 ? 'overscore' : avgDelta > 5 ? 'underscore' : 'accurate';

  // Calculate confidence adjustment
  const correctionCount = corrections.length;
  const confidenceAdjustment = Math.max(
    0.5,
    1.0 - Math.abs(avgDelta) * config.confidenceDecayFactor - correctionCount * 0.01
  );

  console.log(`  ${elementKey}: avgDelta=${avgDelta.toFixed(2)}, direction=${direction}, confidenceAdj=${confidenceAdjustment.toFixed(3)}`);

  // Store pattern insight
  const [frameworkType, elementId] = elementKey.split(':');
  await storePatternInsight({
    elementId,
    frameworkType,
    avgDelta,
    sampleCount: corrections.length,
    direction,
    confidence: confidenceAdjustment,
    recommendation: generateRecommendation(direction, avgDelta),
  });
}

/**
 * Generate recommendation based on pattern
 */
function generateRecommendation(direction: string, avgDelta: number): string {
  const magnitude = Math.abs(avgDelta);

  if (direction === 'accurate') {
    return 'AI scoring is well-calibrated for this element.';
  }

  if (direction === 'overscore') {
    if (magnitude > 15) {
      return 'Significant overscoring detected. Consider recalibrating AI criteria for this element.';
    }
    return 'Moderate overscoring tendency. Monitor and adjust scoring criteria.';
  }

  if (magnitude > 15) {
    return 'Significant underscoring detected. AI may be too strict on this element.';
  }
  return 'Moderate underscoring tendency. Consider loosening AI criteria.';
}

/**
 * Store a pattern insight
 */
async function storePatternInsight(insight: PatternInsight): Promise<void> {
  // Check for existing insight
  const existing = await db('ai_learning_history')
    .where('element_id', insight.elementId)
    .where('framework_type', insight.frameworkType)
    .select(
      db.raw('COUNT(*) as total_corrections'),
      db.raw('AVG(score_delta) as cumulative_avg_delta')
    )
    .first();

  // Update the model version config with this insight
  const activeVersion = await db('ai_model_versions')
    .where('status', 'active')
    .first();

  if (activeVersion) {
    const config = JSON.parse(activeVersion.config || '{}');
    const elementKey = `${insight.frameworkType}:${insight.elementId}`;

    if (!config.patternInsights) config.patternInsights = {};
    config.patternInsights[elementKey] = {
      avgDelta: insight.avgDelta,
      sampleCount: insight.sampleCount,
      direction: insight.direction,
      confidence: insight.confidence,
      lastUpdated: new Date().toISOString(),
    };

    await db('ai_model_versions')
      .where('version', activeVersion.version)
      .update({
        config: JSON.stringify(config),
      });
  }
}

/**
 * Update cumulative statistics for teachers
 */
async function updateCumulativeStats(corrections: CorrectionData[]): Promise<void> {
  // Group by teacher
  const byTeacher: Record<string, CorrectionData[]> = {};
  for (const correction of corrections) {
    if (!byTeacher[correction.teacherId]) byTeacher[correction.teacherId] = [];
    byTeacher[correction.teacherId].push(correction);
  }

  for (const [teacherId, teacherCorrections] of Object.entries(byTeacher)) {
    // Update cumulative stats in ai_learning_history
    const avgDelta = teacherCorrections.reduce((sum, c) => sum + c.scoreDelta, 0) / teacherCorrections.length;

    // Get current cumulative values
    const existing = await db('ai_learning_history')
      .where('teacher_id', teacherId)
      .orderBy('created_at', 'desc')
      .first();

    if (existing) {
      const newCumulative = (existing.cumulative_corrections || 0) + teacherCorrections.length;
      const newAvgDelta = ((existing.average_delta || 0) * (existing.cumulative_corrections || 0) + avgDelta * teacherCorrections.length) / newCumulative;

      // Update latest entry with cumulative values
      await db('ai_learning_history')
        .where('id', existing.id)
        .update({
          cumulative_corrections: newCumulative,
          average_delta: newAvgDelta,
        });
    }
  }
}

/**
 * Mark batch as complete
 */
async function markBatchComplete(batchId: string): Promise<void> {
  await db('ai_training_queue')
    .where('batch_id', batchId)
    .update({
      status: 'completed',
      completed_at: new Date(),
    });
}

/**
 * Handle failed entries
 */
async function handleFailedEntries(config: LearningReinforcementConfig): Promise<void> {
  // Get stuck processing entries (older than 10 minutes)
  const stuckThreshold = new Date();
  stuckThreshold.setMinutes(stuckThreshold.getMinutes() - 10);

  const stuckEntries = await db('ai_training_queue')
    .where('status', 'processing')
    .where('processed_at', '<', stuckThreshold);

  for (const entry of stuckEntries) {
    if (entry.retry_count >= config.maxBatchRetries) {
      await db('ai_training_queue')
        .where('id', entry.id)
        .update({
          status: 'failed',
          error_message: 'Max retries exceeded',
        });
      console.log(`Entry ${entry.id} marked as failed after ${entry.retry_count} retries`);
    } else {
      await db('ai_training_queue')
        .where('id', entry.id)
        .update({
          status: 'pending',
          batch_id: null,
          retry_count: entry.retry_count + 1,
        });
      console.log(`Entry ${entry.id} reset for retry (attempt ${entry.retry_count + 1})`);
    }
  }
}

/**
 * Main worker loop
 */
async function runLearningReinforcementWorker(config: LearningReinforcementConfig = DEFAULT_CONFIG): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           AI Learning Reinforcement Worker                 ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Poll interval: ${config.pollIntervalMs}ms`);
  console.log(`Batch size: ${config.batchSize}`);
  console.log(`Min expertise weight: ${config.minExpertiseWeight}`);
  console.log('');
  console.log('Starting learning reinforcement worker...\n');

  // Handle graceful shutdown
  const shutdown = () => {
    console.log('\nReceived shutdown signal...');
    isShuttingDown = true;
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Main loop
  while (!isShuttingDown) {
    try {
      console.log(`\n--- Learning Check: ${new Date().toISOString()} ---`);

      // Handle any stuck/failed entries
      await handleFailedEntries(config);

      // Get pending entries
      const pendingEntries = await getPendingQueueEntries(config.batchSize);

      if (pendingEntries.length > 0) {
        console.log(`Found ${pendingEntries.length} pending queue entries`);

        // Create and process batch
        const batchId = await createBatch(pendingEntries);
        await processBatch(batchId, config);
      } else {
        console.log('No pending queue entries');
      }

      // Log queue stats
      const stats = await db('ai_training_queue')
        .select('status')
        .count('* as count')
        .groupBy('status');

      console.log('Queue stats:', stats.reduce((acc: any, s: any) => {
        acc[s.status] = parseInt(s.count);
        return acc;
      }, {}));

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
    } catch (error) {
      console.error('Learning reinforcement worker error:', error);
      await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
    }
  }
}

// Run worker if called directly
if (require.main === module) {
  runLearningReinforcementWorker().catch((error) => {
    console.error('Learning reinforcement worker failed:', error);
    process.exit(1);
  });
}

export {
  runLearningReinforcementWorker,
  processBatch,
  getPendingQueueEntries,
  createBatch,
};
