import type { Knex } from 'knex';

/**
 * Migration: Add Video Processing Metadata
 *
 * Creates a table to track detailed video processing information:
 * - Frame extraction timing and counts
 * - AI analysis timing and token usage
 * - Cost tracking for budget management
 * - Error logging for debugging
 * - Retry tracking for reliability
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('video_processing_metadata', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('video_id').references('id').inTable('video_evidence').onDelete('CASCADE').notNullable();

    // Frame extraction tracking
    table.timestamp('frame_extraction_started_at');
    table.timestamp('frame_extraction_completed_at');
    table.integer('frames_extracted').comment('Number of frames successfully extracted');
    table.integer('frames_requested').comment('Number of frames requested based on video duration');
    table.specificType('frame_timestamps', 'integer[]').defaultTo('{}').comment('Timestamps (seconds) where frames were extracted');

    // AI analysis tracking
    table.timestamp('ai_analysis_started_at');
    table.timestamp('ai_analysis_completed_at');
    table.integer('elements_analyzed').comment('Number of rubric elements analyzed');
    table.integer('batches_processed').comment('Number of API batches processed');

    // Token and cost tracking
    table.integer('total_input_tokens').defaultTo(0);
    table.integer('total_output_tokens').defaultTo(0);
    table.integer('total_tokens_used').defaultTo(0);
    table.decimal('estimated_cost_usd', 10, 4).defaultTo(0).comment('Estimated cost in USD');

    // Model information
    table.string('model_used', 100).comment('AI model used (e.g., gpt-4o)');
    table.string('model_version', 100).comment('Specific model version');

    // Processing status
    table.string('status', 30).defaultTo('pending').comment('pending, extracting_frames, analyzing, synthesizing, completed, failed');
    table.integer('retry_count').defaultTo(0);
    table.integer('max_retries').defaultTo(3);

    // Error tracking
    table.jsonb('error_log').defaultTo('[]').comment('Array of error objects with timestamps');
    table.text('last_error_message');
    table.string('last_error_code', 50);

    // Quality metrics
    table.decimal('average_confidence', 5, 2).comment('Average confidence across all observations');
    table.decimal('min_confidence', 5, 2).comment('Minimum confidence score');
    table.decimal('max_confidence', 5, 2).comment('Maximum confidence score');

    // Timestamps
    table.timestamps(true, true);
  });

  // Index for efficient lookups
  await knex.schema.raw(`
    CREATE INDEX idx_video_processing_metadata_video_id ON video_processing_metadata(video_id);
    CREATE INDEX idx_video_processing_metadata_status ON video_processing_metadata(status);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('video_processing_metadata');
}
