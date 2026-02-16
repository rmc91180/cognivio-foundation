/**
 * SSO Callback Page
 *
 * Handles OAuth redirect from backend and stores authentication token.
 * Redirects user to dashboard on success or login page on error.
 */

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';

export function SSOCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(true);

  useEffect(() => {
    const processCallback = async () => {
      try {
        // Check for error in URL
        const errorParam = searchParams.get('error');
        if (errorParam) {
          setError(getErrorMessage(errorParam));
          setProcessing(false);
          return;
        }

        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        // Prefer hash params to avoid leaking tokens in query strings.
        const token = hashParams.get('token') || searchParams.get('token');
        const refreshToken = hashParams.get('refreshToken') || searchParams.get('refreshToken');
        const userId = hashParams.get('userId') || searchParams.get('userId');
        const email = hashParams.get('email') || searchParams.get('email');
        const name = hashParams.get('name') || searchParams.get('name');
        const activeRole = hashParams.get('activeRole') || searchParams.get('activeRole');

        if (!token || !userId) {
          setError('Authentication failed. No token received.');
          setProcessing(false);
          return;
        }

        // Store authentication in Zustand store
        setAuth({
          token,
          refreshToken: refreshToken || undefined,
          user: {
            id: userId,
            email: email || '',
            name: name || '',
            roles: [activeRole || 'teacher'],
            activeRole: activeRole || 'teacher',
          },
        });

        // Also store in localStorage for persistence (must match key used by api.ts interceptor)
        localStorage.setItem('auth_token', token);
        if (refreshToken) {
          localStorage.setItem('refreshToken', refreshToken);
        }

        // Redirect to dashboard
        navigate('/dashboard', { replace: true });
      } catch (err) {
        console.error('SSO callback error:', err);
        setError('An error occurred during authentication.');
        setProcessing(false);
      }
    };

    processCallback();
  }, [searchParams, setAuth, navigate]);

  // Helper function to convert error codes to user-friendly messages
  function getErrorMessage(errorCode: string): string {
    const errorMessages: Record<string, string> = {
      google_auth_failed: 'Google authentication failed. Please try again.',
      microsoft_auth_failed: 'Microsoft authentication failed. Please try again.',
      no_user: 'Could not retrieve user information. Please try again.',
      callback_failed: 'Authentication callback failed. Please try again.',
      email_not_verified: 'Please verify your email before signing in.',
      account_exists: 'An account with this email already exists. Please use your password to sign in.',
      sso_conflict: 'This email is already linked to a different sign-in method.',
    };
    return errorMessages[errorCode] || 'Authentication failed. Please try again.';
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full text-center">
          <div className="text-red-500 mb-4">
            <svg
              className="w-16 h-16 mx-auto"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-slate-800 mb-2">
            Authentication Failed
          </h1>
          <p className="text-slate-600 mb-6">{error}</p>
          <button
            onClick={() => navigate('/login', { replace: true })}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full text-center">
        <div className="mb-4">
          <svg
            className="animate-spin w-12 h-12 mx-auto text-indigo-600"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-slate-800 mb-2">
          Completing Sign In...
        </h1>
        <p className="text-slate-600">Please wait while we complete your authentication.</p>
      </div>
    </div>
  );
}

export default SSOCallback;
