import React, { useEffect, useState } from 'react';
import { FileUp, Trash2, User, BookOpen, Lock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Card, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/store/authStore';
import type { CurriculumDocument } from '@/utils/curriculum';
import { curriculumStorage } from '@/utils/curriculum';

const formatSize = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

export const ProfilePage: React.FC = () => {
  const { user } = useAuthStore();
  const isTeacher = user?.activeRole === 'teacher';
  const userId = user?.id || '';

  const [documents, setDocuments] = useState<CurriculumDocument[]>([]);

  useEffect(() => {
    if (!userId) return;
    setDocuments(curriculumStorage.getTeacherDocuments(userId));
  }, [userId]);

  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (!userId || files.length === 0) return;

    let updated = curriculumStorage.getTeacherDocuments(userId);
    files.forEach((file) => {
      updated = curriculumStorage.addTeacherDocument(userId, file);
    });
    setDocuments(updated);
    event.target.value = '';
  };

  const handleRemove = (documentId: string) => {
    if (!userId) return;
    setDocuments(curriculumStorage.removeTeacherDocument(userId, documentId));
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-gray-900">My Profile</h1>
        <p className="text-gray-600 mt-1">
          Personal account details and curriculum resources.
        </p>
      </div>

      <Card>
        <CardTitle>
          <div className="inline-flex items-center gap-2">
            <User className="w-5 h-5 text-primary-600" />
            Account
          </div>
        </CardTitle>
        <div className="mt-4 space-y-2">
          <p className="text-sm text-gray-600">
            <span className="font-medium text-gray-900">Name:</span> {user?.name || 'Unknown'}
          </p>
          <p className="text-sm text-gray-600">
            <span className="font-medium text-gray-900">Email:</span> {user?.email || 'Unknown'}
          </p>
          <p className="text-sm text-gray-600 capitalize">
            <span className="font-medium text-gray-900">Role:</span>{' '}
            {user?.activeRole || 'unknown'}
          </p>
        </div>
      </Card>

      <Card>
        <CardTitle>
          <div className="inline-flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary-600" />
            {isTeacher ? 'My Class Curriculum' : 'Personal Curriculum Library'}
          </div>
        </CardTitle>
        <p className="text-sm text-gray-600 mt-1">
          {isTeacher
            ? 'Upload class-level curriculum files for your own instructional pages.'
            : 'You can upload curriculum references for personal use.'}
        </p>

        {!userId ? (
          <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-700">
            Sign in again to manage uploads.
          </div>
        ) : (
          <>
            <div className="mt-4">
              <label className="inline-flex">
                <input
                  type="file"
                  className="hidden"
                  multiple
                  accept=".pdf,.doc,.docx,.ppt,.pptx,.txt"
                  onChange={handleUpload}
                />
                <span className="inline-flex items-center px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 cursor-pointer">
                  <FileUp className="w-4 h-4 mr-2" />
                  Upload Curriculum Files
                </span>
              </label>
            </div>

            {documents.length === 0 ? (
              <p className="text-sm text-gray-500 mt-4">No curriculum files uploaded yet.</p>
            ) : (
              <div className="mt-4 space-y-2">
                {documents.map((document) => (
                  <div
                    key={document.id}
                    className="flex items-center justify-between gap-3 p-3 border border-gray-200 rounded-lg"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{document.name}</p>
                      <p className="text-xs text-gray-500">
                        {formatSize(document.sizeBytes)} • Uploaded{' '}
                        {formatDistanceToNow(new Date(document.uploadedAt), { addSuffix: true })}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemove(document.id)}
                      leftIcon={<Trash2 className="w-4 h-4" />}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Card>

      <Card className="bg-gray-50">
        <div className="flex gap-3">
          <Lock className="w-4 h-4 text-gray-500 mt-1" />
          <p className="text-sm text-gray-600">
            Curriculum uploads are scoped to your account in this environment. School-wide
            curriculum and recording policy remain managed in School Setup by administrators.
          </p>
        </div>
      </Card>
    </div>
  );
};

export default ProfilePage;
