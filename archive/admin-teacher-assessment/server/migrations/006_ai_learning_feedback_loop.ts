import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ===========================================
  // 1. AI Model Versions Table (MUST ADD)
  // Tracks model lifecycle and enables versioning
  // ===========================================
  await knex.schema.createTable('ai_model_versions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('model_version', 50).notNullable().unique();
    table.string('model_type', 50).notNullable().comment('gpt-4o, gpt-4-turbo, custom, etc.');
    table.string('model_name', 200).comment('Human readable name');
    table.text('description').comment('What changed in this version');
    table.timestamp('training_data_start').comment('Start of training data window');
    table.timestamp('training_data_end').comment('End of training data window');
    table.integer('training_samples').comment('Number of corrections used for training');
    table.jsonb('config').defaultTo('{}').comment('Model configuration parameters');
    table.jsonb('performance_metrics').defaultTo('{}').comment('Accuracy, F1, etc.');
    table.timestamp('deployment_date');
    table.boolean('is_active').defaultTo(false);
    table.boolean('is_deprecated').defaultTo(false);
    table.uuid('created_by').references('id').inTable('users').onDelete('SET NULL');
    table.timestamps(true, true);
  });

  // ===========================================
  // 2. AI Learning History Table
  // Tracks every correction made to AI predictions
  // ===========================================
  await knex.schema.createTable('ai_learning_history', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    // Links
    table.uuid('teacher_id').notNullable()
      .references('id').inTable('teachers').onDelete('CASCADE');
    table.uuid('element_id').notNullable()
      .references('id').inTable('rubric_elements').onDelete('CASCADE');
    table.uuid('observation_id')
      .references('id').inTable('ai_observations').onDelete('SET NULL');
    table.uuid('correction_id')
      .references('id').inTable('feedback_corrections').onDelete('SET NULL');

    // Correction data
    table.integer('original_ai_score').notNullable().comment('Original AI 1-4 score');
    table.integer('corrected_score').notNullable().comment('Human-corrected 1-4 score');
    table.integer('score_delta').notNullable().comment('corrected - original');
    table.decimal('ai_confidence', 5, 4).comment('AI confidence at time of scoring (0-1)');

    // Pattern context
    table.string('correction_type', 50).comment('score_too_high, score_too_low, wrong_evidence, missed_evidence, misinterpreted');
    table.string('framework_type', 50).comment('danielson or marshall');
    table.string('domain_name', 200).comment('Which domain for pattern analysis');
    table.specificType('subjects', 'text[]').defaultTo('{}').comment('Teacher subjects');
    table.specificType('grades', 'text[]').defaultTo('{}').comment('Teacher grades');

    // Reviewer info
    table.uuid('reviewer_id').references('id').inTable('users').onDelete('SET NULL');
    table.string('reviewer_role', 50).comment('admin, principal, observer, department_head');
    table.decimal('reviewer_expertise_weight', 3, 2).defaultTo(1.0);

    // Trend tracking
    table.integer('cumulative_corrections').defaultTo(1).comment('Total corrections for this element');
    table.decimal('average_delta', 5, 2).comment('Running average of correction deltas');

    // Model versioning (MUST ADD)
    table.string('model_version', 50).comment('Which AI model version produced the original score');

    // Training flags
    table.boolean('applied_to_model').defaultTo(false);
    table.timestamp('applied_at');

    // Timestamps
    table.timestamps(true, true);
  });

  // ===========================================
  // 3. AI Suggestions Table
  // AI-generated actionable recommendations
  // ===========================================
  await knex.schema.createTable('ai_suggestions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    // Target
    table.uuid('teacher_id').notNullable()
      .references('id').inTable('teachers').onDelete('CASCADE');
    table.uuid('element_id')
      .references('id').inTable('rubric_elements').onDelete('SET NULL');
    table.uuid('generated_for_user')
      .references('id').inTable('users').onDelete('SET NULL')
      .comment('Principal who sees this suggestion');

    // Suggestion content
    table.string('suggestion_type', 50).notNullable()
      .comment('observation, coaching, resource, intervention, recognition');
    table.string('priority', 20).defaultTo('medium')
      .comment('high, medium, low');
    table.string('title', 300).notNullable();
    table.text('description').notNullable();
    table.text('rationale').comment('Why AI generated this suggestion');
    table.specificType('action_items', 'text[]').defaultTo('{}');
    table.specificType('related_elements', 'uuid[]').defaultTo('{}');

    // Evidence basis
    table.jsonb('evidence_basis').defaultTo('{}')
      .comment('Data points that led to this suggestion');
    table.decimal('confidence_score', 3, 2).comment('0-1 AI confidence');
    table.string('pattern_detected', 100)
      .comment('declining_trend, consistent_low, improvement_stall, high_performer, etc.');

    // Model versioning (MUST ADD)
    table.string('model_version', 50).comment('Which AI model version generated this suggestion');

    // Status
    table.string('status', 30).defaultTo('pending')
      .comment('pending, accepted, rejected, completed, expired');
    table.timestamp('accepted_at');
    table.uuid('accepted_by').references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('rejected_at');
    table.uuid('rejected_by').references('id').inTable('users').onDelete('SET NULL');
    table.text('rejection_reason');
    table.timestamp('completed_at');
    table.text('completion_notes');
    table.timestamp('expires_at').comment('Suggestion validity period');

    // Feedback for learning
    table.integer('helpfulness_rating').comment('1-5 rating after completion');
    table.text('feedback_notes');

    // Timestamps
    table.timestamps(true, true);
  });

  // ===========================================
  // 4. Teacher Feedback Messages Table
  // Threaded feedback between principal and teacher
  // ===========================================
  await knex.schema.createTable('teacher_feedback_messages', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    // Participants
    table.uuid('teacher_id').notNullable()
      .references('id').inTable('teachers').onDelete('CASCADE');
    table.uuid('sender_id').notNullable()
      .references('id').inTable('users').onDelete('CASCADE');

    // Related entities
    table.uuid('observation_id')
      .references('id').inTable('ai_observations').onDelete('SET NULL');
    table.uuid('element_id')
      .references('id').inTable('rubric_elements').onDelete('SET NULL');
    table.uuid('suggestion_id')
      .references('id').inTable('ai_suggestions').onDelete('SET NULL');
    table.uuid('video_id')
      .references('id').inTable('video_evidence').onDelete('SET NULL');

    // Message content
    table.string('feedback_type', 50).notNullable()
      .comment('praise, coaching, action_required, follow_up, general');
    table.string('subject', 300).notNullable();
    table.text('message').notNullable();
    table.jsonb('attachments').defaultTo('[]')
      .comment('Array of {type, url, name}');

    // Priority & visibility
    table.string('priority', 20).defaultTo('normal')
      .comment('urgent, high, normal, low');
    table.boolean('requires_acknowledgment').defaultTo(false);
    table.timestamp('acknowledged_at');

    // Read status
    table.timestamp('read_at');
    table.boolean('is_archived').defaultTo(false);

    // Thread support
    table.uuid('parent_message_id')
      .references('id').inTable('teacher_feedback_messages').onDelete('SET NULL');
    table.integer('thread_depth').defaultTo(0);

    // Timestamps
    table.timestamps(true, true);
  });

  // ===========================================
  // 5. Teacher Performance Trends Table
  // Aggregated trend data per period
  // ===========================================
  await knex.schema.createTable('teacher_performance_trends', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    // Identity
    table.uuid('teacher_id').notNullable()
      .references('id').inTable('teachers').onDelete('CASCADE');
    table.uuid('element_id')
      .references('id').inTable('rubric_elements').onDelete('CASCADE');
    table.uuid('template_id')
      .references('id').inTable('rubric_templates').onDelete('CASCADE');

    // Period
    table.date('period_start').notNullable();
    table.date('period_end').notNullable();
    table.string('period_type', 20).defaultTo('month')
      .comment('week, month, quarter, year');

    // Scores
    table.decimal('average_score', 5, 2).comment('Average normalized score (25-100)');
    table.decimal('score_change', 5, 2).comment('Change from previous period');
    table.string('trend_direction', 20).comment('up, down, stable');
    table.integer('observation_count').defaultTo(0);

    // Statistics
    table.decimal('min_score', 5, 2);
    table.decimal('max_score', 5, 2);
    table.decimal('std_deviation', 5, 2);
    table.decimal('confidence_average', 3, 2);

    // Comparison
    table.decimal('school_average', 5, 2);
    table.decimal('percentile_rank', 5, 2).comment('0-100 percentile among peers');

    // Risk assessment (MUST ADD)
    table.string('risk_level', 20).comment('low, medium, high, critical');
    table.decimal('predicted_future_risk', 3, 2).comment('0-1 probability of decline');
    table.jsonb('risk_factors').defaultTo('[]').comment('Array of contributing factors');

    // Timestamps
    table.timestamps(true, true);

    // Unique constraint for one entry per period per element
    table.unique(['teacher_id', 'element_id', 'period_start', 'period_end']);
  });

  // ===========================================
  // 6. AI Training Queue Table (MUST ADD)
  // Queue of corrections for future model training
  // ===========================================
  await knex.schema.createTable('ai_training_queue', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    table.uuid('learning_history_id').notNullable()
      .references('id').inTable('ai_learning_history').onDelete('CASCADE');

    table.string('status', 30).defaultTo('pending')
      .comment('pending, processing, processed, failed, skipped');
    table.integer('priority').defaultTo(0).comment('Higher = process first');
    table.decimal('quality_score', 3, 2).comment('0-1 quality assessment of this training sample');

    table.timestamp('queued_at').defaultTo(knex.fn.now());
    table.timestamp('processing_started_at');
    table.timestamp('processed_at');
    table.text('processing_notes');
    table.text('error_message');

    table.string('target_model_version', 50).comment('Which model version to train');
    table.string('batch_id', 100).comment('Group ID for batch processing');

    table.timestamps(true, true);
  });

  // ===========================================
  // 7. Teacher Acknowledgment Logs Table (MUST ADD)
  // Tracks teacher interactions with AI insights
  // ===========================================
  await knex.schema.createTable('teacher_acknowledgment_logs', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    table.uuid('teacher_id').notNullable()
      .references('id').inTable('teachers').onDelete('CASCADE');

    // What was acknowledged
    table.string('insight_type', 50).notNullable()
      .comment('suggestion, feedback, observation, trend_alert');
    table.uuid('insight_id').notNullable().comment('ID of the suggestion/feedback/observation');

    // Action taken
    table.string('action_type', 50).notNullable()
      .comment('viewed, dismissed, acted_on, saved_for_later, shared');
    table.text('action_notes').comment('Teacher notes about their action');

    // Context
    table.string('source', 50).comment('dashboard, email, notification, mobile');
    table.integer('time_to_action_seconds').comment('Seconds from notification to action');

    table.timestamps(true, true);
  });

  // ===========================================
  // Indexes for Performance
  // ===========================================

  // AI Model Versions indexes
  await knex.schema.raw(`
    CREATE INDEX idx_ai_model_versions_active ON ai_model_versions(is_active) WHERE is_active = true;
    CREATE INDEX idx_ai_model_versions_version ON ai_model_versions(model_version);
  `);

  // AI Learning History indexes
  await knex.schema.raw(`
    CREATE INDEX idx_ai_learning_teacher ON ai_learning_history(teacher_id);
    CREATE INDEX idx_ai_learning_element ON ai_learning_history(element_id);
    CREATE INDEX idx_ai_learning_correction_type ON ai_learning_history(correction_type);
    CREATE INDEX idx_ai_learning_framework ON ai_learning_history(framework_type);
    CREATE INDEX idx_ai_learning_domain ON ai_learning_history(domain_name);
    CREATE INDEX idx_ai_learning_model_version ON ai_learning_history(model_version);
    CREATE INDEX idx_ai_learning_created ON ai_learning_history(created_at DESC);
    CREATE INDEX idx_ai_learning_not_applied ON ai_learning_history(applied_to_model) WHERE applied_to_model = false;
  `);

  // AI Suggestions indexes
  await knex.schema.raw(`
    CREATE INDEX idx_ai_suggestions_teacher ON ai_suggestions(teacher_id);
    CREATE INDEX idx_ai_suggestions_user ON ai_suggestions(generated_for_user);
    CREATE INDEX idx_ai_suggestions_status ON ai_suggestions(status);
    CREATE INDEX idx_ai_suggestions_priority ON ai_suggestions(priority);
    CREATE INDEX idx_ai_suggestions_type ON ai_suggestions(suggestion_type);
    CREATE INDEX idx_ai_suggestions_expires ON ai_suggestions(expires_at);
    CREATE INDEX idx_ai_suggestions_pending ON ai_suggestions(status, priority) WHERE status = 'pending';
  `);

  // Teacher Feedback Messages indexes
  await knex.schema.raw(`
    CREATE INDEX idx_teacher_feedback_teacher ON teacher_feedback_messages(teacher_id);
    CREATE INDEX idx_teacher_feedback_sender ON teacher_feedback_messages(sender_id);
    CREATE INDEX idx_teacher_feedback_unread ON teacher_feedback_messages(teacher_id, read_at) WHERE read_at IS NULL;
    CREATE INDEX idx_teacher_feedback_thread ON teacher_feedback_messages(parent_message_id);
    CREATE INDEX idx_teacher_feedback_created ON teacher_feedback_messages(created_at DESC);
  `);

  // Performance Trends indexes
  await knex.schema.raw(`
    CREATE INDEX idx_perf_trends_teacher ON teacher_performance_trends(teacher_id);
    CREATE INDEX idx_perf_trends_element ON teacher_performance_trends(element_id);
    CREATE INDEX idx_perf_trends_period ON teacher_performance_trends(period_start, period_end);
    CREATE INDEX idx_perf_trends_direction ON teacher_performance_trends(trend_direction);
    CREATE INDEX idx_perf_trends_risk ON teacher_performance_trends(risk_level);
  `);

  // AI Training Queue indexes
  await knex.schema.raw(`
    CREATE INDEX idx_training_queue_status ON ai_training_queue(status);
    CREATE INDEX idx_training_queue_pending ON ai_training_queue(status, priority DESC) WHERE status = 'pending';
    CREATE INDEX idx_training_queue_batch ON ai_training_queue(batch_id);
  `);

  // Teacher Acknowledgment Logs indexes
  await knex.schema.raw(`
    CREATE INDEX idx_ack_logs_teacher ON teacher_acknowledgment_logs(teacher_id);
    CREATE INDEX idx_ack_logs_insight ON teacher_acknowledgment_logs(insight_type, insight_id);
    CREATE INDEX idx_ack_logs_action ON teacher_acknowledgment_logs(action_type);
    CREATE INDEX idx_ack_logs_created ON teacher_acknowledgment_logs(created_at DESC);
  `);

  // ===========================================
  // Insert initial AI model version
  // ===========================================
  await knex('ai_model_versions').insert({
    model_version: 'v1.0.0',
    model_type: 'gpt-4o',
    model_name: 'GPT-4o Initial Release',
    description: 'Initial AI model version for classroom video analysis',
    is_active: true,
    deployment_date: new Date(),
    config: JSON.stringify({
      temperature: 0.3,
      maxTokens: 2000,
      frameCount: 15,
      batchSize: 10,
    }),
  });
}

export async function down(knex: Knex): Promise<void> {
  // Drop indexes first (they'll be dropped with tables anyway, but explicit is better)

  // Drop tables in reverse order of creation (respecting foreign key constraints)
  await knex.schema.dropTableIfExists('teacher_acknowledgment_logs');
  await knex.schema.dropTableIfExists('ai_training_queue');
  await knex.schema.dropTableIfExists('teacher_performance_trends');
  await knex.schema.dropTableIfExists('teacher_feedback_messages');
  await knex.schema.dropTableIfExists('ai_suggestions');
  await knex.schema.dropTableIfExists('ai_learning_history');
  await knex.schema.dropTableIfExists('ai_model_versions');
}
