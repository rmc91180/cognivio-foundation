import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Enable UUID extension
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  // Users table
  await knex.schema.createTable('users', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.string('email', 255).unique().notNullable();
    table.string('password_hash', 255);
    table.string('name', 255).notNullable();
    table.specificType('roles', 'text[]').notNullable().defaultTo('{}');
    table.string('active_role', 50);
    table.uuid('school_id');
    table.string('sso_provider', 50);
    table.string('sso_id', 255);
    table.timestamp('last_login_at');
    table.timestamps(true, true);
  });

  // Schools table
  await knex.schema.createTable('schools', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.string('name', 255).notNullable();
    table.uuid('district_id');
    table.jsonb('settings').defaultTo('{}');
    table.timestamps(true, true);
  });

  // Teachers table
  await knex.schema.createTable('teachers', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('user_id').references('id').inTable('users').onDelete('SET NULL');
    table.string('name', 255).notNullable();
    table.string('email', 255);
    table.uuid('school_id').references('id').inTable('schools').onDelete('CASCADE');
    table.specificType('subjects', 'text[]').defaultTo('{}');
    table.specificType('grades', 'text[]').defaultTo('{}');
    table.string('department', 100);
    table.date('hire_date');
    table.string('status', 20).defaultTo('active');
    table.jsonb('metadata').defaultTo('{}');
    table.timestamps(true, true);
  });

  // Rubric templates table
  await knex.schema.createTable('rubric_templates', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.string('name', 255).notNullable();
    table.string('source', 50).notNullable(); // danielson, marshall, custom
    table.string('version', 50).defaultTo('v1.0');
    table.text('description');
    table.string('aggregation_mode', 20).defaultTo('weighted');
    table.uuid('school_id').references('id').inTable('schools').onDelete('CASCADE');
    table.uuid('created_by').references('id').inTable('users').onDelete('SET NULL');
    table.boolean('is_system_template').defaultTo(false);
    table.boolean('is_active').defaultTo(true);
    table.jsonb('config').defaultTo('{}');
    table.timestamps(true, true);
  });

  // Rubric domains table
  await knex.schema.createTable('rubric_domains', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('template_id').references('id').inTable('rubric_templates').onDelete('CASCADE').notNullable();
    table.string('name', 255).notNullable();
    table.text('description');
    table.integer('sort_order').defaultTo(0);
    table.timestamps(true, true);
  });

  // Rubric elements table
  await knex.schema.createTable('rubric_elements', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('domain_id').references('id').inTable('rubric_domains').onDelete('CASCADE').notNullable();
    table.uuid('template_id').references('id').inTable('rubric_templates').onDelete('CASCADE').notNullable();
    table.string('name', 255).notNullable();
    table.text('description');
    table.specificType('indicators', 'text[]').defaultTo('{}');
    table.decimal('default_weight', 3, 2).defaultTo(1.0);
    table.integer('sort_order').defaultTo(0);
    table.timestamps(true, true);
  });

  // Template columns table (for custom column assignments)
  await knex.schema.createTable('template_columns', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('template_id').references('id').inTable('rubric_templates').onDelete('CASCADE').notNullable();
    table.integer('column_index').notNullable();
    table.string('name', 100).notNullable();
    table.decimal('weight', 3, 2).defaultTo(1.0);
    table.boolean('enabled').defaultTo(true);
    table.timestamps(true, true);
    table.unique(['template_id', 'column_index']);
  });

  // Template column assignments table
  await knex.schema.createTable('template_column_assignments', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('column_id').references('id').inTable('template_columns').onDelete('CASCADE').notNullable();
    table.uuid('element_id').references('id').inTable('rubric_elements').onDelete('CASCADE').notNullable();
    table.integer('sort_order').defaultTo(0);
    table.timestamps(true, true);
    table.unique(['column_id', 'element_id']);
  });

  // Assessments table
  await knex.schema.createTable('assessments', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('teacher_id').references('id').inTable('teachers').onDelete('CASCADE').notNullable();
    table.uuid('template_id').references('id').inTable('rubric_templates').notNullable();
    table.uuid('observer_id').references('id').inTable('users').onDelete('SET NULL');
    table.decimal('overall_score', 5, 2);
    table.string('status', 20).defaultTo('draft');
    table.text('notes');
    table.timestamp('observation_date');
    table.timestamp('completed_at');
    table.timestamps(true, true);
  });

  // Assessment elements table
  await knex.schema.createTable('assessment_elements', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('assessment_id').references('id').inTable('assessments').onDelete('CASCADE').notNullable();
    table.uuid('element_id').references('id').inTable('rubric_elements').notNullable();
    table.decimal('score', 5, 2).notNullable();
    table.text('notes');
    table.specificType('evidence_ids', 'uuid[]').defaultTo('{}');
    table.boolean('is_overridden').defaultTo(false);
    table.text('override_reason');
    table.uuid('overridden_by').references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('overridden_at');
    table.timestamps(true, true);
    table.unique(['assessment_id', 'element_id']);
  });

  // Video evidence table
  await knex.schema.createTable('video_evidence', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('teacher_id').references('id').inTable('teachers').onDelete('CASCADE').notNullable();
    table.string('class_id', 100);
    table.string('original_filename', 255);
    table.string('clip_url', 500);
    table.string('thumbnail_url', 500);
    table.string('storage_path', 500);
    table.timestamp('start_ts');
    table.timestamp('end_ts');
    table.integer('duration_seconds');
    table.bigInteger('file_size_bytes');
    table.string('mime_type', 100);
    table.boolean('anonymized').defaultTo(false);
    table.string('processing_status', 20).defaultTo('pending');
    table.text('processing_error');
    table.uuid('uploaded_by').references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('processed_at');
    table.timestamps(true, true);
  });

  // AI observations table
  await knex.schema.createTable('ai_observations', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('video_id').references('id').inTable('video_evidence').onDelete('CASCADE').notNullable();
    table.uuid('element_id').references('id').inTable('rubric_elements').notNullable();
    table.decimal('confidence', 3, 2).notNullable();
    table.decimal('score_estimate', 5, 2);
    table.timestamp('start_ts');
    table.timestamp('end_ts');
    table.text('summary');
    table.jsonb('key_moments').defaultTo('[]');
    table.string('status', 20).defaultTo('pending');
    table.string('model_version', 50);
    table.jsonb('raw_response');
    table.timestamps(true, true);
  });

  // AI observation reviews table
  await knex.schema.createTable('ai_observation_reviews', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('observation_id').references('id').inTable('ai_observations').onDelete('CASCADE').notNullable().unique();
    table.uuid('reviewer_id').references('id').inTable('users').notNullable();
    table.string('action', 20).notNullable(); // accept, reject, edit
    table.decimal('edited_score', 5, 2);
    table.text('notes');
    table.timestamp('reviewed_at').defaultTo(knex.fn.now());
    table.timestamps(true, true);
  });

  // Gradebook status table
  await knex.schema.createTable('gradebook_status', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('teacher_id').references('id').inTable('teachers').onDelete('CASCADE').notNullable().unique();
    table.boolean('is_healthy').defaultTo(true);
    table.boolean('missing_grades').defaultTo(false);
    table.specificType('classes_missing', 'text[]').defaultTo('{}');
    table.integer('total_students');
    table.integer('graded_students');
    table.timestamp('last_grade_entry');
    table.string('sync_source', 100);
    table.timestamp('last_synced_at');
    table.timestamps(true, true);
  });

  // User preferences table
  await knex.schema.createTable('user_preferences', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('user_id').references('id').inTable('users').onDelete('CASCADE').notNullable().unique();
    table.uuid('default_template_id').references('id').inTable('rubric_templates').onDelete('SET NULL');
    table.specificType('pinned_element_ids', 'uuid[]').defaultTo('{}');
    table.string('dashboard_layout', 20).defaultTo('expanded');
    table.integer('color_threshold_green').defaultTo(80);
    table.integer('color_threshold_yellow').defaultTo(60);
    table.jsonb('notification_settings').defaultTo('{}');
    table.timestamps(true, true);
  });

  // Action plans table
  await knex.schema.createTable('action_plans', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('teacher_id').references('id').inTable('teachers').onDelete('CASCADE').notNullable();
    table.uuid('created_by').references('id').inTable('users').notNullable();
    table.string('status', 50).defaultTo('active');
    table.text('notes');
    table.timestamps(true, true);
  });

  // Action plan goals table
  await knex.schema.createTable('action_plan_goals', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('plan_id').references('id').inTable('action_plans').onDelete('CASCADE').notNullable();
    table.uuid('element_id').references('id').inTable('rubric_elements').onDelete('SET NULL');
    table.text('description').notNullable();
    table.decimal('target_score', 5, 2);
    table.date('target_date');
    table.string('status', 50).defaultTo('pending');
    table.timestamp('completed_at');
    table.timestamps(true, true);
  });

  // Audit log table
  await knex.schema.createTable('audit_log', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('user_id').references('id').inTable('users').onDelete('SET NULL');
    table.string('user_name', 255);
    table.string('action', 100).notNullable();
    table.string('target_type', 50).notNullable();
    table.uuid('target_id');
    table.jsonb('details').defaultTo('{}');
    table.specificType('ip_address', 'inet');
    table.text('user_agent');
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Create indexes
  await knex.raw('CREATE INDEX idx_teachers_school ON teachers(school_id)');
  await knex.raw('CREATE INDEX idx_teachers_status ON teachers(status)');
  await knex.raw('CREATE INDEX idx_assessments_teacher ON assessments(teacher_id)');
  await knex.raw('CREATE INDEX idx_assessments_date ON assessments(observation_date)');
  await knex.raw('CREATE INDEX idx_video_evidence_teacher ON video_evidence(teacher_id)');
  await knex.raw('CREATE INDEX idx_ai_observations_video ON ai_observations(video_id)');
  await knex.raw('CREATE INDEX idx_audit_log_user ON audit_log(user_id)');
  await knex.raw('CREATE INDEX idx_audit_log_action ON audit_log(action)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('audit_log');
  await knex.schema.dropTableIfExists('action_plan_goals');
  await knex.schema.dropTableIfExists('action_plans');
  await knex.schema.dropTableIfExists('user_preferences');
  await knex.schema.dropTableIfExists('gradebook_status');
  await knex.schema.dropTableIfExists('ai_observation_reviews');
  await knex.schema.dropTableIfExists('ai_observations');
  await knex.schema.dropTableIfExists('video_evidence');
  await knex.schema.dropTableIfExists('assessment_elements');
  await knex.schema.dropTableIfExists('assessments');
  await knex.schema.dropTableIfExists('template_column_assignments');
  await knex.schema.dropTableIfExists('template_columns');
  await knex.schema.dropTableIfExists('rubric_elements');
  await knex.schema.dropTableIfExists('rubric_domains');
  await knex.schema.dropTableIfExists('rubric_templates');
  await knex.schema.dropTableIfExists('teachers');
  await knex.schema.dropTableIfExists('schools');
  await knex.schema.dropTableIfExists('users');
}
