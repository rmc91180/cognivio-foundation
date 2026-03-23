import React, { useState } from 'react';
import {
  Star,
  MessageSquare,
  AlertTriangle,
  Lightbulb,
  Check,
  X,
  Edit3,
  ChevronDown,
  ChevronUp,
  Send,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useFeedbackStore } from '@/store/feedbackStore';
import type {
  AIObservation,
  AgreementLevel,
  FeedbackCategory,
  CreateFeedbackInput,
  CreateCorrectionInput,
  DisagreementType,
  UserConfidence,
} from '@/types';

interface AIFeedbackFormProps {
  observation: AIObservation;
  onClose?: () => void;
  onSubmitSuccess?: () => void;
  compact?: boolean;
}

const AGREEMENT_OPTIONS: { value: AgreementLevel; label: string; color: string }[] = [
  { value: 'strongly_agree', label: 'Strongly Agree', color: 'text-green-600' },
  { value: 'agree', label: 'Agree', color: 'text-green-500' },
  { value: 'neutral', label: 'Neutral', color: 'text-gray-500' },
  { value: 'disagree', label: 'Disagree', color: 'text-orange-500' },
  { value: 'strongly_disagree', label: 'Strongly Disagree', color: 'text-red-600' },
];

const FEEDBACK_CATEGORIES: { value: FeedbackCategory; label: string }[] = [
  { value: 'scoring_accuracy', label: 'Scoring Accuracy' },
  { value: 'evidence_quality', label: 'Evidence Quality' },
  { value: 'recommendation_relevance', label: 'Recommendation Relevance' },
  { value: 'summary_clarity', label: 'Summary Clarity' },
  { value: 'detail_level', label: 'Detail Level' },
  { value: 'rubric_alignment', label: 'Rubric Alignment' },
  { value: 'video_coverage', label: 'Video Coverage' },
];

const DISAGREEMENT_TYPES: { value: DisagreementType; label: string }[] = [
  { value: 'score_too_high', label: 'Score Too High' },
  { value: 'score_too_low', label: 'Score Too Low' },
  { value: 'wrong_evidence', label: 'Wrong Evidence Cited' },
  { value: 'missed_evidence', label: 'Missed Important Evidence' },
  { value: 'misinterpreted', label: 'Misinterpreted Behavior' },
];

export const AIFeedbackForm: React.FC<AIFeedbackFormProps> = ({
  observation,
  onClose,
  onSubmitSuccess,
  compact = false,
}) => {
  const { submitFeedback, addCorrection, isSubmitting, error, clearError } = useFeedbackStore();

  // Quick action mode
  const [mode, setMode] = useState<'quick' | 'detailed' | null>(null);

  // Form state
  const [overallAgreement, setOverallAgreement] = useState<AgreementLevel | null>(null);
  const [accuracyRating, setAccuracyRating] = useState(0);
  const [helpfulnessRating, setHelpfulnessRating] = useState(0);
  const [detailRating, setDetailRating] = useState(0);
  const [feedbackText, setFeedbackText] = useState('');
  const [whatWasMissed, setWhatWasMissed] = useState('');
  const [whatWasIncorrect, setWhatWasIncorrect] = useState('');
  const [suggestions, setSuggestions] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<FeedbackCategory[]>([]);

  // Score correction
  const [showCorrection, setShowCorrection] = useState(false);
  const [correctedScore, setCorrectedScore] = useState(observation.scoreEstimate || 0);
  const [correctionReason, setCorrectionReason] = useState('');
  const [disagreementType, setDisagreementType] = useState<DisagreementType | null>(null);
  const [userConfidence, setUserConfidence] = useState<UserConfidence>('confident');

  const [expanded, setExpanded] = useState(!compact);

  const handleQuickAction = async (action: 'accept' | 'reject') => {
    const input: CreateFeedbackInput = {
      observationId: observation.id,
      videoId: observation.videoId,
      overallAgreement: action === 'accept' ? 'agree' : 'disagree',
      feedbackCategories: [],
    };

    try {
      await submitFeedback(input);
      onSubmitSuccess?.();
    } catch (err) {
      console.error('Failed to submit quick feedback:', err);
    }
  };

  const handleSubmitDetailed = async () => {
    const input: CreateFeedbackInput = {
      observationId: observation.id,
      videoId: observation.videoId,
      accuracyRating: accuracyRating || undefined,
      helpfulnessRating: helpfulnessRating || undefined,
      detailRating: detailRating || undefined,
      overallAgreement: overallAgreement || undefined,
      feedbackText: feedbackText || undefined,
      whatWasMissed: whatWasMissed || undefined,
      whatWasIncorrect: whatWasIncorrect || undefined,
      suggestions: suggestions || undefined,
      feedbackCategories: selectedCategories,
    };

    try {
      const feedback = await submitFeedback(input);

      // If there's a score correction, add it
      if (showCorrection && correctedScore !== observation.scoreEstimate) {
        const correction: CreateCorrectionInput = {
          elementId: observation.elementId,
          aiScore: observation.scoreEstimate || 0,
          correctedScore,
          aiConfidence: observation.confidence,
          userConfidence,
          correctionReason: correctionReason || undefined,
          disagreementType: disagreementType || undefined,
        };
        await addCorrection(feedback.id, correction);
      }

      onSubmitSuccess?.();
    } catch (err) {
      console.error('Failed to submit detailed feedback:', err);
    }
  };

  const toggleCategory = (category: FeedbackCategory) => {
    setSelectedCategories((prev) =>
      prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category]
    );
  };

  const StarRating = ({
    value,
    onChange,
    label,
  }: {
    value: number;
    onChange: (v: number) => void;
    label: string;
  }) => (
    <div className="flex items-center gap-2">
      <span className="text-sm text-gray-600 w-24">{label}</span>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => onChange(star)}
            className={`p-0.5 ${star <= value ? 'text-yellow-500' : 'text-gray-300'} hover:text-yellow-400`}
          >
            <Star className="w-5 h-5" fill={star <= value ? 'currentColor' : 'none'} />
          </button>
        ))}
      </div>
    </div>
  );

  if (compact && !expanded) {
    return (
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          className="text-green-600 hover:bg-green-50"
          leftIcon={<ThumbsUp className="w-3 h-3" />}
          onClick={() => handleQuickAction('accept')}
          disabled={isSubmitting}
        >
          Agree
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-red-600 hover:bg-red-50"
          leftIcon={<ThumbsDown className="w-3 h-3" />}
          onClick={() => handleQuickAction('reject')}
          disabled={isSubmitting}
        >
          Disagree
        </Button>
        <Button
          size="sm"
          variant="ghost"
          leftIcon={<MessageSquare className="w-3 h-3" />}
          onClick={() => setExpanded(true)}
        >
          Feedback
        </Button>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-gray-900 flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-primary-600" />
          AI Assessment Feedback
        </h3>
        {compact && (
          <button onClick={() => setExpanded(false)} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 p-2 bg-red-50 text-red-700 rounded text-sm">
          <AlertTriangle className="w-4 h-4" />
          {error}
          <button onClick={clearError} className="ml-auto">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Quick Actions */}
      {mode === null && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            AI Score: <span className="font-semibold">{observation.scoreEstimate}%</span>
            {' • '}
            Confidence: <span className="font-semibold">{Math.round((observation.confidence || 0) * 100)}%</span>
          </p>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700"
              leftIcon={<Check className="w-4 h-4" />}
              onClick={() => handleQuickAction('accept')}
              disabled={isSubmitting}
            >
              Accept AI Assessment
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="border-red-300 text-red-600 hover:bg-red-50"
              leftIcon={<X className="w-4 h-4" />}
              onClick={() => handleQuickAction('reject')}
              disabled={isSubmitting}
            >
              Reject Assessment
            </Button>
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<Edit3 className="w-4 h-4" />}
              onClick={() => setMode('detailed')}
            >
              Provide Detailed Feedback
            </Button>
          </div>
        </div>
      )}

      {/* Detailed Feedback Form */}
      {mode === 'detailed' && (
        <div className="space-y-4">
          {/* Overall Agreement */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Overall Agreement with AI Assessment
            </label>
            <div className="flex flex-wrap gap-2">
              {AGREEMENT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setOverallAgreement(option.value)}
                  className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                    overallAgreement === option.value
                      ? 'bg-primary-100 border-primary-500 text-primary-700'
                      : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* Star Ratings */}
          <div className="space-y-2">
            <StarRating value={accuracyRating} onChange={setAccuracyRating} label="Accuracy" />
            <StarRating value={helpfulnessRating} onChange={setHelpfulnessRating} label="Helpfulness" />
            <StarRating value={detailRating} onChange={setDetailRating} label="Detail Level" />
          </div>

          {/* Feedback Categories */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Feedback Areas (select all that apply)
            </label>
            <div className="flex flex-wrap gap-2">
              {FEEDBACK_CATEGORIES.map((cat) => (
                <button
                  key={cat.value}
                  type="button"
                  onClick={() => toggleCategory(cat.value)}
                  className={`px-2 py-1 text-xs rounded border transition-colors ${
                    selectedCategories.includes(cat.value)
                      ? 'bg-primary-100 border-primary-400 text-primary-700'
                      : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Text Feedback */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              General Feedback
            </label>
            <textarea
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="Share your overall thoughts on this AI assessment..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
              rows={2}
            />
          </div>

          {/* What was missed */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 text-orange-500" />
                What Did AI Miss?
              </label>
              <textarea
                value={whatWasMissed}
                onChange={(e) => setWhatWasMissed(e.target.value)}
                placeholder="Describe any teaching behaviors or evidence the AI didn't capture..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                rows={2}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
                <X className="w-3 h-3 text-red-500" />
                What Was Incorrect?
              </label>
              <textarea
                value={whatWasIncorrect}
                onChange={(e) => setWhatWasIncorrect(e.target.value)}
                placeholder="Describe any errors in the AI's analysis..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                rows={2}
              />
            </div>
          </div>

          {/* Suggestions */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
              <Lightbulb className="w-3 h-3 text-yellow-500" />
              Suggestions for Improvement
            </label>
            <textarea
              value={suggestions}
              onChange={(e) => setSuggestions(e.target.value)}
              placeholder="How could the AI assessment be improved?"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
              rows={2}
            />
          </div>

          {/* Score Correction Toggle */}
          <div>
            <button
              type="button"
              onClick={() => setShowCorrection(!showCorrection)}
              className="flex items-center gap-2 text-sm text-primary-600 hover:text-primary-700"
            >
              {showCorrection ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              {showCorrection ? 'Hide Score Correction' : 'Suggest Score Correction'}
            </button>

            {showCorrection && (
              <div className="mt-3 p-3 bg-gray-50 rounded-lg space-y-3">
                <div className="flex items-center gap-4">
                  <div>
                    <label className="block text-xs text-gray-500">AI Score</label>
                    <p className="text-lg font-semibold text-gray-400">{observation.scoreEstimate}%</p>
                  </div>
                  <div className="text-gray-400">→</div>
                  <div>
                    <label className="block text-xs text-gray-500">Corrected Score</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={correctedScore}
                      onChange={(e) => setCorrectedScore(Number(e.target.value))}
                      className="w-20 px-2 py-1 border border-gray-300 rounded text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Type of Disagreement
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {DISAGREEMENT_TYPES.map((type) => (
                      <button
                        key={type.value}
                        type="button"
                        onClick={() => setDisagreementType(type.value)}
                        className={`px-2 py-1 text-xs rounded border transition-colors ${
                          disagreementType === type.value
                            ? 'bg-orange-100 border-orange-400 text-orange-700'
                            : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}
                      >
                        {type.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Your Confidence Level
                  </label>
                  <div className="flex gap-2">
                    {[
                      { value: 'very_confident', label: 'Very Confident' },
                      { value: 'confident', label: 'Confident' },
                      { value: 'somewhat_confident', label: 'Somewhat Confident' },
                    ].map((conf) => (
                      <button
                        key={conf.value}
                        type="button"
                        onClick={() => setUserConfidence(conf.value as UserConfidence)}
                        className={`px-2 py-1 text-xs rounded border transition-colors ${
                          userConfidence === conf.value
                            ? 'bg-primary-100 border-primary-400 text-primary-700'
                            : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}
                      >
                        {conf.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Reason for Correction
                  </label>
                  <textarea
                    value={correctionReason}
                    onChange={(e) => setCorrectionReason(e.target.value)}
                    placeholder="Explain why you believe the score should be different..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                    rows={2}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2 border-t border-gray-200">
            <Button
              onClick={handleSubmitDetailed}
              isLoading={isSubmitting}
              leftIcon={<Send className="w-4 h-4" />}
            >
              Submit Feedback
            </Button>
            <Button variant="ghost" onClick={() => setMode(null)}>
              Cancel
            </Button>
            {onClose && (
              <Button variant="ghost" onClick={onClose} className="ml-auto">
                Close
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AIFeedbackForm;
