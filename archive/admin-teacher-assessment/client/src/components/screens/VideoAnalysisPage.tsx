import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Play,
  Clock,
  Star,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  ThumbsUp,
  ThumbsDown,
  AlertTriangle,
  CheckCircle,
  Plus,
  Send,
  Pin,
  MoreHorizontal,
  Trash2,
  Edit2,
  X,
} from 'lucide-react';
import { Card, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ColorChip } from '@/components/ui/ColorChip';
import { useVideoStore } from '@/store/videoStore';
import { useNotesStore } from '@/store/notesStore';
import { useFeedbackStore } from '@/store/feedbackStore';
import { useAuthStore } from '@/store/authStore';
import type {
  VideoAnalysis,
  DomainSummary,
  ObservationNote,
  NoteType,
  AgreementLevel,
} from '@/types';
import { format } from 'date-fns';

const NOTE_TYPE_LABELS: Record<NoteType, { label: string; color: string }> = {
  general: { label: 'General', color: 'bg-gray-100 text-gray-700' },
  observation: { label: 'Observation', color: 'bg-blue-100 text-blue-700' },
  question: { label: 'Question', color: 'bg-purple-100 text-purple-700' },
  action_item: { label: 'Action Item', color: 'bg-orange-100 text-orange-700' },
  follow_up: { label: 'Follow Up', color: 'bg-yellow-100 text-yellow-700' },
};

const AGREEMENT_OPTIONS: { value: AgreementLevel; label: string; icon: React.ReactNode }[] = [
  { value: 'strongly_agree', label: 'Strongly Agree', icon: <ThumbsUp className="w-4 h-4 text-green-600" /> },
  { value: 'agree', label: 'Agree', icon: <ThumbsUp className="w-4 h-4 text-green-400" /> },
  { value: 'neutral', label: 'Neutral', icon: <span className="w-4 h-4 text-gray-400">—</span> },
  { value: 'disagree', label: 'Disagree', icon: <ThumbsDown className="w-4 h-4 text-red-400" /> },
  { value: 'strongly_disagree', label: 'Strongly Disagree', icon: <ThumbsDown className="w-4 h-4 text-red-600" /> },
];

export const VideoAnalysisPage: React.FC = () => {
  const { videoId } = useParams<{ videoId: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  // Video store
  const { currentAnalysis, isLoading, error, fetchAnalysis, clearAnalysis } = useVideoStore();

  // Notes store
  const {
    notes,
    noteCounts,
    createNote,
    deleteNote,
    togglePin,
    fetchNotes,
    fetchNoteCounts,
  } = useNotesStore();

  // Feedback store
  const {
    currentFeedback,
    isSubmitting,
    submitFeedback,
    fetchFeedbackForObservation,
  } = useFeedbackStore();

  // Local state
  const [expandedDomains, setExpandedDomains] = useState<string[]>([]);
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [newNoteContent, setNewNoteContent] = useState('');
  const [newNoteType, setNewNoteType] = useState<NoteType>('general');
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);
  const [feedbackRating, setFeedbackRating] = useState<number>(0);
  const [feedbackAgreement, setFeedbackAgreement] = useState<AgreementLevel | null>(null);
  const [feedbackText, setFeedbackText] = useState('');

  useEffect(() => {
    if (videoId) {
      fetchAnalysis(videoId);
    }
    return () => clearAnalysis();
  }, [videoId]);

  useEffect(() => {
    if (currentAnalysis?.notes?.items) {
      // Notes are already included in the analysis response
    }
  }, [currentAnalysis]);

  const toggleDomain = (domainName: string) => {
    setExpandedDomains((prev) =>
      prev.includes(domainName)
        ? prev.filter((d) => d !== domainName)
        : [...prev, domainName]
    );
  };

  const handleCreateNote = async () => {
    if (!newNoteContent.trim() || !currentAnalysis) return;

    try {
      // Use the first observation ID for now
      const observationId = 'placeholder'; // Would come from actual observation
      await createNote({
        observationId,
        videoId,
        content: newNoteContent,
        noteType: newNoteType,
      });
      setNewNoteContent('');
      setShowNoteForm(false);
    } catch (err) {
      console.error('Failed to create note:', err);
    }
  };

  const handleSubmitFeedback = async () => {
    if (!currentAnalysis || (!feedbackRating && !feedbackAgreement && !feedbackText)) return;

    try {
      const observationId = 'placeholder'; // Would come from actual observation
      await submitFeedback({
        observationId,
        videoId,
        accuracyRating: feedbackRating || undefined,
        overallAgreement: feedbackAgreement || undefined,
        feedbackText: feedbackText || undefined,
      });
      setShowFeedbackForm(false);
      setFeedbackRating(0);
      setFeedbackAgreement(null);
      setFeedbackText('');
    } catch (err) {
      console.error('Failed to submit feedback:', err);
    }
  };

  const getScoreColor = (score: number): string => {
    if (score >= 75) return 'text-green-600';
    if (score >= 50) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getPerformanceColor = (level: string): 'green' | 'yellow' | 'red' => {
    if (level === 'Distinguished' || level === 'Proficient') return 'green';
    if (level === 'Basic') return 'yellow';
    return 'red';
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto" />
          <p className="mt-4 text-gray-600">Loading analysis...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Unable to load analysis</h2>
        <p className="text-gray-600 mb-4">{error}</p>
        <Button onClick={() => navigate(-1)}>Go Back</Button>
      </div>
    );
  }

  if (!currentAnalysis) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">No analysis data available</p>
        <Button onClick={() => navigate(-1)} className="mt-4">Go Back</Button>
      </div>
    );
  }

  const { video, analysis, processing, notes: analysisNotes, feedback } = currentAnalysis;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate(-1)}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          aria-label="Go back"
        >
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div className="flex-1">
          <h1 className="font-heading text-2xl font-bold text-gray-900">
            Video Analysis: {video.teacher_name}
          </h1>
          <p className="text-gray-600">
            {video.subjects?.join(', ')} • {Math.round(video.duration_seconds / 60)} minutes
          </p>
        </div>
        <ColorChip color={getPerformanceColor(analysis.overall_rating.performance_level)} size="lg" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content - Analysis */}
        <div className="lg:col-span-2 space-y-6">
          {/* Executive Summary */}
          <Card>
            <CardTitle>Executive Summary</CardTitle>
            <p className="mt-4 text-gray-700 leading-relaxed">
              {analysis.executive_summary || 'No summary available.'}
            </p>
          </Card>

          {/* Overall Rating */}
          <Card>
            <CardTitle>Overall Rating</CardTitle>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="text-center p-4 bg-gray-50 rounded-lg">
                <p className={`text-3xl font-bold ${getScoreColor(analysis.overall_rating.score)}`}>
                  {analysis.overall_rating.score}%
                </p>
                <p className="text-sm text-gray-500 mt-1">Overall Score</p>
              </div>
              <div className="text-center p-4 bg-gray-50 rounded-lg">
                <p className="text-3xl font-bold text-gray-900">
                  {analysis.overall_rating.score_4_scale}/4
                </p>
                <p className="text-sm text-gray-500 mt-1">4-Point Scale</p>
              </div>
              <div className="text-center p-4 bg-gray-50 rounded-lg">
                <p className="text-xl font-bold text-gray-900">
                  {analysis.overall_rating.performance_level}
                </p>
                <p className="text-sm text-gray-500 mt-1">Performance Level</p>
              </div>
              <div className="text-center p-4 bg-gray-50 rounded-lg">
                <p className="text-3xl font-bold text-gray-900">
                  {Math.round(analysis.overall_rating.confidence * 100)}%
                </p>
                <p className="text-sm text-gray-500 mt-1">AI Confidence</p>
              </div>
            </div>
            {analysis.overall_rating.justification && (
              <p className="mt-4 text-sm text-gray-600 italic">
                "{analysis.overall_rating.justification}"
              </p>
            )}
          </Card>

          {/* Domain Analysis */}
          <Card padding="none">
            <div className="p-4 border-b border-gray-200">
              <h2 className="font-heading font-semibold text-lg text-gray-900">
                Domain Analysis ({analysis.domain_summaries.length} domains)
              </h2>
            </div>

            <div className="divide-y divide-gray-100">
              {analysis.domain_summaries.map((domain) => (
                <div key={domain.domain_name}>
                  <button
                    onClick={() => toggleDomain(domain.domain_name)}
                    className="w-full flex items-center justify-between p-4 hover:bg-gray-50 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-gray-900">{domain.domain_name}</span>
                      <span className={`text-sm font-medium ${getScoreColor(domain.average_score)}`}>
                        {domain.average_score}%
                      </span>
                      <span className="text-xs text-gray-400">
                        ({domain.element_count} elements)
                      </span>
                    </div>
                    {expandedDomains.includes(domain.domain_name) ? (
                      <ChevronDown className="w-5 h-5 text-gray-500" />
                    ) : (
                      <ChevronRight className="w-5 h-5 text-gray-500" />
                    )}
                  </button>

                  {expandedDomains.includes(domain.domain_name) && (
                    <div className="px-4 pb-4 bg-gray-50">
                      {domain.summary && (
                        <p className="text-sm text-gray-600 mb-4">{domain.summary}</p>
                      )}

                      {/* Strengths & Growth Areas */}
                      <div className="grid grid-cols-2 gap-4 mb-4">
                        {domain.strengths.length > 0 && (
                          <div className="p-3 bg-green-50 rounded-lg">
                            <p className="text-xs font-medium text-green-800 mb-2">Strengths</p>
                            <ul className="text-xs text-green-700 space-y-1">
                              {domain.strengths.map((s, i) => (
                                <li key={i}>• {s}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {domain.growth_areas.length > 0 && (
                          <div className="p-3 bg-yellow-50 rounded-lg">
                            <p className="text-xs font-medium text-yellow-800 mb-2">Growth Areas</p>
                            <ul className="text-xs text-yellow-700 space-y-1">
                              {domain.growth_areas.map((g, i) => (
                                <li key={i}>• {g}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>

                      {/* Elements */}
                      <div className="space-y-2">
                        {domain.elements.map((elem) => (
                          <div
                            key={elem.id}
                            className="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-200"
                          >
                            <div className="flex-1">
                              <p className="text-sm font-medium text-gray-900">{elem.name}</p>
                              <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                                {elem.summary}
                              </p>
                            </div>
                            <div className="flex items-center gap-3 ml-4">
                              <span className={`text-lg font-bold ${getScoreColor(elem.score)}`}>
                                {elem.score}%
                              </span>
                              <span className="text-xs text-gray-400">
                                {Math.round(elem.confidence * 100)}% conf
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>

          {/* Recommendations */}
          {analysis.recommendations.length > 0 && (
            <Card>
              <CardTitle>Recommendations</CardTitle>
              <ul className="mt-4 space-y-3">
                {analysis.recommendations.map((rec, idx) => (
                  <li key={idx} className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-primary-600 flex-shrink-0 mt-0.5" />
                    <span className="text-gray-700">{rec}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        {/* Sidebar - Notes & Feedback */}
        <div className="space-y-6">
          {/* Quick Stats */}
          <Card>
            <CardTitle>Analysis Stats</CardTitle>
            <div className="mt-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Elements Analyzed</span>
                <span className="font-medium">{analysis.total_elements_analyzed}</span>
              </div>
              {processing && (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Frames Analyzed</span>
                    <span className="font-medium">{processing.frames_analyzed}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Processing Time</span>
                    <span className="font-medium">
                      {processing.processing_time_ms
                        ? `${(processing.processing_time_ms / 1000).toFixed(1)}s`
                        : 'N/A'}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Model</span>
                    <span className="font-medium">{processing.model}</span>
                  </div>
                </>
              )}
            </div>
          </Card>

          {/* Top Strengths & Growth Areas */}
          <Card>
            <CardTitle>Key Takeaways</CardTitle>
            <div className="mt-4 space-y-4">
              {analysis.top_strengths.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-green-700 mb-2">Top Strengths</p>
                  <ul className="space-y-1">
                    {analysis.top_strengths.map((s, i) => (
                      <li key={i} className="text-sm text-gray-700 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {analysis.top_growth_areas.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-yellow-700 mb-2">Areas for Growth</p>
                  <ul className="space-y-1">
                    {analysis.top_growth_areas.map((g, i) => (
                      <li key={i} className="text-sm text-gray-700 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 bg-yellow-500 rounded-full" />
                        {g}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Card>

          {/* Notes Section */}
          <Card>
            <div className="flex items-center justify-between">
              <CardTitle>
                Notes ({analysisNotes?.total || 0})
              </CardTitle>
              <Button
                size="sm"
                variant="ghost"
                leftIcon={<Plus className="w-4 h-4" />}
                onClick={() => setShowNoteForm(true)}
              >
                Add
              </Button>
            </div>

            {/* Note Type Counts */}
            {analysisNotes?.counts && (
              <div className="mt-3 flex flex-wrap gap-2">
                {Object.entries(analysisNotes.counts).map(([type, count]) => (
                  count > 0 && (
                    <span
                      key={type}
                      className={`text-xs px-2 py-1 rounded-full ${NOTE_TYPE_LABELS[type as NoteType].color}`}
                    >
                      {NOTE_TYPE_LABELS[type as NoteType].label}: {count}
                    </span>
                  )
                ))}
              </div>
            )}

            {/* Add Note Form */}
            {showNoteForm && (
              <div className="mt-4 p-3 border border-gray-200 rounded-lg">
                <select
                  value={newNoteType}
                  onChange={(e) => setNewNoteType(e.target.value as NoteType)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-2"
                >
                  {Object.entries(NOTE_TYPE_LABELS).map(([type, { label }]) => (
                    <option key={type} value={type}>{label}</option>
                  ))}
                </select>
                <textarea
                  value={newNoteContent}
                  onChange={(e) => setNewNoteContent(e.target.value)}
                  placeholder="Write your note..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none"
                  rows={3}
                />
                <div className="flex justify-end gap-2 mt-2">
                  <Button size="sm" variant="ghost" onClick={() => setShowNoteForm(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleCreateNote} disabled={!newNoteContent.trim()}>
                    Save
                  </Button>
                </div>
              </div>
            )}

            {/* Notes List */}
            <div className="mt-4 space-y-3 max-h-64 overflow-y-auto">
              {analysisNotes?.items?.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">
                  No notes yet. Add one above!
                </p>
              ) : (
                analysisNotes?.items?.map((note) => (
                  <div
                    key={note.id}
                    className={`p-3 rounded-lg border ${
                      note.isPinned ? 'border-primary-300 bg-primary-50' : 'border-gray-200'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${NOTE_TYPE_LABELS[note.noteType].color}`}>
                        {NOTE_TYPE_LABELS[note.noteType].label}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => togglePin(note.id)}
                          className={`p-1 rounded ${note.isPinned ? 'text-primary-600' : 'text-gray-400'}`}
                        >
                          <Pin className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => deleteNote(note.id)}
                          className="p-1 rounded text-gray-400 hover:text-red-600"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <p className="text-sm text-gray-700">{note.content}</p>
                    <p className="text-xs text-gray-400 mt-2">
                      {note.userName} • {format(new Date(note.createdAt), 'MMM d, h:mm a')}
                    </p>
                  </div>
                ))
              )}
            </div>
          </Card>

          {/* Feedback Section */}
          <Card>
            <div className="flex items-center justify-between">
              <CardTitle>AI Feedback</CardTitle>
              {!feedback?.has_user_feedback && !showFeedbackForm && (
                <Button
                  size="sm"
                  variant="ghost"
                  leftIcon={<MessageSquare className="w-4 h-4" />}
                  onClick={() => setShowFeedbackForm(true)}
                >
                  Rate
                </Button>
              )}
            </div>

            {feedback?.has_user_feedback ? (
              <div className="mt-4 p-3 bg-green-50 rounded-lg">
                <div className="flex items-center gap-2 text-green-700">
                  <CheckCircle className="w-5 h-5" />
                  <span className="text-sm font-medium">Feedback submitted</span>
                </div>
                <p className="text-xs text-green-600 mt-1">
                  Thank you for helping improve our AI!
                </p>
              </div>
            ) : showFeedbackForm ? (
              <div className="mt-4 space-y-4">
                {/* Accuracy Rating */}
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-2">
                    How accurate was this assessment?
                  </p>
                  <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map((rating) => (
                      <button
                        key={rating}
                        onClick={() => setFeedbackRating(rating)}
                        className={`w-10 h-10 rounded-lg border transition-colors ${
                          feedbackRating >= rating
                            ? 'bg-primary-100 border-primary-500 text-primary-700'
                            : 'border-gray-300 text-gray-400'
                        }`}
                      >
                        <Star className={`w-5 h-5 mx-auto ${feedbackRating >= rating ? 'fill-current' : ''}`} />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Agreement Level */}
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-2">
                    Do you agree with the overall rating?
                  </p>
                  <div className="grid grid-cols-5 gap-1">
                    {AGREEMENT_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setFeedbackAgreement(opt.value)}
                        className={`p-2 rounded-lg border text-center transition-colors ${
                          feedbackAgreement === opt.value
                            ? 'bg-primary-100 border-primary-500'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                        title={opt.label}
                      >
                        {opt.icon}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Feedback Text */}
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-2">
                    Additional feedback (optional)
                  </p>
                  <textarea
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    placeholder="What did the AI get right or wrong?"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none"
                    rows={3}
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setShowFeedbackForm(false)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSubmitFeedback}
                    isLoading={isSubmitting}
                    disabled={!feedbackRating && !feedbackAgreement && !feedbackText}
                  >
                    Submit Feedback
                  </Button>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-gray-500">
                Help improve our AI by rating this assessment.
              </p>
            )}

            {/* Previous Feedback */}
            {feedback?.items && feedback.items.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <p className="text-xs font-medium text-gray-500 mb-2">
                  {feedback.total} feedback submission{feedback.total !== 1 && 's'}
                </p>
                {feedback.items.slice(0, 2).map((fb) => (
                  <div key={fb.id} className="text-xs text-gray-600 mb-2">
                    <span className="font-medium">{fb.userName}</span>
                    {fb.accuracyRating && ` • ${fb.accuracyRating}/5 stars`}
                    {fb.overallAgreement && ` • ${fb.overallAgreement.replace('_', ' ')}`}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};

export default VideoAnalysisPage;
