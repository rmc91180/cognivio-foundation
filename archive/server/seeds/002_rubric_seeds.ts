import type { Knex } from 'knex';

// Full Marshall Rubric from spec
export const MARSHALL_RUBRIC = {
  id: 'marshall_v2010',
  name: 'Marshall Rubric (Kim Marshall, 2010)',
  source: 'Marshall',
  version: '2010-01-18',
  aggregation_mode: 'weighted',
  default_thresholds: { green: 80, yellow: 60, red: 0 },
  domains: [
    {
      id: 'planning_preparation',
      name: 'Planning and Preparation for Learning',
      weight: 1.0,
      elements: [
        { id: 'mp_a_knowledge', name: 'Knowledge', desc: 'Expertise in subject and child development', weight: 1 },
        { id: 'mp_a_strategy', name: 'Strategy', desc: 'Year plan aligned with standards and assessments', weight: 1 },
        { id: 'mp_a_alignment', name: 'Alignment', desc: 'Backward planning aligned to standards and Bloom', weight: 1 },
        { id: 'mp_a_assessments', name: 'Assessments', desc: 'Diagnostic, interim, summative assessments planned', weight: 1 },
        { id: 'mp_a_anticipation', name: 'Anticipation', desc: 'Anticipates misconceptions and plans responses', weight: 1 },
        { id: 'mp_a_lessons', name: 'Lessons', desc: 'Clear measurable lesson goals aligned to standards', weight: 1 },
        { id: 'mp_a_engagement', name: 'Engagement', desc: 'Designs lessons to motivate and engage all students', weight: 1 },
        { id: 'mp_a_materials', name: 'Materials', desc: 'Uses high-quality, multicultural materials', weight: 1 },
        { id: 'mp_a_differentiation', name: 'Differentiation', desc: 'Addresses diverse learning needs and styles', weight: 1 },
        { id: 'mp_a_environment', name: 'Environment', desc: 'Uses room arrangement and displays to support learning', weight: 1 },
      ],
    },
    {
      id: 'classroom_management',
      name: 'Classroom Management',
      weight: 1.0,
      elements: [
        { id: 'mp_b_expectations', name: 'Expectations', desc: 'Communicates and enforces high behavior expectations', weight: 1 },
        { id: 'mp_b_relationships', name: 'Relationships', desc: 'Builds warm, respectful relationships with students', weight: 1 },
        { id: 'mp_b_respect', name: 'Respect', desc: 'Commands respect and minimizes disruption', weight: 1 },
        { id: 'mp_b_social_emotional', name: 'Social Emotional', desc: 'Develops positive interactions and social skills', weight: 1 },
        { id: 'mp_b_routines', name: 'Routines', desc: 'Teaches and maintains classroom routines', weight: 1 },
        { id: 'mp_b_responsibility', name: 'Responsibility', desc: 'Develops student self-discipline and responsibility', weight: 1 },
        { id: 'mp_b_repertoire', name: 'Repertoire', desc: 'Has a wide repertoire of discipline and engagement moves', weight: 1 },
        { id: 'mp_b_efficiency', name: 'Efficiency', desc: 'Maximizes instructional time and transitions', weight: 1 },
        { id: 'mp_b_prevention', name: 'Prevention', desc: 'Anticipates and nips discipline problems in the bud', weight: 1 },
        { id: 'mp_b_incentives', name: 'Incentives', desc: 'Uses incentives linked to intrinsic motivation', weight: 1 },
      ],
    },
    {
      id: 'delivery_instruction',
      name: 'Delivery of Instruction',
      weight: 1.0,
      elements: [
        { id: 'mp_c_expectations', name: 'Expectations', desc: 'Sets and communicates high expectations', weight: 1 },
        { id: 'mp_c_effort', name: 'Effort-Based', desc: 'Encourages effort and learning from mistakes', weight: 1 },
        { id: 'mp_c_goals', name: 'Goals', desc: 'Posts essential questions, goals, and exemplars', weight: 1 },
        { id: 'mp_c_connections', name: 'Connections', desc: 'Makes connections to prior knowledge', weight: 1 },
        { id: 'mp_c_clarity', name: 'Clarity', desc: 'Presents material clearly with good examples', weight: 1 },
        { id: 'mp_c_repertoire', name: 'Repertoire', desc: 'Uses varied strategies and groupings', weight: 1 },
        { id: 'mp_c_engagement', name: 'Engagement', desc: 'Gets students actively involved', weight: 1 },
        { id: 'mp_c_differentiation', name: 'Differentiation', desc: 'Differentiates and scaffolds for diverse learners', weight: 1 },
        { id: 'mp_c_nimbleness', name: 'Nimbleness', desc: 'Adapts lessons to teachable moments', weight: 1 },
        { id: 'mp_c_application', name: 'Application', desc: 'Has students apply learning to real life', weight: 1 },
      ],
    },
    {
      id: 'monitoring_assessment',
      name: 'Monitoring Assessment and Follow-Up',
      weight: 1.0,
      elements: [
        { id: 'mp_d_criteria', name: 'Criteria', desc: 'Posts and reviews criteria for proficient work', weight: 1 },
        { id: 'mp_d_diagnosis', name: 'Diagnosis', desc: 'Uses diagnostic assessments to fine-tune instruction', weight: 1 },
        { id: 'mp_d_on_the_spot', name: 'On-the-Spot', desc: 'Checks for understanding and clarifies', weight: 1 },
        { id: 'mp_d_self_assessment', name: 'Self-Assessment', desc: 'Has students set goals and self-assess', weight: 1 },
        { id: 'mp_d_recognition', name: 'Recognition', desc: 'Posts student work and uses it to motivate', weight: 1 },
        { id: 'mp_d_interims', name: 'Interims', desc: 'Uses interim data to adjust instruction', weight: 1 },
        { id: 'mp_d_tenacity', name: 'Tenacity', desc: 'Relentlessly follows up with struggling students', weight: 1 },
        { id: 'mp_d_support', name: 'Support', desc: 'Ensures students receive specialized services', weight: 1 },
        { id: 'mp_d_analysis', name: 'Analysis', desc: 'Analyzes assessment data with colleagues', weight: 1 },
        { id: 'mp_d_reflection', name: 'Reflection', desc: 'Reflects and improves instruction with colleagues', weight: 1 },
      ],
    },
    {
      id: 'family_community',
      name: 'Family and Community Outreach',
      weight: 1.0,
      elements: [
        { id: 'mp_e_respect', name: 'Respect', desc: 'Respects family culture and values', weight: 1 },
        { id: 'mp_e_belief', name: 'Belief', desc: 'Shows parents in-depth knowledge and belief in child', weight: 1 },
        { id: 'mp_e_expectations', name: 'Expectations', desc: 'Gives parents clear learning and behavior expectations', weight: 1 },
        { id: 'mp_e_communication', name: 'Communication', desc: 'Communicates promptly about problems and positives', weight: 1 },
        { id: 'mp_e_involving', name: 'Involving', desc: 'Involves parents in supporting curriculum', weight: 1 },
        { id: 'mp_e_homework', name: 'Homework', desc: 'Assigns engaging homework and provides feedback', weight: 1 },
        { id: 'mp_e_responsiveness', name: 'Responsiveness', desc: 'Responds promptly to parent concerns', weight: 1 },
        { id: 'mp_e_reporting', name: 'Reporting', desc: 'Gives detailed feedback in conferences and reports', weight: 1 },
        { id: 'mp_e_outreach', name: 'Outreach', desc: 'Contacts and works with hard-to-reach parents', weight: 1 },
        { id: 'mp_e_resources', name: 'Resources', desc: 'Enlists volunteers and community resources', weight: 1 },
      ],
    },
    {
      id: 'professional_responsibilities',
      name: 'Professional Responsibilities',
      weight: 1.0,
      elements: [
        { id: 'mp_f_attendance', name: 'Attendance', desc: 'Maintains excellent attendance', weight: 1 },
        { id: 'mp_f_reliability', name: 'Reliability', desc: 'Completes duties and keeps accurate records', weight: 1 },
        { id: 'mp_f_professionalism', name: 'Professionalism', desc: 'Maintains professional demeanor and boundaries', weight: 1 },
        { id: 'mp_f_judgment', name: 'Judgment', desc: 'Uses ethical, sound judgment and confidentiality', weight: 1 },
        { id: 'mp_f_teamwork', name: 'Teamwork', desc: 'Contributes to teams and school activities', weight: 1 },
        { id: 'mp_f_contributions', name: 'Contributions', desc: 'Contributes ideas and expertise to school mission', weight: 1 },
        { id: 'mp_f_communication', name: 'Communication', desc: 'Keeps administration informed and asks for help', weight: 1 },
        { id: 'mp_f_openness', name: 'Openness', desc: 'Seeks feedback and uses it to improve', weight: 1 },
        { id: 'mp_f_collaboration', name: 'Collaboration', desc: 'Meets regularly with colleagues to plan and analyze', weight: 1 },
      ],
    },
  ],
};

// Full Danielson Framework from spec
export const DANIELSON_RUBRIC = {
  id: 'danielson_v2026',
  name: 'Danielson Framework (standard)',
  source: 'Danielson',
  version: '2026-01',
  aggregation_mode: 'weighted',
  default_thresholds: { green: 80, yellow: 60, red: 0 },
  domains: [
    {
      id: 'dn_planning_preparation',
      name: 'Planning and Preparation',
      weight: 1.0,
      elements: [
        { id: 'dn_pp_content_pedagogy', name: 'Demonstrating Knowledge of Content and Pedagogy', desc: 'Deep content knowledge and pedagogy', weight: 1 },
        { id: 'dn_pp_knowledge_students', name: 'Demonstrating Knowledge of Students', desc: 'Knows students\' backgrounds and needs', weight: 1 },
        { id: 'dn_pp_outcomes', name: 'Setting Instructional Outcomes', desc: 'Clear measurable outcomes', weight: 1 },
        { id: 'dn_pp_resources', name: 'Demonstrating Knowledge of Resources', desc: 'Uses resources to support learning', weight: 1 },
        { id: 'dn_pp_coherent_instruction', name: 'Designing Coherent Instruction', desc: 'Plans coherent instruction sequences', weight: 1 },
        { id: 'dn_pp_assessments', name: 'Designing Student Assessments', desc: 'Designs assessments aligned to outcomes', weight: 1 },
      ],
    },
    {
      id: 'dn_classroom_environment',
      name: 'Classroom Environment',
      weight: 1.0,
      elements: [
        { id: 'dn_ce_respect_rapport', name: 'Creating an Environment of Respect and Rapport', desc: 'Builds respectful relationships', weight: 1 },
        { id: 'dn_ce_culture_learning', name: 'Establishing a Culture for Learning', desc: 'Fosters a culture that values learning', weight: 1 },
        { id: 'dn_ce_manage_procedures', name: 'Managing Classroom Procedures', desc: 'Efficient classroom procedures', weight: 1 },
        { id: 'dn_ce_manage_behavior', name: 'Managing Student Behavior', desc: 'Maintains high standards of behavior', weight: 1 },
        { id: 'dn_ce_physical_space', name: 'Organizing Physical Space', desc: 'Organizes space to support learning', weight: 1 },
      ],
    },
    {
      id: 'dn_instruction',
      name: 'Instruction',
      weight: 1.0,
      elements: [
        { id: 'dn_i_communicate', name: 'Communicating with Students', desc: 'Clear communication and directions', weight: 1 },
        { id: 'dn_i_questioning', name: 'Using Questioning and Discussion Techniques', desc: 'Effective questioning and discussion', weight: 1 },
        { id: 'dn_i_engaging', name: 'Engaging Students in Learning', desc: 'Engages students in meaningful learning', weight: 1 },
        { id: 'dn_i_assessment', name: 'Using Assessment in Instruction', desc: 'Uses assessment to guide instruction', weight: 1 },
        { id: 'dn_i_flexibility', name: 'Demonstrating Flexibility and Responsiveness', desc: 'Adapts instruction responsively', weight: 1 },
      ],
    },
    {
      id: 'dn_professional_responsibilities',
      name: 'Professional Responsibilities',
      weight: 1.0,
      elements: [
        { id: 'dn_pr_reflect', name: 'Reflecting on Teaching', desc: 'Reflects and improves practice', weight: 1 },
        { id: 'dn_pr_records', name: 'Maintaining Accurate Records', desc: 'Keeps accurate records', weight: 1 },
        { id: 'dn_pr_families', name: 'Communicating with Families', desc: 'Communicates effectively with families', weight: 1 },
        { id: 'dn_pr_prof_community', name: 'Participating in the Professional Community', desc: 'Engages with professional community', weight: 1 },
        { id: 'dn_pr_growth', name: 'Growing and Developing Professionally', desc: 'Pursues professional growth', weight: 1 },
        { id: 'dn_pr_professionalism', name: 'Showing Professionalism', desc: 'Demonstrates professional behavior', weight: 1 },
      ],
    },
  ],
};

// Get all element IDs for use in seeding
export function getAllMarshallElementIds(): string[] {
  return MARSHALL_RUBRIC.domains.flatMap(d => d.elements.map(e => e.id));
}

export function getAllDanielsonElementIds(): string[] {
  return DANIELSON_RUBRIC.domains.flatMap(d => d.elements.map(e => e.id));
}

export async function seed(knex: Knex): Promise<void> {
  // This file only exports the rubric data
  // The main seed file imports and uses these
  console.log('Rubric data exported for use in main seed');
}
