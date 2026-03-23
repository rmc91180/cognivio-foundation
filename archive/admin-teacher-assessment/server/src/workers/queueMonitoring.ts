/**
 * Queue Monitoring Worker
 *
 * Monitors the AI training and processing queues:
 * 1. Tracks queue depth and processing rates
 * 2. Generates alerts for queue backlogs
 * 3. Creates periodic reports on AI learning progress
 * 4. Monitors system health metrics
 * 5. Sends notifications for important events
 *
 * Usage: npx tsx src/workers/queueMonitoring.ts
 */

import 'dotenv/config';
import { db } from '../utils/db';
import { logAudit } from '../services/auditService';

/**
 * Worker configuration
 */
interface QueueMonitoringConfig {
  pollIntervalMs: number;
  alertThresholds: {
    queueDepthWarning: number;
    queueDepthCritical: number;
    processingRateMin: number;
    failureRateMax: number;
    staleEntryMinutes: number;
  };
  reportIntervalMs: number;
}

const DEFAULT_CONFIG: QueueMonitoringConfig = {
  pollIntervalMs: parseInt(process.env.QUEUE_MONITOR_POLL_INTERVAL_MS || '30000'), // 30 seconds
  alertThresholds: {
    queueDepthWarning: parseInt(process.env.QUEUE_DEPTH_WARNING || '100'),
    queueDepthCritical: parseInt(process.env.QUEUE_DEPTH_CRITICAL || '500'),
    processingRateMin: parseFloat(process.env.PROCESSING_RATE_MIN || '0.5'), // per minute
    failureRateMax: parseFloat(process.env.FAILURE_RATE_MAX || '0.1'), // 10%
    staleEntryMinutes: parseInt(process.env.STALE_ENTRY_MINUTES || '30'),
  },
  reportIntervalMs: parseInt(process.env.REPORT_INTERVAL_MS || '3600000'), // 1 hour
};

/**
 * Queue statistics
 */
interface QueueStats {
  trainingQueue: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    stale: number;
  };
  videoQueue: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  };
  processingRates: {
    trainingPerMinute: number;
    videoPerMinute: number;
  };
  failureRates: {
    training: number;
    video: number;
  };
}

/**
 * Alert types
 */
type AlertLevel = 'info' | 'warning' | 'critical';

interface Alert {
  level: AlertLevel;
  type: string;
  message: string;
  timestamp: Date;
  metadata: Record<string, any>;
}

/**
 * Worker state
 */
let isShuttingDown = false;
let lastReportTime = Date.now();
let activeAlerts: Alert[] = [];

/**
 * Get current queue statistics
 */
async function getQueueStats(): Promise<QueueStats> {
  // Training queue stats
  const trainingStats = await db('ai_training_queue')
    .select('status')
    .count('* as count')
    .groupBy('status');

  const trainingByStatus: Record<string, number> = {};
  trainingStats.forEach((s: any) => {
    trainingByStatus[s.status] = parseInt(s.count);
  });

  // Count stale training entries
  const staleThreshold = new Date();
  staleThreshold.setMinutes(staleThreshold.getMinutes() - DEFAULT_CONFIG.alertThresholds.staleEntryMinutes);

  const staleCount = await db('ai_training_queue')
    .where('status', 'processing')
    .where('processed_at', '<', staleThreshold)
    .count('* as count')
    .first();

  // Video queue stats
  const videoStats = await db('video_evidence')
    .select('processing_status')
    .count('* as count')
    .groupBy('processing_status');

  const videoByStatus: Record<string, number> = {};
  videoStats.forEach((s: any) => {
    videoByStatus[s.processing_status] = parseInt(s.count);
  });

  // Calculate processing rates (last hour)
  const oneHourAgo = new Date();
  oneHourAgo.setHours(oneHourAgo.getHours() - 1);

  const trainingCompletedLastHour = await db('ai_training_queue')
    .where('status', 'completed')
    .where('completed_at', '>=', oneHourAgo)
    .count('* as count')
    .first();

  const videoCompletedLastHour = await db('video_evidence')
    .where('processing_status', 'completed')
    .where('processed_at', '>=', oneHourAgo)
    .count('* as count')
    .first();

  // Calculate failure rates
  const totalTraining = Object.values(trainingByStatus).reduce((a, b) => a + b, 0);
  const totalVideo = Object.values(videoByStatus).reduce((a, b) => a + b, 0);

  return {
    trainingQueue: {
      pending: trainingByStatus['pending'] || 0,
      processing: trainingByStatus['processing'] || 0,
      completed: trainingByStatus['completed'] || 0,
      failed: trainingByStatus['failed'] || 0,
      stale: parseInt(String(staleCount?.count || '0')),
    },
    videoQueue: {
      pending: videoByStatus['pending'] || 0,
      processing: videoByStatus['processing'] || 0,
      completed: videoByStatus['completed'] || 0,
      failed: videoByStatus['failed'] || 0,
    },
    processingRates: {
      trainingPerMinute: parseInt(String(trainingCompletedLastHour?.count || '0')) / 60,
      videoPerMinute: parseInt(String(videoCompletedLastHour?.count || '0')) / 60,
    },
    failureRates: {
      training: totalTraining > 0 ? (trainingByStatus['failed'] || 0) / totalTraining : 0,
      video: totalVideo > 0 ? (videoByStatus['failed'] || 0) / totalVideo : 0,
    },
  };
}

/**
 * Get AI learning metrics
 */
async function getLearningMetrics(): Promise<Record<string, any>> {
  // Active model version
  const activeVersion = await db('ai_model_versions')
    .where('status', 'active')
    .first();

  // Total corrections
  const totalCorrections = await db('ai_learning_history')
    .count('* as count')
    .first();

  // Corrections by framework
  const correctionsByFramework = await db('ai_learning_history')
    .select('framework_type')
    .count('* as count')
    .avg('score_delta as avg_delta')
    .groupBy('framework_type');

  // Average delta trend (last 7 days vs previous 7 days)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  const recentAvgDelta = await db('ai_learning_history')
    .where('created_at', '>=', sevenDaysAgo)
    .avg('score_delta as avg_delta')
    .first();

  const previousAvgDelta = await db('ai_learning_history')
    .where('created_at', '>=', fourteenDaysAgo)
    .where('created_at', '<', sevenDaysAgo)
    .avg('score_delta as avg_delta')
    .first();

  // Top corrected elements
  const topCorrectedElements = await db('ai_learning_history')
    .select('element_id')
    .count('* as correction_count')
    .avg('score_delta as avg_delta')
    .groupBy('element_id')
    .orderBy('correction_count', 'desc')
    .limit(10);

  return {
    activeModelVersion: activeVersion?.version || 'N/A',
    totalCorrections: parseInt(String(totalCorrections?.count || '0')),
    correctionsByFramework,
    deltaTrend: {
      recent: parseFloat(recentAvgDelta?.avg_delta || '0'),
      previous: parseFloat(previousAvgDelta?.avg_delta || '0'),
      improving: Math.abs(parseFloat(recentAvgDelta?.avg_delta || '0')) < Math.abs(parseFloat(previousAvgDelta?.avg_delta || '0')),
    },
    topCorrectedElements,
  };
}

/**
 * Check for alert conditions
 */
function checkAlerts(stats: QueueStats, config: QueueMonitoringConfig): Alert[] {
  const alerts: Alert[] = [];
  const now = new Date();
  const thresholds = config.alertThresholds;

  // Queue depth alerts
  const totalPending = stats.trainingQueue.pending + stats.videoQueue.pending;

  if (totalPending >= thresholds.queueDepthCritical) {
    alerts.push({
      level: 'critical',
      type: 'queue_depth',
      message: `Critical queue backlog: ${totalPending} items pending`,
      timestamp: now,
      metadata: { pending: totalPending },
    });
  } else if (totalPending >= thresholds.queueDepthWarning) {
    alerts.push({
      level: 'warning',
      type: 'queue_depth',
      message: `Queue backlog warning: ${totalPending} items pending`,
      timestamp: now,
      metadata: { pending: totalPending },
    });
  }

  // Processing rate alerts
  if (stats.processingRates.trainingPerMinute < thresholds.processingRateMin && stats.trainingQueue.pending > 10) {
    alerts.push({
      level: 'warning',
      type: 'processing_rate',
      message: `Low training processing rate: ${stats.processingRates.trainingPerMinute.toFixed(2)}/min`,
      timestamp: now,
      metadata: { rate: stats.processingRates.trainingPerMinute },
    });
  }

  // Failure rate alerts
  if (stats.failureRates.training > thresholds.failureRateMax) {
    alerts.push({
      level: 'critical',
      type: 'failure_rate',
      message: `High training failure rate: ${(stats.failureRates.training * 100).toFixed(1)}%`,
      timestamp: now,
      metadata: { rate: stats.failureRates.training },
    });
  }

  if (stats.failureRates.video > thresholds.failureRateMax) {
    alerts.push({
      level: 'critical',
      type: 'failure_rate',
      message: `High video processing failure rate: ${(stats.failureRates.video * 100).toFixed(1)}%`,
      timestamp: now,
      metadata: { rate: stats.failureRates.video },
    });
  }

  // Stale entries alert
  if (stats.trainingQueue.stale > 0) {
    alerts.push({
      level: 'warning',
      type: 'stale_entries',
      message: `${stats.trainingQueue.stale} stale training entries detected`,
      timestamp: now,
      metadata: { count: stats.trainingQueue.stale },
    });
  }

  return alerts;
}

/**
 * Process alerts
 */
async function processAlerts(alerts: Alert[]): Promise<void> {
  for (const alert of alerts) {
    // Check if this is a new alert
    const existing = activeAlerts.find(
      (a) => a.type === alert.type && a.level === alert.level
    );

    if (!existing) {
      // New alert - log it
      console.log(`[${alert.level.toUpperCase()}] ${alert.message}`);

      await logAudit({
        userId: 'system',
        action: `queue_alert_${alert.type}`,
        targetType: 'queue_monitor',
        targetId: alert.type,
        details: {
          level: alert.level,
          message: alert.message,
          ...alert.metadata,
        },
      });

      // Could add notification sending here (email, Slack, etc.)
      activeAlerts.push(alert);
    }
  }

  // Clear resolved alerts
  activeAlerts = activeAlerts.filter((active) =>
    alerts.some((a) => a.type === active.type && a.level === active.level)
  );
}

/**
 * Generate periodic report
 */
async function generateReport(stats: QueueStats): Promise<void> {
  const metrics = await getLearningMetrics();

  console.log('\n' + '═'.repeat(60));
  console.log('          AI LEARNING SYSTEM STATUS REPORT');
  console.log('═'.repeat(60));
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log('');

  console.log('QUEUE STATUS');
  console.log('─'.repeat(40));
  console.log('Training Queue:');
  console.log(`  Pending:    ${stats.trainingQueue.pending}`);
  console.log(`  Processing: ${stats.trainingQueue.processing}`);
  console.log(`  Completed:  ${stats.trainingQueue.completed}`);
  console.log(`  Failed:     ${stats.trainingQueue.failed}`);
  console.log('');
  console.log('Video Queue:');
  console.log(`  Pending:    ${stats.videoQueue.pending}`);
  console.log(`  Processing: ${stats.videoQueue.processing}`);
  console.log(`  Completed:  ${stats.videoQueue.completed}`);
  console.log(`  Failed:     ${stats.videoQueue.failed}`);
  console.log('');

  console.log('PROCESSING RATES');
  console.log('─'.repeat(40));
  console.log(`  Training: ${stats.processingRates.trainingPerMinute.toFixed(2)}/min`);
  console.log(`  Video:    ${stats.processingRates.videoPerMinute.toFixed(2)}/min`);
  console.log('');

  console.log('AI LEARNING METRICS');
  console.log('─'.repeat(40));
  console.log(`  Active Model: ${metrics.activeModelVersion}`);
  console.log(`  Total Corrections: ${metrics.totalCorrections}`);
  console.log(`  Delta Trend: ${metrics.deltaTrend.improving ? '↓ Improving' : '↑ Needs attention'}`);
  console.log(`    Recent Avg: ${metrics.deltaTrend.recent.toFixed(2)}`);
  console.log(`    Previous Avg: ${metrics.deltaTrend.previous.toFixed(2)}`);
  console.log('');

  console.log('TOP CORRECTED ELEMENTS');
  console.log('─'.repeat(40));
  metrics.topCorrectedElements.slice(0, 5).forEach((elem: any, i: number) => {
    console.log(`  ${i + 1}. ${elem.element_id}: ${elem.correction_count} corrections (avg Δ: ${parseFloat(elem.avg_delta).toFixed(1)})`);
  });
  console.log('');

  console.log('ACTIVE ALERTS');
  console.log('─'.repeat(40));
  if (activeAlerts.length === 0) {
    console.log('  None');
  } else {
    activeAlerts.forEach((alert) => {
      console.log(`  [${alert.level.toUpperCase()}] ${alert.message}`);
    });
  }

  console.log('═'.repeat(60) + '\n');

  // Log audit for report generation
  await logAudit({
    userId: 'system',
    action: 'queue_monitoring_report',
    targetType: 'queue_monitor',
    targetId: 'periodic_report',
    details: {
      trainingPending: stats.trainingQueue.pending,
      videoPending: stats.videoQueue.pending,
      totalCorrections: metrics.totalCorrections,
      activeModelVersion: metrics.activeModelVersion,
      activeAlerts: activeAlerts.length,
    },
  });
}

/**
 * Main worker loop
 */
async function runQueueMonitoringWorker(config: QueueMonitoringConfig = DEFAULT_CONFIG): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           Queue Monitoring Worker                          ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Poll interval: ${config.pollIntervalMs}ms`);
  console.log(`Report interval: ${config.reportIntervalMs}ms`);
  console.log('Alert thresholds:');
  console.log(`  Queue depth warning: ${config.alertThresholds.queueDepthWarning}`);
  console.log(`  Queue depth critical: ${config.alertThresholds.queueDepthCritical}`);
  console.log(`  Max failure rate: ${config.alertThresholds.failureRateMax * 100}%`);
  console.log('');
  console.log('Starting queue monitoring worker...\n');

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
      // Get current stats
      const stats = await getQueueStats();

      // Check for alerts
      const alerts = checkAlerts(stats, config);
      await processAlerts(alerts);

      // Generate report if interval has passed
      if (Date.now() - lastReportTime >= config.reportIntervalMs) {
        await generateReport(stats);
        lastReportTime = Date.now();
      } else {
        // Brief status update
        console.log(`[${new Date().toISOString()}] Training: ${stats.trainingQueue.pending} pending | Video: ${stats.videoQueue.pending} pending | Alerts: ${activeAlerts.length}`);
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
    } catch (error) {
      console.error('Queue monitoring worker error:', error);
      await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
    }
  }
}

// Run worker if called directly
if (require.main === module) {
  runQueueMonitoringWorker().catch((error) => {
    console.error('Queue monitoring worker failed:', error);
    process.exit(1);
  });
}

export {
  runQueueMonitoringWorker,
  getQueueStats,
  getLearningMetrics,
  checkAlerts,
  generateReport,
};
