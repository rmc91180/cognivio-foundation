/**
 * AI Model Versioning Worker
 *
 * Manages the lifecycle of AI model versions:
 * 1. Monitors for new training data reaching thresholds
 * 2. Triggers model version creation based on correction patterns
 * 3. Handles model activation/deprecation
 * 4. Archives old model versions
 *
 * Usage: npx tsx src/workers/modelVersioning.ts
 */

import 'dotenv/config';
import { db } from '../utils/db';
import { logAudit } from '../services/auditService';

/**
 * Worker configuration
 */
interface ModelVersioningConfig {
  pollIntervalMs: number;
  minCorrectionsForNewVersion: number;
  minAccuracyGainThreshold: number;
  maxActiveVersions: number;
  versionArchiveAfterDays: number;
}

const DEFAULT_CONFIG: ModelVersioningConfig = {
  pollIntervalMs: parseInt(process.env.MODEL_VERSION_POLL_INTERVAL_MS || '3600000'), // 1 hour
  minCorrectionsForNewVersion: parseInt(process.env.MIN_CORRECTIONS_FOR_VERSION || '100'),
  minAccuracyGainThreshold: parseFloat(process.env.MIN_ACCURACY_GAIN || '0.02'), // 2%
  maxActiveVersions: parseInt(process.env.MAX_ACTIVE_VERSIONS || '3'),
  versionArchiveAfterDays: parseInt(process.env.VERSION_ARCHIVE_DAYS || '90'),
};

/**
 * Model version metrics
 */
interface VersionMetrics {
  version: string;
  totalPredictions: number;
  totalCorrections: number;
  averageDelta: number;
  accuracyScore: number;
  elementAccuracy: Record<string, number>;
}

/**
 * Worker state
 */
let isShuttingDown = false;

/**
 * Get current active model version
 */
async function getActiveModelVersion(): Promise<string | null> {
  const version = await db('ai_model_versions')
    .where('status', 'active')
    .first();
  return version?.version || null;
}

/**
 * Get metrics for a model version
 */
async function getVersionMetrics(version: string): Promise<VersionMetrics | null> {
  const stats = await db('ai_learning_history')
    .where('model_version', version)
    .select(
      db.raw('COUNT(*) as total_corrections'),
      db.raw('AVG(ABS(score_delta)) as avg_delta'),
      db.raw('SUM(CASE WHEN ABS(score_delta) <= 10 THEN 1 ELSE 0 END)::float / COUNT(*) as accuracy')
    )
    .first();

  const typedStats = stats as { total_corrections?: string; avg_delta?: string; accuracy?: string } | undefined;
  if (!typedStats || parseInt(typedStats.total_corrections || '0') === 0) return null;

  // Get element-level accuracy
  const elementStats = await db('ai_learning_history')
    .where('model_version', version)
    .groupBy('element_id')
    .select(
      'element_id',
      db.raw('AVG(ABS(score_delta)) as avg_delta'),
      db.raw('COUNT(*) as count')
    );

  const elementAccuracy: Record<string, number> = {};
  elementStats.forEach((e: any) => {
    // Accuracy = 1 - (avgDelta / 100), bounded [0, 1]
    elementAccuracy[e.element_id] = Math.max(0, Math.min(1, 1 - e.avg_delta / 100));
  });

  // Estimate total predictions from observations with this model version
  const predictions = await db('ai_observations')
    .where('model_version', version)
    .count('* as count')
    .first();

  return {
    version,
    totalPredictions: parseInt(String(predictions?.count || '0')),
    totalCorrections: parseInt(typedStats.total_corrections || '0'),
    averageDelta: parseFloat(typedStats.avg_delta || '0'),
    accuracyScore: parseFloat(typedStats.accuracy || '0'),
    elementAccuracy,
  };
}

/**
 * Check if new version should be created
 */
async function shouldCreateNewVersion(config: ModelVersioningConfig): Promise<boolean> {
  const activeVersion = await getActiveModelVersion();
  if (!activeVersion) return true;

  // Count unprocessed corrections since last version
  const lastVersionDate = await db('ai_model_versions')
    .where('version', activeVersion)
    .select('created_at')
    .first();

  const newCorrections = await db('ai_learning_history')
    .where('created_at', '>', lastVersionDate?.created_at || new Date(0))
    .where('applied_to_model', false)
    .count('* as count')
    .first();

  const correctionCount = parseInt(String(newCorrections?.count || '0'));
  console.log(`New corrections since ${activeVersion}: ${correctionCount}`);

  return correctionCount >= config.minCorrectionsForNewVersion;
}

/**
 * Generate next version number
 */
async function generateNextVersion(): Promise<string> {
  const latest = await db('ai_model_versions')
    .orderBy('created_at', 'desc')
    .first();

  if (!latest) return '1.0.0';

  const parts = latest.version.split('.').map(Number);
  // Increment patch version
  parts[2] = (parts[2] || 0) + 1;
  return parts.join('.');
}

/**
 * Create a new model version based on accumulated corrections
 */
async function createNewModelVersion(config: ModelVersioningConfig): Promise<string | null> {
  const shouldCreate = await shouldCreateNewVersion(config);
  if (!shouldCreate) {
    console.log('Not enough corrections to create new version');
    return null;
  }

  const newVersion = await generateNextVersion();
  const activeVersion = await getActiveModelVersion();

  console.log(`Creating new model version: ${newVersion}`);

  // Calculate adjustment factors from corrections
  const adjustments = await db('ai_learning_history')
    .where('applied_to_model', false)
    .groupBy('element_id', 'framework_type')
    .select(
      'element_id',
      'framework_type',
      db.raw('AVG(score_delta) as avg_adjustment'),
      db.raw('COUNT(*) as sample_count'),
      db.raw('STDDEV(score_delta) as delta_stddev')
    );

  // Build config with element-specific adjustments
  const versionConfig: Record<string, any> = {
    baseVersion: activeVersion,
    elementAdjustments: {},
    globalBias: 0,
    createdFromCorrections: true,
  };

  let totalAdjustment = 0;
  let adjustmentCount = 0;

  adjustments.forEach((adj: any) => {
    const elementKey = `${adj.framework_type}:${adj.element_id}`;
    versionConfig.elementAdjustments[elementKey] = {
      bias: parseFloat(adj.avg_adjustment),
      sampleCount: parseInt(adj.sample_count),
      stddev: parseFloat(adj.delta_stddev || 0),
    };
    totalAdjustment += parseFloat(adj.avg_adjustment) * parseInt(adj.sample_count);
    adjustmentCount += parseInt(adj.sample_count);
  });

  versionConfig.globalBias = adjustmentCount > 0 ? totalAdjustment / adjustmentCount : 0;

  // Insert new version
  await db('ai_model_versions').insert({
    version: newVersion,
    type: 'scoring',
    name: `Auto-generated v${newVersion}`,
    description: `Model version created from ${adjustmentCount} corrections with ${Object.keys(versionConfig.elementAdjustments).length} element-specific adjustments`,
    config: JSON.stringify(versionConfig),
    status: 'testing',
    created_by: 'system',
    created_at: new Date(),
  });

  // Mark corrections as applied
  await db('ai_learning_history')
    .where('applied_to_model', false)
    .update({
      applied_to_model: true,
      applied_at: new Date(),
    });

  // Log audit
  await logAudit({
    userId: 'system',
    action: 'model_version_created',
    targetType: 'ai_model_version',
    targetId: newVersion,
    details: {
      baseVersion: activeVersion,
      correctionCount: adjustmentCount,
      elementAdjustments: Object.keys(versionConfig.elementAdjustments).length,
      globalBias: versionConfig.globalBias,
    },
  });

  console.log(`Created model version ${newVersion} with ${Object.keys(versionConfig.elementAdjustments).length} element adjustments`);
  return newVersion;
}

/**
 * Evaluate a testing model version for promotion
 */
async function evaluateTestingVersions(): Promise<void> {
  const testingVersions = await db('ai_model_versions')
    .where('status', 'testing')
    .orderBy('created_at', 'asc');

  for (const version of testingVersions) {
    const metrics = await getVersionMetrics(version.version);
    if (!metrics || metrics.totalPredictions < 50) {
      console.log(`Version ${version.version}: Not enough predictions for evaluation (${metrics?.totalPredictions || 0}/50)`);
      continue;
    }

    // Get active version metrics for comparison
    const activeVersion = await getActiveModelVersion();
    const activeMetrics = activeVersion ? await getVersionMetrics(activeVersion) : null;

    // Determine if testing version is better
    const isImprovement = !activeMetrics ||
      metrics.accuracyScore > activeMetrics.accuracyScore + DEFAULT_CONFIG.minAccuracyGainThreshold;

    if (isImprovement) {
      console.log(`Version ${version.version} shows improvement: ${metrics.accuracyScore.toFixed(3)} vs ${activeMetrics?.accuracyScore.toFixed(3) || 'N/A'}`);

      // Auto-promote after significant testing
      if (metrics.totalPredictions >= 200) {
        await promoteVersion(version.version);
      }
    } else {
      console.log(`Version ${version.version} does not show significant improvement`);

      // Deprecate if not improving after substantial testing
      if (metrics.totalPredictions >= 500) {
        await db('ai_model_versions')
          .where('version', version.version)
          .update({
            status: 'deprecated',
            deprecated_at: new Date(),
          });
        console.log(`Deprecated non-improving version ${version.version}`);
      }
    }
  }
}

/**
 * Promote a version to active
 */
async function promoteVersion(version: string): Promise<void> {
  // Demote current active version
  await db('ai_model_versions')
    .where('status', 'active')
    .update({ status: 'deprecated' });

  // Promote new version
  await db('ai_model_versions')
    .where('version', version)
    .update({
      status: 'active',
      activated_at: new Date(),
      activated_by: 'system',
    });

  await logAudit({
    userId: 'system',
    action: 'model_version_promoted',
    targetType: 'ai_model_version',
    targetId: version,
    details: { promotedBySystem: true },
  });

  console.log(`Promoted version ${version} to active`);
}

/**
 * Archive old deprecated versions
 */
async function archiveOldVersions(config: ModelVersioningConfig): Promise<void> {
  const archiveThreshold = new Date();
  archiveThreshold.setDate(archiveThreshold.getDate() - config.versionArchiveAfterDays);

  const toArchive = await db('ai_model_versions')
    .where('status', 'deprecated')
    .where('deprecated_at', '<', archiveThreshold)
    .whereNot('status', 'archived');

  for (const version of toArchive) {
    await db('ai_model_versions')
      .where('version', version.version)
      .update({ status: 'archived' });

    console.log(`Archived version ${version.version}`);
  }
}

/**
 * Main worker loop
 */
async function runModelVersioningWorker(config: ModelVersioningConfig = DEFAULT_CONFIG): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           AI Model Versioning Worker                       ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Poll interval: ${config.pollIntervalMs}ms`);
  console.log(`Min corrections for new version: ${config.minCorrectionsForNewVersion}`);
  console.log(`Min accuracy gain threshold: ${config.minAccuracyGainThreshold}`);
  console.log('');
  console.log('Starting model versioning worker...\n');

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
      console.log(`\n--- Model Version Check: ${new Date().toISOString()} ---`);

      // Check if new version should be created
      const newVersion = await createNewModelVersion(config);
      if (newVersion) {
        console.log(`Created new version: ${newVersion}`);
      }

      // Evaluate testing versions
      await evaluateTestingVersions();

      // Archive old versions
      await archiveOldVersions(config);

      // Log current version status
      const activeVersion = await getActiveModelVersion();
      const metrics = activeVersion ? await getVersionMetrics(activeVersion) : null;
      if (metrics) {
        console.log(`\nActive version ${activeVersion}:`);
        console.log(`  Accuracy: ${(metrics.accuracyScore * 100).toFixed(1)}%`);
        console.log(`  Avg Delta: ${metrics.averageDelta.toFixed(2)}`);
        console.log(`  Corrections: ${metrics.totalCorrections}`);
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
    } catch (error) {
      console.error('Model versioning worker error:', error);
      await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
    }
  }
}

// Run worker if called directly
if (require.main === module) {
  runModelVersioningWorker().catch((error) => {
    console.error('Model versioning worker failed:', error);
    process.exit(1);
  });
}

export {
  runModelVersioningWorker,
  getActiveModelVersion,
  getVersionMetrics,
  createNewModelVersion,
  promoteVersion,
};
