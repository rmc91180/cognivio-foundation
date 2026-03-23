import type { Knex } from 'knex';

/**
 * Migration: Enhance AI Observations
 *
 * Adds new columns to support comprehensive multi-level AI analysis:
 * - Executive summary for quick overview
 * - Detailed analysis for in-depth assessment
 * - Domain summary for domain-level rollups
 * - Evidence timestamps for video moment references
 * - Recommendations for improvement suggestions
 * - Processing metrics for performance tracking
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('ai_observations', (table) => {
    // Multi-level analysis content
    table.text('detailed_analysis').comment('Full-length detailed analysis of the teaching moment');
    table.text('executive_summary').comment('2-3 paragraph high-level summary');
    table.text('domain_summary').comment('Domain-level analysis and patterns');

    // Evidence and recommendations
    table.jsonb('evidence_timestamps').defaultTo('[]').comment('Array of {timestamp_seconds, description, score_impact}');
    table.specificType('recommendations', 'text[]').defaultTo('{}').comment('Actionable improvement suggestions');

    // Processing metrics
    table.integer('processing_time_ms').comment('Time taken to generate this analysis');
    table.integer('token_count').comment('Total tokens used for this analysis');
    table.integer('frame_count').comment('Number of video frames analyzed');

    // Overall assessment fields
    table.text('overall_justification').comment('Explanation of why the score was given');
    table.jsonb('strengths').defaultTo('[]').comment('Array of identified strengths');
    table.jsonb('growth_areas').defaultTo('[]').comment('Array of areas needing improvement');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('ai_observations', (table) => {
    table.dropColumn('detailed_analysis');
    table.dropColumn('executive_summary');
    table.dropColumn('domain_summary');
    table.dropColumn('evidence_timestamps');
    table.dropColumn('recommendations');
    table.dropColumn('processing_time_ms');
    table.dropColumn('token_count');
    table.dropColumn('frame_count');
    table.dropColumn('overall_justification');
    table.dropColumn('strengths');
    table.dropColumn('growth_areas');
  });
}
