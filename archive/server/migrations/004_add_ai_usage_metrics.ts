import type { Knex } from 'knex';

/**
 * Migration: Add AI Usage Metrics
 *
 * Creates a table to track daily AI usage and costs:
 * - Aggregate token usage by day and model
 * - Cost tracking for budget monitoring
 * - Quality metrics for model performance
 * - Supports daily budget alerts and reporting
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('ai_usage_metrics', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));

    // Date and model grouping
    table.date('date').notNullable();
    table.string('model', 50).notNullable().comment('AI model name (e.g., gpt-4o)');

    // Request counts
    table.integer('total_requests').defaultTo(0);
    table.integer('successful_requests').defaultTo(0);
    table.integer('failed_requests').defaultTo(0);

    // Token usage
    table.bigInteger('total_input_tokens').defaultTo(0);
    table.bigInteger('total_output_tokens').defaultTo(0);
    table.bigInteger('total_tokens').defaultTo(0);

    // Cost tracking
    table.decimal('total_cost_usd', 10, 4).defaultTo(0);
    table.decimal('avg_cost_per_request', 10, 6).defaultTo(0);

    // Quality metrics
    table.decimal('avg_confidence', 5, 4).comment('Average confidence score (0-1)');
    table.decimal('avg_processing_time_ms', 10, 2).comment('Average processing time in milliseconds');

    // Video counts
    table.integer('videos_processed').defaultTo(0);
    table.integer('frames_analyzed').defaultTo(0);
    table.integer('elements_scored').defaultTo(0);

    // Budget tracking
    table.decimal('daily_budget_usd', 10, 4).comment('Budget limit for the day');
    table.boolean('budget_exceeded').defaultTo(false);
    table.timestamp('budget_exceeded_at');

    // Timestamps
    table.timestamps(true, true);

    // Unique constraint on date + model
    table.unique(['date', 'model']);
  });

  // Index for date range queries
  await knex.schema.raw(`
    CREATE INDEX idx_ai_usage_metrics_date ON ai_usage_metrics(date);
    CREATE INDEX idx_ai_usage_metrics_model ON ai_usage_metrics(model);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('ai_usage_metrics');
}
