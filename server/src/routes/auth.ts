import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import passport from 'passport';
import { db } from '../utils/db';
import { generateToken, generateRefreshToken, authenticateToken } from '../middleware/auth';
import { LoginRequest, LoginResponse, User, UserPreferences, UserRole } from '../types';
import { logAudit } from '../services/auditService';
import { ssoService } from '../services/ssoService';

const router = Router();

// Frontend URL for redirects
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

/**
 * POST /api/auth/login
 * Authenticate user with email and password
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body as LoginRequest;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Email and password are required',
        },
      });
    }

    // Find user
    const user = await db('users')
      .where('email', email.toLowerCase())
      .first() as User | undefined;

    if (!user || !user.password_hash) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid email or password',
        },
      });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid email or password',
        },
      });
    }

    // Get user preferences
    const preferences = await db('user_preferences')
      .where('user_id', user.id)
      .first() as UserPreferences | undefined;

    // Get school name
    let schoolName = null;
    if (user.school_id) {
      const school = await db('schools').where('id', user.school_id).first();
      schoolName = school?.name;
    }

    // Generate tokens
    const activeRole = (user.active_role || user.roles[0]) as UserRole;
    const token = generateToken({
      userId: user.id,
      email: user.email,
      roles: user.roles as UserRole[],
      activeRole,
      schoolId: user.school_id,
    });
    const refreshToken = generateRefreshToken(user.id);

    // Update last login
    await db('users')
      .where('id', user.id)
      .update({ last_login_at: new Date() });

    // Log audit
    await logAudit({
      userId: user.id,
      userName: user.name,
      action: 'login',
      targetType: 'user',
      targetId: user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    const response: LoginResponse = {
      token,
      refreshToken,
      expiresIn: 86400, // 24 hours
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roles: user.roles as UserRole[],
        activeRole,
        schoolId: user.school_id,
        schoolName,
        defaultRoute: '/dashboard',
        preferences: preferences || {},
      },
    };

    return res.json({
      success: true,
      data: response,
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An error occurred during login',
      },
    });
  }
});

/**
 * GET /api/auth/google
 * Initiate Google OAuth authentication
 */
router.get('/google', passport.authenticate('google', {
  scope: ['profile', 'email'],
  session: false,
}));

/**
 * GET /api/auth/google/callback
 * Handle Google OAuth callback
 */
router.get('/google/callback',
  passport.authenticate('google', {
    failureRedirect: `${FRONTEND_URL}/login?error=google_auth_failed`,
    session: false,
  }),
  async (req: Request, res: Response) => {
    try {
      const user = req.user as any;

      if (!user) {
        return res.redirect(`${FRONTEND_URL}/login?error=no_user`);
      }

      // Get user preferences
      const preferences = await db('user_preferences')
        .where('user_id', user.id)
        .first();

      // Get school name
      let schoolName = null;
      if (user.school_id) {
        const school = await db('schools').where('id', user.school_id).first();
        schoolName = school?.name;
      }

      // Generate JWT token
      const activeRole = (user.active_role || user.roles[0]) as UserRole;
      const token = generateToken({
        userId: user.id,
        email: user.email,
        roles: user.roles as UserRole[],
        activeRole,
        schoolId: user.school_id,
      });
      // Update last login
      await db('users')
        .where('id', user.id)
        .update({ last_login_at: new Date() });

      // Redirect to frontend with token
      const params = new URLSearchParams({
        token,
        userId: user.id,
        email: user.email,
        name: user.name,
        activeRole,
      });

      return res.redirect(`${FRONTEND_URL}/auth/callback#${params.toString()}`);
    } catch (error) {
      console.error('Google callback error:', error);
      return res.redirect(`${FRONTEND_URL}/login?error=callback_failed`);
    }
  }
);

/**
 * GET /api/auth/microsoft
 * Initiate Microsoft OAuth authentication
 */
router.get('/microsoft', passport.authenticate('microsoft', {
  scope: ['user.read'],
  session: false,
}));

/**
 * GET /api/auth/microsoft/callback
 * Handle Microsoft OAuth callback
 */
router.get('/microsoft/callback',
  passport.authenticate('microsoft', {
    failureRedirect: `${FRONTEND_URL}/login?error=microsoft_auth_failed`,
    session: false,
  }),
  async (req: Request, res: Response) => {
    try {
      const user = req.user as any;

      if (!user) {
        return res.redirect(`${FRONTEND_URL}/login?error=no_user`);
      }

      // Get user preferences
      const preferences = await db('user_preferences')
        .where('user_id', user.id)
        .first();

      // Get school name
      let schoolName = null;
      if (user.school_id) {
        const school = await db('schools').where('id', user.school_id).first();
        schoolName = school?.name;
      }

      // Generate JWT token
      const activeRole = (user.active_role || user.roles[0]) as UserRole;
      const token = generateToken({
        userId: user.id,
        email: user.email,
        roles: user.roles as UserRole[],
        activeRole,
        schoolId: user.school_id,
      });
      // Update last login
      await db('users')
        .where('id', user.id)
        .update({ last_login_at: new Date() });

      // Redirect to frontend with token
      const params = new URLSearchParams({
        token,
        userId: user.id,
        email: user.email,
        name: user.name,
        activeRole,
      });

      return res.redirect(`${FRONTEND_URL}/auth/callback#${params.toString()}`);
    } catch (error) {
      console.error('Microsoft callback error:', error);
      return res.redirect(`${FRONTEND_URL}/login?error=callback_failed`);
    }
  }
);

/**
 * GET /api/auth/sso/status
 * Check SSO configuration status
 */
router.get('/sso/status', async (req: Request, res: Response) => {
  return res.json({
    success: true,
    data: {
      google: {
        enabled: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
        configured: !!process.env.GOOGLE_CLIENT_ID,
      },
      microsoft: {
        enabled: !!(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET),
        configured: !!process.env.MICROSOFT_CLIENT_ID,
      },
    },
  });
});

/**
 * POST /api/auth/sso/link
 * Link SSO provider to existing account (requires authentication)
 */
router.post('/sso/link', authenticateToken, async (req: Request, res: Response) => {
  const { provider } = req.body;

  if (!['google', 'microsoft'].includes(provider)) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid provider. Must be "google" or "microsoft".',
      },
    });
  }

  // Return URL to initiate OAuth flow for linking
  return res.json({
    success: true,
    data: {
      authUrl: `/api/auth/${provider}?link=true`,
      message: `Redirect to this URL to link your ${provider} account.`,
    },
  });
});

/**
 * POST /api/auth/sso/unlink
 * Unlink SSO provider from account (requires authentication and password)
 */
router.post('/sso/unlink', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const result = await ssoService.unlinkSSO(userId);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'UNLINK_FAILED',
          message: result.error,
        },
      });
    }

    return res.json({
      success: true,
      data: {
        message: 'SSO provider unlinked successfully',
      },
    });
  } catch (error) {
    console.error('SSO unlink error:', error);
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
 * POST /api/auth/role/select
 * Select active role for users with multiple roles
 */
router.post('/role/select', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { role } = req.body;
    const userId = req.user!.userId;

    // Validate role
    const user = await db('users').where('id', userId).first();
    if (!user || !user.roles.includes(role)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid role selection',
        },
      });
    }

    // Update active role
    await db('users')
      .where('id', userId)
      .update({ active_role: role });

    return res.json({
      success: true,
      data: {
        activeRole: role,
        defaultRoute: '/dashboard',
        permissions: getRolePermissions(role),
      },
    });
  } catch (error) {
    console.error('Role selection error:', error);
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
 * GET /api/auth/me
 * Get current user info
 */
router.get('/me', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    const user = await db('users').where('id', userId).first();
    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'User not found',
        },
      });
    }

    const preferences = await db('user_preferences')
      .where('user_id', userId)
      .first();

    let schoolName = null;
    if (user.school_id) {
      const school = await db('schools').where('id', user.school_id).first();
      schoolName = school?.name;
    }

    return res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        roles: user.roles,
        activeRole: user.active_role || user.roles[0],
        schoolId: user.school_id,
        schoolName,
        preferences: preferences || {},
      },
    });
  } catch (error) {
    console.error('Get user error:', error);
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
 * POST /api/auth/refresh
 * Refresh access token
 */
router.post('/refresh', async (req: Request, res: Response) => {
  // TODO: Implement proper refresh token validation
  return res.status(501).json({
    success: false,
    error: {
      code: 'NOT_IMPLEMENTED',
      message: 'Token refresh not yet implemented',
    },
  });
});

function getRolePermissions(role: string): string[] {
  const permissions: Record<string, string[]> = {
    admin: ['view_roster', 'edit_rubric', 'review_ai', 'override_scores', 'manage_users', 'view_audit'],
    principal: ['view_roster', 'edit_rubric', 'review_ai', 'override_scores', 'view_audit'],
    department_head: ['view_roster', 'review_ai', 'view_audit'],
    observer: ['view_roster', 'add_observation'],
    teacher: ['view_own_dashboard'],
  };
  return permissions[role] || [];
}

export default router;
