import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../utils/db';
import { authenticateToken, requireRoles } from '../middleware/auth';
import { logAudit } from '../services/auditService';
import { CreateTemplateRequest, RubricTemplate, RubricDomain, RubricElement } from '../types';

const router = Router();

/**
 * GET /api/rubrics/templates
 * List available rubric templates
 */
router.get('/templates', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { source, includeShared } = req.query;
    const schoolId = req.user!.schoolId;

    let query = db('rubric_templates').where('is_active', true);

    // Filter by source if provided
    if (source) {
      query = query.where('source', source as string);
    }

    // Include system templates and optionally shared templates
    query = query.where(function() {
      this.where('is_system_template', true);
      if (schoolId) {
        this.orWhere('school_id', schoolId);
      }
      if (includeShared === 'true') {
        this.orWhereNull('school_id');
      }
    });

    const templates = await query.orderBy('is_system_template', 'desc').orderBy('name');

    // Get domain and element counts for each template
    const templatesWithCounts = await Promise.all(
      templates.map(async (template) => {
        const domainCount = await db('rubric_domains')
          .where('template_id', template.id)
          .count('id as count')
          .first();
        const elementCount = await db('rubric_elements')
          .where('template_id', template.id)
          .count('id as count')
          .first();

        return {
          id: template.id,
          name: template.name,
          source: template.source,
          version: template.version,
          description: template.description,
          aggregationMode: template.aggregation_mode,
          domainsCount: parseInt(domainCount?.count as string) || 0,
          elementsCount: parseInt(elementCount?.count as string) || 0,
          createdBy: template.created_by,
          createdAt: template.created_at,
          updatedAt: template.updated_at,
          isDefault: false, // Will be set by client based on user preferences
        };
      })
    );

    return res.json({
      success: true,
      data: templatesWithCounts,
    });
  } catch (error) {
    console.error('Get templates error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An error occurred fetching templates',
      },
    });
  }
});

/**
 * GET /api/rubrics/elements
 * Get elements for a specific template, organized by domain
 */
router.get('/elements', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { templateId } = req.query;

    if (!templateId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'templateId is required',
        },
      });
    }

    // Get template
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

    // Get domains with elements
    const domains = await db('rubric_domains')
      .where('template_id', templateId)
      .orderBy('sort_order');

    const domainsWithElements = await Promise.all(
      domains.map(async (domain) => {
        const elements = await db('rubric_elements')
          .where('domain_id', domain.id)
          .orderBy('sort_order');

        return {
          id: domain.id,
          name: domain.name,
          description: domain.description,
          sortOrder: domain.sort_order,
          elements: elements.map((elem) => ({
            id: elem.id,
            name: elem.name,
            description: elem.description,
            indicators: elem.indicators || [],
            defaultWeight: parseFloat(elem.default_weight) || 1.0,
            sortOrder: elem.sort_order,
          })),
        };
      })
    );

    return res.json({
      success: true,
      data: {
        templateId,
        domains: domainsWithElements,
      },
    });
  } catch (error) {
    console.error('Get elements error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An error occurred fetching elements',
      },
    });
  }
});

/**
 * POST /api/rubrics/select
 * Select a template as active for the current user
 */
router.post('/select', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { templateId, setAsDefault } = req.body;
    const userId = req.user!.userId;

    // Verify template exists
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

    // Update or create user preferences
    const existing = await db('user_preferences')
      .where('user_id', userId)
      .first();

    if (existing) {
      await db('user_preferences')
        .where('user_id', userId)
        .update({
          default_template_id: setAsDefault ? templateId : existing.default_template_id,
          updated_at: new Date(),
        });
    } else {
      await db('user_preferences').insert({
        id: uuidv4(),
        user_id: userId,
        default_template_id: setAsDefault ? templateId : null,
      });
    }

    // Get element count
    const elementCount = await db('rubric_elements')
      .where('template_id', templateId)
      .count('id as count')
      .first();

    await logAudit({
      userId,
      action: 'template_select',
      targetType: 'rubric_template',
      targetId: templateId,
      details: { setAsDefault },
    });

    return res.json({
      success: true,
      data: {
        templateId,
        elementsCount: parseInt(elementCount?.count as string) || 0,
        message: 'Template selected successfully',
      },
    });
  } catch (error) {
    console.error('Select template error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An error occurred',
      },
    });
  }
});

/**
 * POST /api/rubrics/templates
 * Create a new custom template
 */
router.post('/templates', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const schoolId = req.user!.schoolId;
    const body = req.body as CreateTemplateRequest;

    // Validate request
    if (!body.name || !body.columns || body.columns.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Template name and columns are required',
        },
      });
    }

    // Validate columns have elements
    const validationErrors: Record<string, string[]> = {};
    body.columns.forEach((col, idx) => {
      if (col.enabled && (!col.elementIds || col.elementIds.length === 0)) {
        validationErrors[`columns[${idx}].elementIds`] = [
          'Enabled column must have at least one element assigned',
        ];
      }
    });

    if (Object.keys(validationErrors).length > 0) {
      return res.status(422).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Template validation failed',
          details: validationErrors,
        },
      });
    }

    // Create template in transaction
    const templateId = uuidv4();
    const version = 'v1.0';

    await db.transaction(async (trx) => {
      // Insert template
      await trx('rubric_templates').insert({
        id: templateId,
        name: body.name,
        source: 'custom',
        version,
        description: body.description || null,
        aggregation_mode: body.aggregationMode || 'weighted',
        school_id: schoolId,
        created_by: userId,
        is_system_template: false,
        is_active: true,
        config: JSON.stringify({ versionNotes: body.versionNotes }),
      });

      // Insert columns and assignments
      for (let i = 0; i < body.columns.length; i++) {
        const col = body.columns[i];
        const columnId = uuidv4();

        await trx('template_columns').insert({
          id: columnId,
          template_id: templateId,
          column_index: i,
          name: col.name,
          weight: col.weight,
          enabled: col.enabled,
        });

        // Insert element assignments
        for (let j = 0; j < col.elementIds.length; j++) {
          await trx('template_column_assignments').insert({
            id: uuidv4(),
            column_id: columnId,
            element_id: col.elementIds[j],
            sort_order: j,
          });
        }
      }
    });

    await logAudit({
      userId,
      action: 'template_create',
      targetType: 'rubric_template',
      targetId: templateId,
      details: { name: body.name, columnsCount: body.columns.length },
    });

    return res.status(201).json({
      success: true,
      data: {
        id: templateId,
        name: body.name,
        version,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Create template error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An error occurred creating the template',
      },
    });
  }
});

/**
 * PUT /api/rubrics/templates/:templateId
 * Update an existing template
 */
router.put('/templates/:templateId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { templateId } = req.params;
    const userId = req.user!.userId;
    const body = req.body as CreateTemplateRequest;

    // Check template exists and user can edit
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

    if (template.is_system_template) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Cannot edit system templates',
        },
      });
    }

    // Increment version
    const currentVersion = template.version || 'v1.0';
    const versionNum = parseFloat(currentVersion.replace('v', '')) || 1.0;
    const newVersion = `v${(versionNum + 0.1).toFixed(1)}`;

    await db.transaction(async (trx) => {
      // Update template
      await trx('rubric_templates')
        .where('id', templateId)
        .update({
          name: body.name,
          description: body.description,
          aggregation_mode: body.aggregationMode,
          version: newVersion,
          config: JSON.stringify({ versionNotes: body.versionNotes }),
          updated_at: new Date(),
        });

      // Delete existing columns and assignments
      await trx('template_columns')
        .where('template_id', templateId)
        .del();

      // Insert new columns and assignments
      for (let i = 0; i < body.columns.length; i++) {
        const col = body.columns[i];
        const columnId = uuidv4();

        await trx('template_columns').insert({
          id: columnId,
          template_id: templateId,
          column_index: i,
          name: col.name,
          weight: col.weight,
          enabled: col.enabled,
        });

        for (let j = 0; j < col.elementIds.length; j++) {
          await trx('template_column_assignments').insert({
            id: uuidv4(),
            column_id: columnId,
            element_id: col.elementIds[j],
            sort_order: j,
          });
        }
      }
    });

    await logAudit({
      userId,
      action: 'template_update',
      targetType: 'rubric_template',
      targetId: templateId,
      details: { newVersion },
    });

    return res.json({
      success: true,
      data: {
        id: templateId,
        version: newVersion,
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Update template error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An error occurred updating the template',
      },
    });
  }
});

/**
 * GET /api/rubrics/templates/:templateId/columns
 * Get columns for a template
 */
router.get('/templates/:templateId/columns', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { templateId } = req.params;

    const columns = await db('template_columns')
      .where('template_id', templateId)
      .orderBy('column_index');

    const columnsWithElements = await Promise.all(
      columns.map(async (col) => {
        const assignments = await db('template_column_assignments')
          .join('rubric_elements', 'rubric_elements.id', 'template_column_assignments.element_id')
          .where('column_id', col.id)
          .select('rubric_elements.*', 'template_column_assignments.sort_order')
          .orderBy('template_column_assignments.sort_order');

        return {
          id: col.id,
          columnIndex: col.column_index,
          name: col.name,
          weight: parseFloat(col.weight),
          enabled: col.enabled,
          elements: assignments.map((a) => ({
            id: a.id,
            name: a.name,
            description: a.description,
          })),
        };
      })
    );

    return res.json({
      success: true,
      data: columnsWithElements,
    });
  } catch (error) {
    console.error('Get columns error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An error occurred',
      },
    });
  }
});

export default router;
