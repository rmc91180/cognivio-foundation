import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthPayload, UserRole } from '../types';

const JWT_SECRET = (() => {
  const value = process.env.JWT_SECRET;
  if (!value) {
    throw new Error('JWT_SECRET environment variable is required. Refusing to start.');
  }
  return value;
})();

interface DecodedAuthToken extends jwt.JwtPayload {
  userId?: string;
  email?: string;
  roles?: UserRole[];
  activeRole?: UserRole;
  schoolId?: string | null;
  type?: 'access' | 'refresh' | string;
}

function isValidAccessPayload(decoded: DecodedAuthToken): decoded is DecodedAuthToken & AuthPayload {
  return (
    typeof decoded.userId === 'string' &&
    typeof decoded.email === 'string' &&
    Array.isArray(decoded.roles) &&
    decoded.roles.length > 0 &&
    typeof decoded.activeRole === 'string' &&
    decoded.type !== 'refresh'
  );
}

// Type declaration moved to src/types/express.d.ts

/**
 * Middleware to authenticate JWT token
 */
export function authenticateToken(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication token required',
      },
    });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as DecodedAuthToken;
    if (!isValidAccessPayload(decoded)) {
      res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Invalid token payload',
        },
      });
      return;
    }
    req.user = decoded;
    next();
  } catch (error) {
    res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Invalid or expired token',
      },
    });
  }
}

/**
 * Middleware to require specific roles
 */
export function requireRoles(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
      return;
    }

    const hasRole = roles.some((role) => req.user!.roles.includes(role));
    if (!hasRole) {
      res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Insufficient permissions',
        },
      });
      return;
    }

    next();
  };
}

/**
 * Generate JWT token
 */
export function generateToken(payload: AuthPayload): string {
  const expiresIn = process.env.JWT_EXPIRES_IN || '24h';
  return jwt.sign({ ...payload, type: 'access' }, JWT_SECRET, { expiresIn } as jwt.SignOptions);
}

/**
 * Generate refresh token
 */
export function generateRefreshToken(userId: string): string {
  return jwt.sign({ userId, type: 'refresh' }, JWT_SECRET, { expiresIn: '7d' } as jwt.SignOptions);
}

