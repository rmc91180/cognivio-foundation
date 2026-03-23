/**
 * Prompt Service for AI Video Analysis
 *
 * Generates rubric-aware prompts for GPT-4o vision model analysis.
 * Supports both frame-level analysis and synthesis prompts.
 */

/**
 * Rubric element for prompt construction
 */
export interface RubricElement {
  id: string;
  name: string;
  description: string;
  domain_name?: string;
  indicators?: string[];
}

/**
 * Teacher context for prompt construction
 */
export interface TeacherContext {
  name: string;
  subject?: string;
  gradeLevel?: string;
  school?: string;
}

/**
 * Video context for prompt construction
 */
export interface VideoContext {
  duration: number; // seconds
  frameCount: number;
  frameTimestamps: number[];
}

/**
 * Frame analysis prompt configuration
 */
export interface FrameAnalysisPromptConfig {
  teacherContext: TeacherContext;
  videoContext: VideoContext;
  rubricElements: RubricElement[];
  frameworkName: string; // 'Marshall' or 'Danielson'
}

/**
 * Expected JSON response structure for frame analysis
 */
export interface FrameAnalysisResponse {
  element_analyses: ElementAnalysis[];
  overall_observation: string;
  classroom_context: string;
  limitations: string[];
}

/**
 * Individual element analysis
 */
export interface ElementAnalysis {
  element_id: string;
  element_name: string;
  score: number; // 1-4
  confidence: number; // 0-100
  evidence: {
    observed_behaviors: string[];
    frame_references: number[];
    student_indicators: string[];
    environmental_factors: string[];
  };
  detailed_analysis: string;
  key_moments: KeyMoment[];
  recommendations: string[];
}

/**
 * Key moment in the video
 */
export interface KeyMoment {
  estimated_timestamp_seconds: number;
  description: string;
  score_impact: 'positive' | 'negative' | 'neutral';
  related_elements: string[];
}

/**
 * Synthesis prompt configuration
 */
export interface SynthesisPromptConfig {
  teacherContext: TeacherContext;
  elementAnalyses: ElementAnalysis[];
  frameworkName: string;
  domains: string[];
}

/**
 * Expected JSON response structure for synthesis
 */
export interface SynthesisResponse {
  executive_summary: string;
  domain_summaries: DomainSummary[];
  overall_rating: {
    score: number;
    performance_level: string;
    justification: string;
  };
  prioritized_recommendations: PrioritizedRecommendation[];
  strengths: string[];
  growth_areas: string[];
}

/**
 * Domain-level summary
 */
export interface DomainSummary {
  domain_name: string;
  summary: string;
  average_score: number;
  key_strengths: string[];
  growth_areas: string[];
  notable_moments: string[];
}

/**
 * Prioritized recommendation
 */
export interface PrioritizedRecommendation {
  priority: number;
  recommendation: string;
  target_elements: string[];
  expected_impact: string;
  suggested_resources?: string[];
}

/**
 * Service for generating AI analysis prompts
 */
export class PromptService {
  /**
   * Scoring rubric definitions (1-4 scale)
   */
  private static readonly SCORING_RUBRIC = `
SCORING SCALE (1-4):

1 = UNSATISFACTORY
- Little to no evidence of the expected teaching behavior
- Significant deficiencies that negatively impact student learning
- Teacher appears unaware of or unable to implement best practices
- Immediate intervention and support needed

2 = BASIC
- Some evidence of the expected teaching behavior, but inconsistent
- Room for significant improvement in implementation
- Teacher shows awareness but struggles with execution
- Professional development recommended

3 = PROFICIENT
- Clear and consistent evidence of the expected teaching behavior
- Meets standard expectations for effective teaching
- Teacher demonstrates competence and effectiveness
- May benefit from refinement but is effective

4 = DISTINGUISHED
- Exceptional evidence that exceeds standard expectations
- Innovative, highly effective implementation
- Teacher serves as a model for others
- Demonstrates mastery and continuous improvement
`;

  /**
   * Generate the frame analysis prompt
   */
  generateFrameAnalysisPrompt(config: FrameAnalysisPromptConfig): string {
    const { teacherContext, videoContext, rubricElements, frameworkName } = config;

    // Format rubric elements with their descriptions
    const elementsText = rubricElements
      .map((el, idx) => {
        let text = `${idx + 1}. ${el.name}\n   ID: ${el.id}\n   Description: ${el.description}`;
        if (el.domain_name) {
          text += `\n   Domain: ${el.domain_name}`;
        }
        if (el.indicators && el.indicators.length > 0) {
          text += `\n   Key Indicators: ${el.indicators.join('; ')}`;
        }
        return text;
      })
      .join('\n\n');

    // Format frame timestamps
    const timestampsText = videoContext.frameTimestamps
      .map((ts, idx) => `Frame ${idx + 1}: ${Math.floor(ts / 60)}:${(ts % 60).toString().padStart(2, '0')} (${ts}s)`)
      .join('\n');

    return `You are an expert educational evaluator with deep expertise in the ${frameworkName} Framework for teacher evaluation. You are analyzing classroom instruction to provide detailed, evidence-based assessments.

## VIDEO CONTEXT

Teacher: ${teacherContext.name}
${teacherContext.subject ? `Subject: ${teacherContext.subject}` : ''}
${teacherContext.gradeLevel ? `Grade Level: ${teacherContext.gradeLevel}` : ''}
Video Duration: ${Math.round(videoContext.duration / 60)} minutes
Frames Provided: ${videoContext.frameCount} frames at regular intervals

Frame Timestamps:
${timestampsText}

## FRAMEWORK: ${frameworkName.toUpperCase()}

You are evaluating the teacher against the following rubric elements from the ${frameworkName} Framework:

${elementsText}

${PromptService.SCORING_RUBRIC}

## ANALYSIS TASK

Carefully examine all ${videoContext.frameCount} frames provided. For EACH rubric element listed above:

1. **OBSERVE** - What specific teaching behaviors, student responses, and classroom elements are visible in the frames?

2. **SCORE** - Based on your observations, assign a score from 1-4 using the rubric above. Be objective and evidence-based.

3. **JUSTIFY** - Provide specific evidence from the frames to support your score. Reference frame numbers.

4. **RECOMMEND** - Provide actionable suggestions for improvement, even for high scores.

## IMPORTANT GUIDELINES

- Base ALL assessments on VISIBLE EVIDENCE in the frames only
- Do NOT make assumptions about what happened between frames
- Note when evidence is limited or unclear (reflected in confidence score)
- Be specific about which frames support each observation
- Consider both teacher actions and student responses/engagement
- Look for classroom environment, materials, and organization

## RESPONSE FORMAT

Respond with a valid JSON object following this exact structure:

{
  "element_analyses": [
    {
      "element_id": "string - exact ID from the rubric element",
      "element_name": "string - name of the rubric element",
      "score": number (1-4),
      "confidence": number (0-100 - how certain are you based on available evidence),
      "evidence": {
        "observed_behaviors": ["specific behaviors observed in frames"],
        "frame_references": [numbers - which frames show this evidence],
        "student_indicators": ["observable student responses/engagement"],
        "environmental_factors": ["classroom setup, materials, displays observed"]
      },
      "detailed_analysis": "string - 3-5 sentences explaining the score with specific evidence",
      "key_moments": [
        {
          "estimated_timestamp_seconds": number,
          "description": "what occurred at this moment",
          "score_impact": "positive" | "negative" | "neutral",
          "related_elements": ["element_ids this moment relates to"]
        }
      ],
      "recommendations": ["specific, actionable improvement suggestions"]
    }
  ],
  "overall_observation": "string - 2-3 sentence summary of the classroom observation",
  "classroom_context": "string - description of the visible classroom environment and context",
  "limitations": ["any limitations in the analysis due to frame coverage or visibility"]
}

Analyze all ${rubricElements.length} rubric elements and provide your assessment.`;
  }

  /**
   * Generate the synthesis prompt for creating summaries from element analyses
   */
  generateSynthesisPrompt(config: SynthesisPromptConfig): string {
    const { teacherContext, elementAnalyses, frameworkName, domains } = config;

    // Format element analyses for the prompt
    const analysesText = elementAnalyses
      .map((el) => {
        return `- ${el.element_name} (${el.element_id}): Score ${el.score}/4, Confidence ${el.confidence}%
  Analysis: ${el.detailed_analysis}
  Key Evidence: ${el.evidence.observed_behaviors.slice(0, 3).join('; ')}`;
      })
      .join('\n\n');

    // Calculate aggregate stats
    const avgScore = elementAnalyses.reduce((sum, el) => sum + el.score, 0) / elementAnalyses.length;
    const avgConfidence = elementAnalyses.reduce((sum, el) => sum + el.confidence, 0) / elementAnalyses.length;

    return `You are an expert educational consultant synthesizing detailed rubric analysis into comprehensive teacher feedback. Your task is to create a professional assessment report.

## TEACHER CONTEXT

Teacher: ${teacherContext.name}
${teacherContext.subject ? `Subject: ${teacherContext.subject}` : ''}
${teacherContext.gradeLevel ? `Grade Level: ${teacherContext.gradeLevel}` : ''}
Framework: ${frameworkName}

## ELEMENT ANALYSIS RESULTS

The following individual element analyses have been completed:

${analysesText}

## AGGREGATE STATISTICS

- Total Elements Analyzed: ${elementAnalyses.length}
- Average Score: ${avgScore.toFixed(2)}/4
- Average Confidence: ${avgConfidence.toFixed(1)}%
- Domains Covered: ${domains.join(', ')}

## SYNTHESIS TASK

Based on the individual element analyses above, create a comprehensive assessment that:

1. **EXECUTIVE SUMMARY** - Write 2-3 paragraphs summarizing:
   - Overall teaching effectiveness observed
   - Major strengths demonstrated
   - Priority areas for growth
   - Contextual factors that influenced the assessment

2. **DOMAIN SUMMARIES** - For each domain (${domains.join(', ')}):
   - Summarize performance across related elements
   - Identify domain-specific patterns
   - Highlight domain strengths and growth areas

3. **OVERALL RATING** - Provide:
   - Calculated overall score (weighted average: ${avgScore.toFixed(2)})
   - Performance level (Unsatisfactory/Basic/Proficient/Distinguished)
   - Clear justification for the rating

4. **PRIORITIZED RECOMMENDATIONS** - Rank top 5 recommendations by:
   - Potential impact on student learning
   - Feasibility of implementation
   - Connection to lowest-scoring elements

## RESPONSE FORMAT

Respond with a valid JSON object following this exact structure:

{
  "executive_summary": "string - 2-3 detailed paragraphs",
  "domain_summaries": [
    {
      "domain_name": "string",
      "summary": "string - 3-5 sentences",
      "average_score": number,
      "key_strengths": ["string"],
      "growth_areas": ["string"],
      "notable_moments": ["string - specific moments from the analysis"]
    }
  ],
  "overall_rating": {
    "score": number (calculated from element scores),
    "performance_level": "Unsatisfactory" | "Basic" | "Proficient" | "Distinguished",
    "justification": "string - clear explanation of the overall rating"
  },
  "prioritized_recommendations": [
    {
      "priority": number (1-5, 1 being highest),
      "recommendation": "string - specific, actionable recommendation",
      "target_elements": ["element_ids this addresses"],
      "expected_impact": "string - expected improvement if implemented",
      "suggested_resources": ["optional - professional development resources"]
    }
  ],
  "strengths": ["string - top 3-5 overall strengths"],
  "growth_areas": ["string - top 3-5 priority growth areas"]
}

Create the synthesis now.`;
  }

  /**
   * Generate a simpler prompt for batch processing multiple elements
   */
  generateBatchAnalysisPrompt(
    config: FrameAnalysisPromptConfig,
    batchNumber: number,
    totalBatches: number
  ): string {
    const basePrompt = this.generateFrameAnalysisPrompt(config);

    return `${basePrompt}

NOTE: This is batch ${batchNumber} of ${totalBatches}. Focus only on the ${config.rubricElements.length} elements listed above. Subsequent batches will cover other elements.`;
  }

  /**
   * Parse and validate the frame analysis response
   */
  parseFrameAnalysisResponse(responseText: string): FrameAnalysisResponse {
    try {
      // Try to extract JSON from the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON object found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]) as FrameAnalysisResponse;

      // Validate required fields
      if (!parsed.element_analyses || !Array.isArray(parsed.element_analyses)) {
        throw new Error('Missing or invalid element_analyses array');
      }

      // Validate each element analysis
      for (const analysis of parsed.element_analyses) {
        if (!analysis.element_id || typeof analysis.score !== 'number') {
          throw new Error(`Invalid element analysis: missing element_id or score`);
        }
        // Clamp score to valid range
        analysis.score = Math.max(1, Math.min(4, Math.round(analysis.score)));
        // Clamp confidence to valid range
        analysis.confidence = Math.max(0, Math.min(100, analysis.confidence || 50));
      }

      return parsed;
    } catch (error) {
      throw new Error(`Failed to parse frame analysis response: ${(error as Error).message}`);
    }
  }

  /**
   * Parse and validate the synthesis response
   */
  parseSynthesisResponse(responseText: string): SynthesisResponse {
    try {
      // Try to extract JSON from the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON object found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]) as SynthesisResponse;

      // Validate required fields
      if (!parsed.executive_summary) {
        throw new Error('Missing executive_summary');
      }
      if (!parsed.overall_rating || typeof parsed.overall_rating.score !== 'number') {
        throw new Error('Missing or invalid overall_rating');
      }

      return parsed;
    } catch (error) {
      throw new Error(`Failed to parse synthesis response: ${(error as Error).message}`);
    }
  }
}

// Export singleton instance
export const promptService = new PromptService();
