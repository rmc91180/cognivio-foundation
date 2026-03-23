import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Home, ArrowLeft, Search, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export const NotFoundPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        {/* 404 Illustration */}
        <div className="mb-8">
          <div className="inline-flex items-center justify-center w-32 h-32 bg-primary-100 rounded-full mb-6">
            <span className="text-6xl font-bold text-primary-600">404</span>
          </div>
          <h1 className="font-heading text-2xl font-bold text-gray-900 mb-2">
            Page Not Found
          </h1>
          <p className="text-gray-600">
            Sorry, we couldn't find the page you're looking for. The page may have been moved,
            deleted, or never existed.
          </p>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          <Button
            onClick={() => navigate('/dashboard')}
            className="w-full"
            leftIcon={<Home className="w-4 h-4" />}
          >
            Go to Dashboard
          </Button>

          <Button
            variant="secondary"
            onClick={() => navigate(-1)}
            className="w-full"
            leftIcon={<ArrowLeft className="w-4 h-4" />}
          >
            Go Back
          </Button>
        </div>

        {/* Helpful Links */}
        <div className="mt-8 pt-6 border-t border-gray-200">
          <p className="text-sm text-gray-500 mb-4">Maybe you were looking for:</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => navigate('/roster')}
              className="flex items-center justify-center gap-2 p-3 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-sm text-gray-700"
            >
              <Search className="w-4 h-4 text-gray-400" />
              Teacher Roster
            </button>
            <button
              onClick={() => navigate('/frameworks')}
              className="flex items-center justify-center gap-2 p-3 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-sm text-gray-700"
            >
              <Search className="w-4 h-4 text-gray-400" />
              Frameworks
            </button>
            <button
              onClick={() => navigate('/video/upload')}
              className="flex items-center justify-center gap-2 p-3 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-sm text-gray-700"
            >
              <Search className="w-4 h-4 text-gray-400" />
              Upload Video
            </button>
            <button
              onClick={() => navigate('/settings')}
              className="flex items-center justify-center gap-2 p-3 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-sm text-gray-700"
            >
              <Search className="w-4 h-4 text-gray-400" />
              Settings
            </button>
          </div>
        </div>

        {/* Help */}
        <div className="mt-6">
          <a
            href="mailto:support@cognivio.com"
            className="inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700"
          >
            <HelpCircle className="w-4 h-4" />
            Need help? Contact support
          </a>
        </div>
      </div>
    </div>
  );
};

export default NotFoundPage;
