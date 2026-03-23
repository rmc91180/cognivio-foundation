import type { Knex } from 'knex';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { MARSHALL_RUBRIC, DANIELSON_RUBRIC } from './002_rubric_seeds';

// Fixed UUIDs for consistent seeding
const SCHOOL_ID = '11111111-1111-1111-1111-111111111111';
const PRINCIPAL_ID = '22222222-2222-2222-2222-222222222222';
const DANIELSON_TEMPLATE_ID = '33333333-3333-3333-3333-333333333333';
const MARSHALL_TEMPLATE_ID = '44444444-4444-4444-4444-444444444444';
const CUSTOM_TEMPLATE_ID = '55555555-5555-5555-5555-555555555555';

// Teacher IDs as proper UUIDs
const TEACHER_IDS: string[] = [
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa001', // Sarah Johnson - GREEN
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa002', // James Williams - GREEN
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa003', // Michael Chen - YELLOW
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa004', // Emily Davis - YELLOW
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa005', // Robert Martinez - YELLOW
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa006', // Jennifer Thompson - RED
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa007', // David Kim - RED
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa008', // Amanda Wilson - GREEN
];

export async function seed(knex: Knex): Promise<void> {
  // Clear existing data
  await knex('audit_log').del();
  await knex('action_plan_goals').del();
  await knex('action_plans').del();
  await knex('user_preferences').del();
  await knex('gradebook_status').del();
  await knex('ai_observation_reviews').del();
  await knex('ai_observations').del();
  await knex('video_evidence').del();
  await knex('assessment_elements').del();
  await knex('assessments').del();
  await knex('template_column_assignments').del();
  await knex('template_columns').del();
  await knex('rubric_elements').del();
  await knex('rubric_domains').del();
  await knex('rubric_templates').del();
  await knex('teachers').del();
  await knex('schools').del();
  await knex('users').del();

  // Create school
  await knex('schools').insert({
    id: SCHOOL_ID,
    name: 'Lincoln High School',
    settings: JSON.stringify({ district: 'Metro District' }),
  });

  // Create principal user
  const passwordHash = await bcrypt.hash('password123', 10);
  await knex('users').insert({
    id: PRINCIPAL_ID,
    email: 'principal@lincoln.edu',
    password_hash: passwordHash,
    name: 'Dr. Sarah Anderson',
    roles: ['principal', 'observer'],
    active_role: 'principal',
    school_id: SCHOOL_ID,
  });

  // ========================================
  // DANIELSON FRAMEWORK
  // ========================================
  await knex('rubric_templates').insert({
    id: DANIELSON_TEMPLATE_ID,
    name: 'Danielson Framework for Teaching',
    source: 'danielson',
    version: 'v2.1',
    description: 'The Danielson Framework identifies aspects of a teacher\'s responsibilities that have been documented through research as promoting improved student learning.',
    aggregation_mode: 'weighted',
    is_system_template: true,
    is_active: true,
  });

  // Danielson Domains
  const danielsonDomains = [
    { id: uuidv4(), name: 'Domain 1: Planning and Preparation', description: 'Demonstrating knowledge of content and pedagogy', sort_order: 1 },
    { id: uuidv4(), name: 'Domain 2: The Classroom Environment', description: 'Creating an environment of respect and rapport', sort_order: 2 },
    { id: uuidv4(), name: 'Domain 3: Instruction', description: 'Communicating with students', sort_order: 3 },
    { id: uuidv4(), name: 'Domain 4: Professional Responsibilities', description: 'Reflecting on teaching', sort_order: 4 },
  ];

  for (const domain of danielsonDomains) {
    await knex('rubric_domains').insert({
      ...domain,
      template_id: DANIELSON_TEMPLATE_ID,
    });
  }

  // Danielson Elements
  const danielsonElements = [
    // Domain 1
    { domain_idx: 0, name: '1a: Demonstrating Knowledge of Content and Pedagogy', description: 'Teacher displays solid knowledge of the important concepts in the discipline and how these relate to one another.', indicators: ['Knowledge of content', 'Knowledge of prerequisite relationships', 'Knowledge of content-related pedagogy'] },
    { domain_idx: 0, name: '1b: Demonstrating Knowledge of Students', description: 'Teacher understands the active nature of student learning and attains information about levels of development of individual students.', indicators: ['Knowledge of child development', 'Knowledge of learning process', 'Knowledge of student interests'] },
    { domain_idx: 0, name: '1c: Setting Instructional Outcomes', description: 'Teacher sets outcomes that represent rigorous and important learning in the discipline.', indicators: ['Value, sequence, and alignment', 'Clarity', 'Balance', 'Suitability for diverse learners'] },
    { domain_idx: 0, name: '1d: Demonstrating Knowledge of Resources', description: 'Teacher displays awareness of resources available through the school or district.', indicators: ['Resources for classroom use', 'Resources for students', 'Resources for extending knowledge'] },
    { domain_idx: 0, name: '1e: Designing Coherent Instruction', description: 'Teacher designs instruction that reflects understanding of students, content, and outcomes.', indicators: ['Learning activities', 'Instructional materials', 'Instructional groups', 'Lesson structure'] },
    { domain_idx: 0, name: '1f: Designing Student Assessments', description: 'Teacher plans for assessment that is used for planning and monitors student progress.', indicators: ['Congruence with outcomes', 'Criteria and standards', 'Design of formative assessments', 'Use for planning'] },
    // Domain 2
    { domain_idx: 1, name: '2a: Creating an Environment of Respect and Rapport', description: 'Classroom interactions reflect genuine respect and caring for individuals as well as groups of students.', indicators: ['Teacher interaction with students', 'Student interactions with other students'] },
    { domain_idx: 1, name: '2b: Establishing a Culture for Learning', description: 'The classroom environment conveys high expectations for learning for all students.', indicators: ['Importance of content', 'Expectations for learning and achievement', 'Student pride in work'] },
    { domain_idx: 1, name: '2c: Managing Classroom Procedures', description: 'Instructional time is maximized due to efficient classroom routines and procedures.', indicators: ['Management of instructional groups', 'Management of transitions', 'Management of materials', 'Performance of non-instructional duties'] },
    { domain_idx: 1, name: '2d: Managing Student Behavior', description: 'Standards of conduct are clear to all students with evidence of student participation.', indicators: ['Expectations', 'Monitoring of student behavior', 'Response to student misbehavior'] },
    { domain_idx: 1, name: '2e: Organizing Physical Space', description: 'The classroom is safe, and the physical environment supports learning.', indicators: ['Safety and accessibility', 'Arrangement of furniture', 'Use of physical resources'] },
    // Domain 3
    { domain_idx: 2, name: '3a: Communicating with Students', description: 'Teacher communication with students is clear and accurate.', indicators: ['Expectations for learning', 'Directions and procedures', 'Explanations of content', 'Use of oral and written language'] },
    { domain_idx: 2, name: '3b: Using Questioning and Discussion Techniques', description: 'Teacher uses questioning and discussion to promote student learning.', indicators: ['Quality of questions', 'Discussion techniques', 'Student participation'] },
    { domain_idx: 2, name: '3c: Engaging Students in Learning', description: 'Students are engaged in learning and take intellectual risks.', indicators: ['Activities and assignments', 'Grouping of students', 'Instructional materials', 'Structure and pacing'] },
    { domain_idx: 2, name: '3d: Using Assessment in Instruction', description: 'Assessment is used in instruction to promote student learning.', indicators: ['Assessment criteria', 'Monitoring of student learning', 'Feedback to students', 'Student self-assessment'] },
    { domain_idx: 2, name: '3e: Demonstrating Flexibility and Responsiveness', description: 'Teacher makes adjustments to the lesson when needed.', indicators: ['Lesson adjustment', 'Response to students', 'Persistence'] },
    // Domain 4
    { domain_idx: 3, name: '4a: Reflecting on Teaching', description: 'Teacher makes an accurate assessment of a lesson\'s effectiveness and extent to which outcomes were achieved.', indicators: ['Accuracy', 'Use in future teaching'] },
    { domain_idx: 3, name: '4b: Maintaining Accurate Records', description: 'Teacher\'s system for maintaining records of student completion of assignments and progress is fully effective.', indicators: ['Student completion of assignments', 'Student progress in learning', 'Non-instructional records'] },
    { domain_idx: 3, name: '4c: Communicating with Families', description: 'Teacher communication with families about the instructional program and individual students is frequent and culturally appropriate.', indicators: ['Information about the program', 'Information about individual students', 'Engagement of families'] },
    { domain_idx: 3, name: '4d: Participating in a Professional Community', description: 'Teacher participates actively in a professional community.', indicators: ['Relationships with colleagues', 'Involvement in school projects', 'Involvement in culture of inquiry'] },
    { domain_idx: 3, name: '4e: Growing and Developing Professionally', description: 'Teacher seeks out opportunities for professional development.', indicators: ['Enhancement of content knowledge', 'Receptivity to feedback', 'Service to the profession'] },
    { domain_idx: 3, name: '4f: Showing Professionalism', description: 'Teacher displays high standards of honesty, integrity, and confidentiality.', indicators: ['Integrity and ethical conduct', 'Service to students', 'Advocacy', 'Decision-making', 'Compliance with regulations'] },
  ];

  const danielsonElementIds: string[] = [];
  for (const elem of danielsonElements) {
    const elemId = uuidv4();
    danielsonElementIds.push(elemId);
    await knex('rubric_elements').insert({
      id: elemId,
      domain_id: danielsonDomains[elem.domain_idx].id,
      template_id: DANIELSON_TEMPLATE_ID,
      name: elem.name,
      description: elem.description,
      indicators: elem.indicators,
      default_weight: 1.0,
      sort_order: danielsonElementIds.length,
    });
  }

  // Create default columns for Danielson
  const danielsonColumns = [
    { name: 'Planning', column_index: 0 },
    { name: 'Environment', column_index: 1 },
    { name: 'Instruction', column_index: 2 },
    { name: 'Professional', column_index: 3 },
  ];

  for (const col of danielsonColumns) {
    const colId = uuidv4();
    await knex('template_columns').insert({
      id: colId,
      template_id: DANIELSON_TEMPLATE_ID,
      column_index: col.column_index,
      name: col.name,
      weight: 1.0,
      enabled: true,
    });

    // Assign elements to columns (6 elements per domain, 4 domains)
    const startIdx = col.column_index * 6;
    const endIdx = col.column_index === 3 ? danielsonElementIds.length : startIdx + 6;
    for (let i = startIdx; i < endIdx && i < danielsonElementIds.length; i++) {
      await knex('template_column_assignments').insert({
        column_id: colId,
        element_id: danielsonElementIds[i],
        sort_order: i - startIdx,
      });
    }
  }

  // Create user preferences (after templates exist)
  await knex('user_preferences').insert({
    user_id: PRINCIPAL_ID,
    default_template_id: DANIELSON_TEMPLATE_ID,
    color_threshold_green: 80,
    color_threshold_yellow: 60,
  });

  // ========================================
  // MARSHALL FRAMEWORK (Full Kim Marshall Rubric - 59 elements)
  // ========================================
  await knex('rubric_templates').insert({
    id: MARSHALL_TEMPLATE_ID,
    name: MARSHALL_RUBRIC.name,
    source: MARSHALL_RUBRIC.source,
    version: MARSHALL_RUBRIC.version,
    description: 'The Marshall rubrics focus on mini-observations and coaching conversations to improve teaching.',
    aggregation_mode: MARSHALL_RUBRIC.aggregation_mode,
    is_system_template: true,
    is_active: true,
  });

  // Insert Marshall domains
  const marshallDomains = [];
  for (let i = 0; i < MARSHALL_RUBRIC.domains.length; i++) {
    const domain = MARSHALL_RUBRIC.domains[i];
    const domainRecord = {
      id: uuidv4(),
      name: domain.name,
      description: domain.name,
      sort_order: i + 1,
    };
    marshallDomains.push(domainRecord);
    await knex('rubric_domains').insert({
      ...domainRecord,
      template_id: MARSHALL_TEMPLATE_ID,
    });
  }

  // Insert Marshall elements (59 total across 6 domains)
  const marshallElementIds: string[] = [];
  for (let domainIdx = 0; domainIdx < MARSHALL_RUBRIC.domains.length; domainIdx++) {
    const domain = MARSHALL_RUBRIC.domains[domainIdx];
    for (let elemIdx = 0; elemIdx < domain.elements.length; elemIdx++) {
      const element = domain.elements[elemIdx];
      const elemId = uuidv4();
      marshallElementIds.push(elemId);
      await knex('rubric_elements').insert({
        id: elemId,
        domain_id: marshallDomains[domainIdx].id,
        template_id: MARSHALL_TEMPLATE_ID,
        name: element.name,
        description: element.desc,
        indicators: [],
        default_weight: element.weight,
        sort_order: marshallElementIds.length,
      });
    }
  }

  // Create default columns for Marshall
  const marshallColumns = [
    { name: 'Planning', column_index: 0 },
    { name: 'Management', column_index: 1 },
    { name: 'Instruction', column_index: 2 },
    { name: 'Assessment', column_index: 3 },
  ];

  for (const col of marshallColumns) {
    const colId = uuidv4();
    await knex('template_columns').insert({
      id: colId,
      template_id: MARSHALL_TEMPLATE_ID,
      column_index: col.column_index,
      name: col.name,
      weight: 1.0,
      enabled: true,
    });

    // Assign elements to columns based on domain groupings
    // Domain 0 (Planning - 10 elements) -> Column 0
    // Domain 1 (Management - 10 elements) -> Column 1
    // Domain 2 (Instruction - 10 elements) -> Column 2
    // Domains 3,4,5 (Assessment, Family, Professional - 29 elements) -> Column 3
    let elementOffset = 0;
    if (col.column_index === 0) {
      // Planning domain (first 10 elements)
      for (let i = 0; i < 10 && i < marshallElementIds.length; i++) {
        await knex('template_column_assignments').insert({
          column_id: colId,
          element_id: marshallElementIds[i],
          sort_order: i,
        });
      }
    } else if (col.column_index === 1) {
      // Management domain (elements 10-19)
      elementOffset = 10;
      for (let i = 0; i < 10 && (elementOffset + i) < marshallElementIds.length; i++) {
        await knex('template_column_assignments').insert({
          column_id: colId,
          element_id: marshallElementIds[elementOffset + i],
          sort_order: i,
        });
      }
    } else if (col.column_index === 2) {
      // Instruction domain (elements 20-29)
      elementOffset = 20;
      for (let i = 0; i < 10 && (elementOffset + i) < marshallElementIds.length; i++) {
        await knex('template_column_assignments').insert({
          column_id: colId,
          element_id: marshallElementIds[elementOffset + i],
          sort_order: i,
        });
      }
    } else if (col.column_index === 3) {
      // Assessment, Family, Professional domains (elements 30-58)
      elementOffset = 30;
      for (let i = 0; (elementOffset + i) < marshallElementIds.length; i++) {
        await knex('template_column_assignments').insert({
          column_id: colId,
          element_id: marshallElementIds[elementOffset + i],
          sort_order: i,
        });
      }
    }
  }

  // ========================================
  // CUSTOM TEMPLATE (Combined)
  // ========================================
  await knex('rubric_templates').insert({
    id: CUSTOM_TEMPLATE_ID,
    name: 'Custom Combined Framework',
    source: 'custom',
    version: 'v1.0',
    description: 'A custom framework combining elements from both Danielson and Marshall rubrics.',
    aggregation_mode: 'weighted',
    school_id: SCHOOL_ID,
    created_by: PRINCIPAL_ID,
    is_system_template: false,
    is_active: true,
  });

  // ========================================
  // TEACHERS
  // ========================================
  const teachers = [
    { id: TEACHER_IDS[0], name: 'John Smith', email: 'john.smith@lincoln.edu', subjects: ['Math', 'Algebra'], grades: ['9', '10'], department: 'Mathematics' },
    { id: TEACHER_IDS[1], name: 'Emily Johnson', email: 'emily.johnson@lincoln.edu', subjects: ['English', 'Literature'], grades: ['10', '11'], department: 'English' },
    { id: TEACHER_IDS[2], name: 'Michael Brown', email: 'michael.brown@lincoln.edu', subjects: ['Biology', 'Chemistry'], grades: ['11', '12'], department: 'Science' },
    { id: TEACHER_IDS[3], name: 'Sarah Davis', email: 'sarah.davis@lincoln.edu', subjects: ['History', 'Government'], grades: ['9', '10'], department: 'Social Studies' },
    { id: TEACHER_IDS[4], name: 'David Wilson', email: 'david.wilson@lincoln.edu', subjects: ['Physics', 'Math'], grades: ['11', '12'], department: 'Science' },
    { id: TEACHER_IDS[5], name: 'Jennifer Martinez', email: 'jennifer.martinez@lincoln.edu', subjects: ['Spanish', 'French'], grades: ['9', '10', '11'], department: 'World Languages' },
    { id: TEACHER_IDS[6], name: 'Robert Taylor', email: 'robert.taylor@lincoln.edu', subjects: ['Art', 'Design'], grades: ['9', '10', '11', '12'], department: 'Arts' },
    { id: TEACHER_IDS[7], name: 'Lisa Anderson', email: 'lisa.anderson@lincoln.edu', subjects: ['PE', 'Health'], grades: ['9', '10'], department: 'Physical Education' },
  ];

  for (const teacher of teachers) {
    await knex('teachers').insert({
      ...teacher,
      school_id: SCHOOL_ID,
      hire_date: '2020-08-15',
      status: 'active',
    });
  }

  // ========================================
  // ASSESSMENTS
  // ========================================
  // Create varied assessment scores for each teacher
  const scoreProfiles = [
    { teacherIdx: 0, scores: [85, 88, 82, 90, 78, 84] }, // High performer (green)
    { teacherIdx: 1, scores: [92, 88, 95, 90, 85, 91] }, // High performer (green)
    { teacherIdx: 2, scores: [72, 68, 75, 70, 65, 71] }, // Medium performer (yellow)
    { teacherIdx: 3, scores: [78, 82, 75, 80, 72, 79] }, // Medium performer (yellow)
    { teacherIdx: 4, scores: [55, 58, 52, 60, 48, 54] }, // Low performer (red)
    { teacherIdx: 5, scores: [82, 85, 80, 88, 78, 83] }, // High performer (green)
    { teacherIdx: 6, scores: [65, 68, 62, 70, 58, 64] }, // Medium-low performer (yellow/red)
    { teacherIdx: 7, scores: [88, 90, 85, 92, 82, 87] }, // High performer (green)
  ];

  for (const profile of scoreProfiles) {
    const assessmentId = uuidv4();
    const avgScore = profile.scores.reduce((a, b) => a + b, 0) / profile.scores.length;

    await knex('assessments').insert({
      id: assessmentId,
      teacher_id: TEACHER_IDS[profile.teacherIdx],
      template_id: DANIELSON_TEMPLATE_ID,
      observer_id: PRINCIPAL_ID,
      overall_score: avgScore,
      status: 'completed',
      observation_date: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000),
      completed_at: new Date(),
    });

    // Create assessment elements
    for (let i = 0; i < Math.min(profile.scores.length, danielsonElementIds.length); i++) {
      await knex('assessment_elements').insert({
        assessment_id: assessmentId,
        element_id: danielsonElementIds[i],
        score: profile.scores[i] + Math.floor(Math.random() * 10) - 5, // Add some variance
        notes: 'Assessment observation notes.',
      });
    }
  }

  // ========================================
  // GRADEBOOK STATUS
  // ========================================
  for (let i = 0; i < TEACHER_IDS.length; i++) {
    const hasMissingGrades = i === 4 || i === 6; // Teachers 5 and 7 have missing grades
    await knex('gradebook_status').insert({
      teacher_id: TEACHER_IDS[i],
      is_healthy: !hasMissingGrades,
      missing_grades: hasMissingGrades,
      classes_missing: hasMissingGrades ? ['Period 2 - Algebra', 'Period 4 - Geometry'] : [],
      total_students: 120 + Math.floor(Math.random() * 30),
      graded_students: hasMissingGrades ? 95 : 120 + Math.floor(Math.random() * 30),
      last_grade_entry: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000),
      sync_source: 'powerschool',
      last_synced_at: new Date(),
    });
  }

  // ========================================
  // VIDEO EVIDENCE & AI OBSERVATIONS
  // ========================================
  for (let i = 0; i < 3; i++) {
    const videoId = uuidv4();
    const teacherIdx = Math.floor(Math.random() * TEACHER_IDS.length);

    await knex('video_evidence').insert({
      id: videoId,
      teacher_id: TEACHER_IDS[teacherIdx],
      class_id: 'algebra_101',
      original_filename: `classroom_observation_${i + 1}.mp4`,
      clip_url: `https://example.com/videos/stub_${i + 1}.mp4`,
      thumbnail_url: `https://example.com/thumbs/stub_${i + 1}.jpg`,
      start_ts: new Date(Date.now() - 24 * 60 * 60 * 1000),
      end_ts: new Date(Date.now() - 24 * 60 * 60 * 1000 + 45 * 60 * 1000),
      duration_seconds: 2700,
      processing_status: 'completed',
      uploaded_by: PRINCIPAL_ID,
    });

    // Create AI observations for this video
    for (let j = 0; j < 3; j++) {
      await knex('ai_observations').insert({
        video_id: videoId,
        element_id: danielsonElementIds[j],
        confidence: 0.75 + Math.random() * 0.2,
        score_estimate: 65 + Math.floor(Math.random() * 30),
        start_ts: new Date(Date.now() - 24 * 60 * 60 * 1000 + j * 10 * 60 * 1000),
        end_ts: new Date(Date.now() - 24 * 60 * 60 * 1000 + (j + 1) * 10 * 60 * 1000),
        summary: `AI observation: Teacher demonstrates ${j === 0 ? 'strong content knowledge' : j === 1 ? 'effective student engagement' : 'good classroom management'} during this segment.`,
        key_moments: JSON.stringify([
          { timestamp: new Date().toISOString(), description: 'Key teaching moment observed', sentiment: 'positive' }
        ]),
        status: 'pending',
        model_version: 'stub-v1.0',
      });
    }
  }

  console.log('Seed data inserted successfully!');
}
