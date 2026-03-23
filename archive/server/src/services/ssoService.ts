/**
 * SSO Service
 *
 * Handles user authentication and account management for SSO providers.
 * Implements security logic to prevent account takeover and conflicts.
 */

import { db } from '../utils/db';
import { v4 as uuidv4 } from 'uuid';
import { logAudit } from './auditService';

/**
 * SSO Profile from OAuth provider
 */
export interface SSOProfile {
  provider: 'google' | 'microsoft';
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  firstName?: string;
  lastName?: string;
  picture?: string;
}

/**
 * User record from database
 */
export interface User {
  id: string;
  email: string;
  name: string;
  roles: string[];
  active_role: string;
  school_id?: string;
  sso_provider?: string;
  sso_id?: string;
  avatar_url?: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Result of find or create operation
 */
export interface FindOrCreateResult {
  success: boolean;
  user?: User;
  created?: boolean;
  error?: string;
}

/**
 * SSO Service for managing OAuth users
 */
class SSOService {
  /**
   * Find an existing user or create a new one from SSO profile
   */
  async findOrCreateUser(profile: SSOProfile): Promise<FindOrCreateResult> {
    try {
      // Check if email is verified (required for security)
      if (!profile.emailVerified && profile.provider === 'google') {
        return {
          success: false,
          error: 'Email not verified. Please verify your email with Google first.',
        };
      }

      // Check if user exists with this SSO provider
      const existingSSO = await db('users')
        .where('sso_provider', profile.provider)
        .where('sso_id', profile.id)
        .first();

      if (existingSSO) {
        // User exists with this SSO - update and return
        await db('users')
          .where('id', existingSSO.id)
          .update({
            name: profile.name || existingSSO.name,
            avatar_url: profile.picture || existingSSO.avatar_url,
            updated_at: new Date(),
          });

        await logAudit({
          userId: existingSSO.id,
          action: 'sso_login',
          targetType: 'user',
          targetId: existingSSO.id,
          details: { provider: profile.provider },
        });

        return {
          success: true,
          user: await this.getUserById(existingSSO.id),
          created: false,
        };
      }

      // Check if user exists with this email
      const existingEmail = await db('users')
        .where('email', profile.email.toLowerCase())
        .first();

      if (existingEmail) {
        // User exists with this email
        if (existingEmail.password_hash) {
          // Has password - cannot link SSO (security: prevent account takeover)
          return {
            success: false,
            error: 'An account with this email already exists. Please login with your password.',
          };
        }

        if (existingEmail.sso_provider && existingEmail.sso_provider !== profile.provider) {
          // Has different SSO provider - cannot link (prevent conflicts)
          return {
            success: false,
            error: `This email is already linked to ${existingEmail.sso_provider}. Please use that provider to sign in.`,
          };
        }

        // No password and no conflicting SSO - link this SSO
        await db('users')
          .where('id', existingEmail.id)
          .update({
            sso_provider: profile.provider,
            sso_id: profile.id,
            name: profile.name || existingEmail.name,
            avatar_url: profile.picture || existingEmail.avatar_url,
            updated_at: new Date(),
          });

        await logAudit({
          userId: existingEmail.id,
          action: 'sso_linked',
          targetType: 'user',
          targetId: existingEmail.id,
          details: { provider: profile.provider },
        });

        return {
          success: true,
          user: await this.getUserById(existingEmail.id),
          created: false,
        };
      }

      // No existing user - create new one
      const userId = uuidv4();

      // Determine default role based on email domain (simple heuristic)
      // In production, you'd want more sophisticated role assignment
      let defaultRole = 'teacher';
      if (profile.email.includes('admin')) {
        defaultRole = 'admin';
      } else if (profile.email.includes('principal')) {
        defaultRole = 'principal';
      }

      await db('users').insert({
        id: userId,
        email: profile.email.toLowerCase(),
        name: profile.name,
        roles: [defaultRole],
        active_role: defaultRole,
        sso_provider: profile.provider,
        sso_id: profile.id,
        avatar_url: profile.picture,
        password_hash: null, // No password for SSO users
      });

      await logAudit({
        userId,
        action: 'sso_signup',
        targetType: 'user',
        targetId: userId,
        details: { provider: profile.provider, email: profile.email },
      });

      return {
        success: true,
        user: await this.getUserById(userId),
        created: true,
      };
    } catch (error) {
      console.error('SSO findOrCreateUser error:', error);
      return {
        success: false,
        error: 'An error occurred during authentication',
      };
    }
  }

  /**
   * Link SSO to an existing authenticated user
   */
  async linkSSO(userId: string, profile: SSOProfile): Promise<{ success: boolean; error?: string }> {
    try {
      const user = await db('users').where('id', userId).first();

      if (!user) {
        return { success: false, error: 'User not found' };
      }

      // Check if this SSO is already linked to another account
      const existingSSO = await db('users')
        .where('sso_provider', profile.provider)
        .where('sso_id', profile.id)
        .whereNot('id', userId)
        .first();

      if (existingSSO) {
        return {
          success: false,
          error: `This ${profile.provider} account is already linked to another user`,
        };
      }

      // Check if user already has a different SSO linked
      if (user.sso_provider && user.sso_provider !== profile.provider) {
        return {
          success: false,
          error: `Your account is already linked to ${user.sso_provider}`,
        };
      }

      // Link SSO
      await db('users').where('id', userId).update({
        sso_provider: profile.provider,
        sso_id: profile.id,
        avatar_url: profile.picture || user.avatar_url,
        updated_at: new Date(),
      });

      await logAudit({
        userId,
        action: 'sso_linked',
        targetType: 'user',
        targetId: userId,
        details: { provider: profile.provider },
      });

      return { success: true };
    } catch (error) {
      console.error('SSO linkSSO error:', error);
      return { success: false, error: 'An error occurred while linking account' };
    }
  }

  /**
   * Unlink SSO from a user (requires password to be set first)
   */
  async unlinkSSO(userId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const user = await db('users').where('id', userId).first();

      if (!user) {
        return { success: false, error: 'User not found' };
      }

      if (!user.password_hash) {
        return {
          success: false,
          error: 'Please set a password before unlinking SSO',
        };
      }

      await db('users').where('id', userId).update({
        sso_provider: null,
        sso_id: null,
        updated_at: new Date(),
      });

      await logAudit({
        userId,
        action: 'sso_unlinked',
        targetType: 'user',
        targetId: userId,
        details: { previousProvider: user.sso_provider },
      });

      return { success: true };
    } catch (error) {
      console.error('SSO unlinkSSO error:', error);
      return { success: false, error: 'An error occurred while unlinking account' };
    }
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string): Promise<User | null> {
    const user = await db('users').where('id', userId).first();

    if (!user) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      roles: user.roles,
      active_role: user.active_role,
      school_id: user.school_id,
      sso_provider: user.sso_provider,
      sso_id: user.sso_id,
      avatar_url: user.avatar_url,
      created_at: user.created_at,
      updated_at: user.updated_at,
    };
  }

  /**
   * Get user by email
   */
  async getUserByEmail(email: string): Promise<User | null> {
    const user = await db('users')
      .where('email', email.toLowerCase())
      .first();

    if (!user) {
      return null;
    }

    return this.getUserById(user.id);
  }
}

// Export singleton instance
export const ssoService = new SSOService();
