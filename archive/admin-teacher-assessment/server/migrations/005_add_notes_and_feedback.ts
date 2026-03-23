import type { Knex } from 'knex';

/**
 * Migration: Add Notes and Feedback Tables
 *
 * Creates tables for:
 * 1. observation_notes - User comments/notes on AI observations
 * 2. ai_feedback - Feedback on AI assessment accuracy for training
 * 3. feedback_corrections - Specific score corrections for AI improvement
 */
export async function up(knex: Knex): Promise<void> {
  // ===========================================
  // Observation Notes Table
  // ===========================================
  await knex.schema.createTable('observation_notes', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));

    // Relationships
    table.uuid('observation_id').notNullable()
      .references('id').inTable('ai_observations')
      .onDelete('CASCADE');
    table.uuid('user_id').notNullable()
      .references('id').inTable('users')
      .onDelete('CASCADE');
    table.uuid('video_id')
      .references('id').inTable('video_evidence')
      .onDelete('SET NULL');
    table.uuid('element_id')
      .references('id').inTable('rubric_elements')
      .onDelete('SET NULL')
      .comment('Optional: link note to specific rubric element');

    // Note content
    table.text('content').notNullable().comment('The note text content');
    table.string('note_type', 50).defaultTo('general')
      .comment('Type: general, observation, question, action_item, follow_up');

    // Context
    table.integer('timestamp_seconds').comment('Video timestamp reference if applicable');
    table.jsonb('tags').defaultTo('[]').comment('User-defined tags for organization');
    table.boolean('is_private').defaultTo(false).comment('Private notes only visible to author');
    table.boolean('is_pinned').defaultTo(false).comment('Pinned notes appear at top');

    // Status
    table.string('status', 30).defaultTo('active').comment('active, resolved, archived');
    table.timestamp('resolved_at');
    table.uuid('resolved_by').references('id').inTable('users').onDelete('SET NULL');

    // Timestamps
    table.timestamps(true, true);
  });

  // ===========================================
  // AI Feedback Table
  // ===========================================
  await knex.schema.createTable('ai_feedback', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));

    // Relationships
    table.uuid('observation_id').notNullable()
      .references('id').inTable('ai_observations')
      .onDelete('CASCADE');
    table.uuid('user_id').notNullable()
      .references('id').inTable('users')
      .onDelete('CASCADE');
    table.uuid('video_id')
      .references('id').inTable('video_evidence')
      .onDelete('SET NULL');

    // Overall assessment feedback
    table.integer('accuracy_rating').comment('1-5 scale: How accurate was the overall assessment?');
    table.integer('helpfulness_rating').comment('1-5 scale: How helpful was the assessment?');
    table.integer('detail_rating').comment('1-5 scale: Was the level of detail appropriate?');

    // Agreement metrics
    table.string('overall_agreement', 30)
      .comment('strongly_agree, agree, neutral, disagree, strongly_disagree');
    table.integer('elements_agreed').defaultTo(0).comment('Count of elements user agrees with');
    table.integer('elements_disagreed').defaultTo(0).comment('Count of elements user disagrees with');

    // Qualitative feedback
    table.text('feedback_text').comment('Open-ended feedback from user');
    table.text('what_was_missed').comment('What important aspects did the AI miss?');
    table.text('what_was_incorrect').comment('What did the AI get wrong?');
    table.text('suggestions').comment('User suggestions for improvement');

    // Feedback categories (multi-select via jsonb)
    table.jsonb('feedback_categories').defaultTo('[]')
      .comment('Array of: scoring_accuracy, evidence_quality, recommendation_relevance, summary_clarity, etc.');

    // Training data flags
    table.boolean('approved_for_training').defaultTo(false)
      .comment('Admin approved for AI training dataset');
    table.boolean('contains_corrections').defaultTo(false);
    table.timestamp('approved_at');
    table.uuid('approved_by').references('id').inTable('users').onDelete('SET NULL');

    // Quality indicators
    table.decimal('user_expertise_weight', 3, 2).defaultTo(1.0)
      .comment('Weight based on user role/experience (admin=1.5, principal=1.3, etc.)');

    // Timestamps
    table.timestamps(true, true);

    // Unique constraint: one feedback per user per observation
    table.unique(['observation_id', 'user_id']);
  });

  // ===========================================
  // Feedback Corrections Table
  // ===========================================
  await knex.schema.createTable('feedback_corrections', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));

    // Relationships
    table.uuid('feedback_id').notNullable()
      .references('id').inTable('ai_feedback')
      .onDelete('CASCADE');
    table.uuid('element_id').notNullable()
      .references('id').inTable('rubric_elements')
      .onDelete('CASCADE');
    table.uuid('user_id').notNullable()
      .references('id').inTable('users')
      .onDelete('CASCADE');

    // Score correction
    table.integer('ai_score').notNullable().comment('Original AI score (1-4)');
    table.integer('corrected_score').notNullable().comment('User corrected score (1-4)');
    table.integer('score_difference').comment('Computed: corrected_score - ai_score');

    // Confidence
    table.decimal('ai_confidence', 5, 4).comment('Original AI confidence (0-1)');
    table.string('user_confidence', 30)
      .comment('User confidence in their correction: very_confident, confident, somewhat_confident');

    // Justification
    table.text('correction_reason').comment('Why the user disagrees with AI score');
    table.text('evidence_description').comment('Evidence the user observed that AI missed');
    table.jsonb('timestamp_references').defaultTo('[]')
      .comment('Array of video timestamps supporting correction');

    // Disagreement type
    table.string('disagreement_type', 50)
      .comment('Type: score_too_high, score_too_low, wrong_evidence, missed_evidence, misinterpreted');

    // Training data
    table.boolean('validated').defaultTo(false).comment('Admin validated this correction');
    table.boolean('included_in_training').defaultTo(false);
    table.timestamp('validated_at');
    table.uuid('validated_by').references('id').inTable('users').onDelete('SET NULL');

    // Timestamps
    table.timestamps(true, true);

    // Unique constraint: one correction per element per feedback
    table.unique(['feedback_id', 'element_id']);
  });

  // ===========================================
  // Training Data Export Table (for AI fine-tuning)
  // ===========================================
  await knex.schema.createTable('ai_training_exports', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));

    // Export metadata
    table.string('export_name', 200).notNullable();
    table.text('description');
    table.string('export_format', 50).defaultTo('jsonl').comment('jsonl, csv, parquet');

    // Export parameters
    table.timestamp('data_from').comment('Include data from this date');
    table.timestamp('data_to').comment('Include data to this date');
    table.integer('min_accuracy_rating').comment('Minimum accuracy rating to include');
    table.boolean('validated_only').defaultTo(true).comment('Only include validated corrections');

    // Statistics
    table.integer('total_observations').defaultTo(0);
    table.integer('total_corrections').defaultTo(0);
    table.integer('total_feedback_entries').defaultTo(0);

    // Export status
    table.string('status', 30).defaultTo('pending').comment('pending, processing, completed, failed');
    table.text('file_path').comment('Path to exported file');
    table.bigInteger('file_size_bytes');
    table.text('error_message');

    // User who requested export
    table.uuid('requested_by').references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('completed_at');

    // Timestamps
    table.timestamps(true, true);
  });

  // ===========================================
  // Indexes
  // ===========================================
  await knex.schema.raw(`
    -- Observation notes indexes
    CREATE INDEX idx_observation_notes_observation ON observation_notes(observation_id);
    CREATE INDEX idx_observation_notes_user ON observation_notes(user_id);
    CREATE INDEX idx_observation_notes_video ON observation_notes(video_id);
    CREATE INDEX idx_observation_notes_element ON observation_notes(element_id);
    CREATE INDEX idx_observation_notes_type ON observation_notes(note_type);
    CREATE INDEX idx_observation_notes_status ON observation_notes(status);

    -- AI feedback indexes
    CREATE INDEX idx_ai_feedback_observation ON ai_feedback(observation_id);
    CREATE INDEX idx_ai_feedback_user ON ai_feedback(user_id);
    CREATE INDEX idx_ai_feedback_accuracy ON ai_feedback(accuracy_rating);
    CREATE INDEX idx_ai_feedback_agreement ON ai_feedback(overall_agreement);
    CREATE INDEX idx_ai_feedback_training ON ai_feedback(approved_for_training);

    -- Feedback corrections indexes
    CREATE INDEX idx_feedback_corrections_feedback ON feedback_corrections(feedback_id);
    CREATE INDEX idx_feedback_corrections_element ON feedback_corrections(element_id);
    CREATE INDEX idx_feedback_corrections_validated ON feedback_corrections(validated);
    CREATE INDEX idx_feedback_corrections_score_diff ON feedback_corrections(score_difference);

    -- Training exports indexes
    CREATE INDEX idx_ai_training_exports_status ON ai_training_exports(status);
    CREATE INDEX idx_ai_training_exports_requested_by ON ai_training_exports(requested_by);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('ai_training_exports');
  await knex.schema.dropTableIfExists('feedback_corrections');
  await knex.schema.dropTableIfExists('ai_feedback');
  await knex.schema.dropTableIfExists('observation_notes');
}
