import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Upload,
  Video,
  Users,
  CheckCircle,
  AlertCircle,
  Clock,
  ArrowRight,
  Loader2,
  X,
} from 'lucide-react';
import { Card, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useVideoStore } from '@/store/videoStore';
import { rosterApi, rubricsApi } from '@/services/api';
import type { RosterRow, RubricTemplate } from '@/types';

export const VideoUploadPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedTeacherId = searchParams.get('teacherId');

  const { uploadVideo, checkStatus, isUploading, uploadProgress, error, clearError } = useVideoStore();

  // Form state
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>(preselectedTeacherId || '');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [classId, setClassId] = useState('');
  const [anonymize, setAnonymize] = useState(false);

  // Data
  const [teachers, setTeachers] = useState<RosterRow[]>([]);
  const [templates, setTemplates] = useState<RubricTemplate[]>([]);
  const [loadingTeachers, setLoadingTeachers] = useState(true);

  // Upload state
  const [uploadedVideoId, setUploadedVideoId] = useState<string | null>(null);
  const [processingStatus, setProcessingStatus] = useState<string | null>(null);
  const [pollingInterval, setPollingInterval] = useState<ReturnType<typeof setInterval> | null>(null);

  // Fetch teachers on mount
  useEffect(() => {
    const fetchData = async () => {
      setLoadingTeachers(true);
      try {
        const templateData = await rubricsApi.getTemplates();
        setTemplates(templateData);

        if (templateData.length > 0) {
          const rosterData = await rosterApi.getRoster({
            templateId: templateData[0].id,
            pageSize: 100,
          });
          setTeachers(rosterData.rows);
        }
      } catch (err) {
        console.error('Failed to fetch data:', err);
      } finally {
        setLoadingTeachers(false);
      }
    };
    fetchData();
  }, []);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    };
  }, [pollingInterval]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      const validTypes = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];
      if (!validTypes.includes(file.type)) {
        alert('Please select a valid video file (MP4, WebM, MOV, or AVI)');
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleUpload = async () => {
    if (!selectedTeacherId || !selectedFile) return;

    clearError();

    try {
      const videoId = await uploadVideo(
        selectedTeacherId,
        classId || undefined,
        selectedFile.name
      );

      setUploadedVideoId(videoId);
      setProcessingStatus('pending');

      // Start polling for status
      const interval = setInterval(async () => {
        try {
          const status = await checkStatus(videoId);
          setProcessingStatus(status.status);

          if (status.status === 'completed' || status.status === 'failed') {
            clearInterval(interval);
            setPollingInterval(null);
          }
        } catch (err) {
          console.error('Failed to check status:', err);
        }
      }, 3000);

      setPollingInterval(interval);
    } catch (err) {
      console.error('Upload failed:', err);
    }
  };

  const handleViewAnalysis = () => {
    if (uploadedVideoId) {
      navigate(`/video/${uploadedVideoId}/analysis`);
    }
  };

  const handleReset = () => {
    setSelectedFile(null);
    setUploadedVideoId(null);
    setProcessingStatus(null);
    setClassId('');
    setAnonymize(false);
    if (pollingInterval) {
      clearInterval(pollingInterval);
      setPollingInterval(null);
    }
  };

  const selectedTeacher = teachers.find((t) => t.teacherId === selectedTeacherId);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-heading text-2xl font-bold text-gray-900">Upload Video</h1>
        <p className="text-gray-600 mt-1">
          Upload a classroom video for AI analysis and assessment
        </p>
      </div>

      {/* Upload Status */}
      {uploadedVideoId && (
        <Card className={`border-2 ${
          processingStatus === 'completed' ? 'border-green-200 bg-green-50' :
          processingStatus === 'failed' ? 'border-red-200 bg-red-50' :
          'border-blue-200 bg-blue-50'
        }`}>
          <div className="flex items-center gap-4">
            {processingStatus === 'completed' ? (
              <CheckCircle className="w-10 h-10 text-green-600" />
            ) : processingStatus === 'failed' ? (
              <AlertCircle className="w-10 h-10 text-red-600" />
            ) : (
              <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
            )}

            <div className="flex-1">
              <h3 className={`font-semibold ${
                processingStatus === 'completed' ? 'text-green-800' :
                processingStatus === 'failed' ? 'text-red-800' :
                'text-blue-800'
              }`}>
                {processingStatus === 'completed' ? 'Analysis Complete!' :
                 processingStatus === 'failed' ? 'Processing Failed' :
                 processingStatus === 'processing' ? 'Analyzing Video...' :
                 'Upload Complete - Queued for Analysis'}
              </h3>
              <p className={`text-sm ${
                processingStatus === 'completed' ? 'text-green-600' :
                processingStatus === 'failed' ? 'text-red-600' :
                'text-blue-600'
              }`}>
                {processingStatus === 'completed'
                  ? 'Your video has been analyzed. Click below to view the results.'
                  : processingStatus === 'failed'
                  ? 'There was an error processing your video. Please try again.'
                  : processingStatus === 'processing'
                  ? 'AI is analyzing the video frames. This may take a few minutes.'
                  : 'Run `npm run worker` in the server directory to process the video.'}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {processingStatus === 'completed' && (
                <Button onClick={handleViewAnalysis} rightIcon={<ArrowRight className="w-4 h-4" />}>
                  View Analysis
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={handleReset}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Upload Form */}
      {!uploadedVideoId && (
        <>
          {/* Step 1: Select Teacher */}
          <Card>
            <CardTitle>
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-primary-600" />
                Step 1: Select Teacher
              </div>
            </CardTitle>

            <div className="mt-4">
              {loadingTeachers ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 text-primary-600 animate-spin" />
                </div>
              ) : (
                <select
                  value={selectedTeacherId}
                  onChange={(e) => setSelectedTeacherId(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">Select a teacher...</option>
                  {teachers.map((teacher) => (
                    <option key={teacher.teacherId} value={teacher.teacherId}>
                      {teacher.teacherName} - {teacher.subjects.join(', ')}
                    </option>
                  ))}
                </select>
              )}

              {selectedTeacher && (
                <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                  <p className="font-medium text-gray-900">{selectedTeacher.teacherName}</p>
                  <p className="text-sm text-gray-600">
                    {selectedTeacher.subjects.join(', ')} • Grades {selectedTeacher.grades.join(', ')}
                  </p>
                </div>
              )}
            </div>
          </Card>

          {/* Step 2: Upload Video */}
          <Card>
            <CardTitle>
              <div className="flex items-center gap-2">
                <Video className="w-5 h-5 text-primary-600" />
                Step 2: Select Video File
              </div>
            </CardTitle>

            <div className="mt-4">
              {!selectedFile ? (
                <label className="block">
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-primary-400 hover:bg-primary-50 transition-colors cursor-pointer">
                    <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-700 font-medium">
                      Click to upload or drag and drop
                    </p>
                    <p className="text-sm text-gray-500 mt-1">
                      MP4, WebM, MOV, or AVI (max 2GB)
                    </p>
                  </div>
                  <input
                    type="file"
                    accept="video/*"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </label>
              ) : (
                <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg">
                  <Video className="w-10 h-10 text-primary-600" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">{selectedFile.name}</p>
                    <p className="text-sm text-gray-500">
                      {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedFile(null)}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>
          </Card>

          {/* Step 3: Options */}
          <Card>
            <CardTitle>
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary-600" />
                Step 3: Options (Optional)
              </div>
            </CardTitle>

            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Class/Period (Optional)
                </label>
                <input
                  type="text"
                  value={classId}
                  onChange={(e) => setClassId(e.target.value)}
                  placeholder="e.g., Period 3 - Algebra II"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={anonymize}
                  onChange={(e) => setAnonymize(e.target.checked)}
                  className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                />
                <div>
                  <p className="text-sm font-medium text-gray-700">Anonymize video</p>
                  <p className="text-xs text-gray-500">
                    Blur student faces for privacy compliance
                  </p>
                </div>
              </label>
            </div>
          </Card>

          {/* Error Display */}
          {error && (
            <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {/* Upload Button */}
          <div className="flex justify-end">
            <Button
              onClick={handleUpload}
              disabled={!selectedTeacherId || !selectedFile || isUploading}
              isLoading={isUploading}
              leftIcon={<Upload className="w-4 h-4" />}
              className="px-8"
            >
              {isUploading ? `Uploading... ${uploadProgress}%` : 'Upload & Analyze'}
            </Button>
          </div>

          {/* Upload Progress */}
          {isUploading && (
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-primary-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          )}
        </>
      )}

      {/* Info Box */}
      <Card className="bg-blue-50 border-blue-200">
        <div className="flex gap-4">
          <div className="flex-shrink-0">
            <AlertCircle className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h3 className="font-medium text-blue-800">How AI Analysis Works</h3>
            <ul className="mt-2 text-sm text-blue-700 space-y-1">
              <li>• Video frames are extracted at key moments</li>
              <li>• GPT-4o vision model analyzes teaching practices</li>
              <li>• Scores are generated against your selected rubric</li>
              <li>• Detailed feedback and recommendations are provided</li>
              <li>• Processing typically takes 2-5 minutes per video</li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default VideoUploadPage;
