import { Router, Request, Response } from 'express';
import { db } from '../utils/db';
import { authenticateToken } from '../middleware/auth';
import {
  RosterRow,
  RosterTotals,
  MetricCell,
  GradebookStatusSummary,
  StatusColor,
  AggregationMode
} from '../types';
import {
  colorFromScore,
  computeColumnScore,
  DEFAULT_THRESHOLDS
} from '../utils/aggregation';

const router = Router();

/**
 * GET /api/roster
 * Get teacher roster with color-coded metrics
 */
router.get('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    const {
      templateId,
      page = '1',
      pageSize = '25',
      sort = 'name',
      order = 'asc',
      search,
      subjects,
      grades,
      status,
      gradebookIssues,
    } = req.query;

    const schoolId = req.user!.schoolId;
    const userId = req.user!.userId;

    if (!schoolId) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'User must be associated with a school',
        },
      });
    }

    if (!templateId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'templateId is required',
        },
      });
    }

    // Get user thresholds
    const preferences = await db('user_preferences')
      .where('user_id', userId)
      .first();

    const thresholds = {
      greenMin: preferences?.color_threshold_green || DEFAULT_THRESHOLDS.greenMin,
      yellowMin: preferences?.color_threshold_yellow || DEFAULT_THRESHOLDS.yellowMin,
    };

    // Get template info
    const template = await db('rubric_templates')
      .where('id', templateId)
      .first();

    if (!template) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Template not found',
        },
      });
    }

    const aggregationMode = template.aggregation_mode as AggregationMode;

    // Get template columns
    const columns = await db('template_columns')
      .where('template_id', templateId)
      .where('enabled', true)
      .orderBy('column_index');

    // Get column element assignments
    const columnElements = new Map<string, string[]>();
    for (const col of columns) {
      const assignments = await db('template_column_assignments')
        .where('column_id', col.id)
        .select('element_id');
      columnElements.set(col.id, assignments.map(a => a.element_id));
    }

    // Build teacher query
    let teacherQuery = db('teachers').where('status', 'active');

    teacherQuery = teacherQuery.where('school_id', schoolId);

    if (search) {
      teacherQuery = teacherQuery.where('name', 'ilike', `%${search}%`);
    }

    if (subjects) {
      const subjectList = (subjects as string).split(',');
      teacherQuery = teacherQuery.whereRaw(
        'subjects && ?',
        [subjectList]
      );
    }

    if (grades) {
      const gradeList = (grades as string).split(',');
      teacherQuery = teacherQuery.whereRaw(
        'grades && ?',
        [gradeList]
      );
    }

    // Get total count
    const countResult = await teacherQuery.clone().count('id as count').first();
    const totalItems = parseInt(countResult?.count as string) || 0;

    // Apply pagination
    const pageNum = parseInt(page as string);
    const pageSizeNum = parseInt(pageSize as string);
    const teachers = await teacherQuery
      .orderBy(sort as string, order as string)
      .offset((pageNum - 1) * pageSizeNum)
      .limit(pageSizeNum);

    // Build roster rows
    const rows: RosterRow[] = [];
    let greenCount = 0;
    let yellowCount = 0;
    let redCount = 0;
    let missingGradebookCount = 0;

    for (const teacher of teachers) {
      // Get latest assessment with element scores
      const latestAssessment = await db('assessments')
        .where('teacher_id', teacher.id)
        .where('template_id', templateId)
        .orderBy('observation_date', 'desc')
        .first();

      // Get assessment element scores
      let elementScores = new Map<string, { score: number; weight: number }>();
      if (latestAssessment) {
        const elements = await db('assessment_elements')
          .join('rubric_elements', 'rubric_elements.id', 'assessment_elements.element_id')
          .where('assessment_id', latestAssessment.id)
          .select('assessment_elements.*', 'rubric_elements.default_weight');

        for (const elem of elements) {
          elementScores.set(elem.element_id, {
            score: parseFloat(elem.score),
            weight: parseFloat(elem.default_weight) || 1.0,
          });
        }
      }

      // Calculate metrics for each column
      const metrics: MetricCell[] = [];
      let totalColumnScore = 0;
      let columnCount = 0;

      for (const col of columns) {
        const colElementIds = columnElements.get(col.id) || [];
        const colScores: { score: number; weight: number }[] = [];

        for (const elemId of colElementIds) {
          const elemScore = elementScores.get(elemId);
          if (elemScore) {
            colScores.push(elemScore);
          }
        }

        const { numericScore, color } = computeColumnScore(
          colScores,
          aggregationMode,
          thresholds
        );

        metrics.push({
          columnId: col.id,
          columnName: col.name,
          color,
          numericScore,
          elementCount: colScores.length,
          lastObserved: latestAssessment?.observation_date?.toISOString() || null,
        });

        if (colScores.length > 0) {
          totalColumnScore += numericScore * parseFloat(col.weight);
          columnCount += parseFloat(col.weight);
        }
      }

      // Calculate overall score and color
      const overallScore = columnCount > 0 ? totalColumnScore / columnCount : 0;
      const overallColor = colorFromScore(overallScore, thresholds);

      // Get gradebook status
      const gradebook = await db('gradebook_status')
        .where('teacher_id', teacher.id)
        .first();

      const gradebookStatus: GradebookStatusSummary = {
        isHealthy: gradebook?.is_healthy ?? true,
        missingGrades: gradebook?.missing_grades ?? false,
        classesMissing: gradebook?.classes_missing || [],
        lastUpdated: gradebook?.last_synced_at?.toISOString() || null,
      };

      if (gradebook?.missing_grades) {
        missingGradebookCount++;
      }

      // Filter by status if provided
      if (status) {
        const statusList = (status as string).split(',') as StatusColor[];
        if (!statusList.includes(overallColor)) {
          continue;
        }
      }

      // Filter by gradebook issues if requested
      if (gradebookIssues === 'true' && !gradebook?.missing_grades) {
        continue;
      }

      // Count by color
      if (overallColor === 'green') greenCount++;
      else if (overallColor === 'yellow') yellowCount++;
      else redCount++;

      rows.push({
        teacherId: teacher.id,
        teacherName: teacher.name,
        email: teacher.email,
        subjects: teacher.subjects || [],
        grades: teacher.grades || [],
        metrics,
        gradebookStatus,
        lastObserved: latestAssessment?.observation_date?.toISOString() || null,
        overallScore: Math.round(overallScore * 100) / 100,
        overallColor,
      });
    }

    const totals: RosterTotals = {
      total: totalItems,
      green: greenCount,
      yellow: yellowCount,
      red: redCount,
      missingGradebook: missingGradebookCount,
    };

    return res.json({
      success: true,
      data: { rows, totals },
      meta: {
        page: pageNum,
        pageSize: pageSizeNum,
        totalPages: Math.ceil(totalItems / pageSizeNum),
        totalItems,
      },
    });
  } catch (error) {
    console.error('Get roster error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An error occurred fetching roster',
      },
    });
  }
});

export default router;
