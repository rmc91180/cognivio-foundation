/**
 * Passport Configuration for SSO Authentication
 *
 * Configures Google and Microsoft OAuth 2.0 strategies for single sign-on.
 */

import passport from 'passport';
import { Strategy as GoogleStrategy, Profile as GoogleProfile } from 'passport-google-oauth20';
import { Strategy as MicrosoftStrategy } from 'passport-microsoft';
import { ssoService, SSOProfile } from '../services/ssoService';

/**
 * Initialize Passport with OAuth strategies
 */
export function configurePassport(): void {
  // Google OAuth 2.0 Strategy
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:8000/api/auth/google/callback',
          scope: ['profile', 'email'],
        },
        async (accessToken, refreshToken, profile, done) => {
          try {
            const ssoProfile: SSOProfile = {
              provider: 'google',
              id: profile.id,
              email: profile.emails?.[0]?.value || '',
              emailVerified: profile.emails?.[0]?.verified || false,
              name: profile.displayName || '',
              firstName: profile.name?.givenName,
              lastName: profile.name?.familyName,
              picture: profile.photos?.[0]?.value,
            };

            // Validate email
            if (!ssoProfile.email) {
              return done(new Error('No email provided by Google'));
            }

            // Find or create user
            const result = await ssoService.findOrCreateUser(ssoProfile);

            if (!result.success) {
              return done(new Error(result.error));
            }

            return done(null, result.user as any);
          } catch (error) {
            return done(error as Error);
          }
        }
      )
    );
    console.log('✓ Google OAuth strategy configured');
  } else {
    console.warn('⚠ Google OAuth not configured - missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET');
  }

  // Microsoft OAuth 2.0 Strategy
  if (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) {
    passport.use(
      new MicrosoftStrategy(
        {
          clientID: process.env.MICROSOFT_CLIENT_ID,
          clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
          callbackURL: process.env.MICROSOFT_CALLBACK_URL || 'http://localhost:8000/api/auth/microsoft/callback',
          scope: ['user.read'],
          tenant: process.env.MICROSOFT_TENANT || 'common',
        },
        async (accessToken: string, refreshToken: string, profile: any, done: any) => {
          try {
            const ssoProfile: SSOProfile = {
              provider: 'microsoft',
              id: profile.id,
              email: profile.emails?.[0]?.value || profile._json?.mail || profile._json?.userPrincipalName || '',
              emailVerified: true, // Microsoft accounts are verified
              name: profile.displayName || '',
              firstName: profile.name?.givenName || profile._json?.givenName,
              lastName: profile.name?.familyName || profile._json?.surname,
              picture: undefined, // Microsoft doesn't provide photo in basic scope
            };

            // Validate email
            if (!ssoProfile.email) {
              return done(new Error('No email provided by Microsoft'));
            }

            // Find or create user
            const result = await ssoService.findOrCreateUser(ssoProfile);

            if (!result.success) {
              return done(new Error(result.error));
            }

            return done(null, result.user as any);
          } catch (error) {
            return done(error as Error);
          }
        }
      )
    );
    console.log('✓ Microsoft OAuth strategy configured');
  } else {
    console.warn('⚠ Microsoft OAuth not configured - missing MICROSOFT_CLIENT_ID or MICROSOFT_CLIENT_SECRET');
  }

  // Serialize user to session
  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  // Deserialize user from session
  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await ssoService.getUserById(id);
      done(null, user as any);
    } catch (error) {
      done(error);
    }
  });
}

export default passport;
