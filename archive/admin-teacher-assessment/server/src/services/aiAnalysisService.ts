import OpenAI from 'openai';
import PQueue from 'p-queue';
import {
  promptService,
  FrameAnalysisPromptConfig,
  SynthesisPromptConfig,
  FrameAnalysisResponse,
  SynthesisResponse,
  ElementAnalysis,
  RubricElement,
  TeacherContext,
} from './promptService';
import { ExtractedFrame } from './videoProcessingService';
import { db } from '../utils/db';

/**
 * AI Analysis configuration from environment
 */
export interface AIAnalysisConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
  dailyBudgetUsd: number;
  maxRetries: number;
  retryDelayMs: number;
}

/**
 * Token usage tracking
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

/**
 * Analysis result for a batch of elements
 */
export interface BatchAnalysisResult {
  analyses: ElementAnalysis[];
  tokenUsage: TokenUsage;
  processingTimeMs: number;
  model: string;
  retryCount: number;
}

/**
 * Complete video analysis result
 */
export interface VideoAnalysisResult {
  elementAnalyses: ElementAnalysis[];
  synthesis: SynthesisResponse;
  totalTokenUsage: TokenUsage;
  totalProcessingTimeMs: number;
  batchCount: number;
  frameCount: number;
  model: string;
}

/**
 * Circuit breaker state
 */
interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number | null;
  state: 'closed' | 'open' | 'half-open';
}

/**
 * Service for AI-powered video analysis using GPT-4o
 */
export class AIAnalysisService {
  private openai: OpenAI;
  private config: AIAnalysisConfig;
  private queue: PQueue;
  private circuitBreaker: CircuitBreakerState;

  // Pricing per 1K tokens (GPT-4o as of 2025)
  private static readonly PRICING = {
    inputPer1k: 0.005, // $0.005 per 1K input tokens
    outputPer1k: 0.015, // $0.015 per 1K output tokens
  };

  // Circuit breaker settings
  private static readonly CIRCUIT_BREAKER = {
    failureThreshold: 5,
    recoveryTimeMs: 60000, // 1 minute
    successThreshold: 2,
  };

  constructor(config?: Partial<AIAnalysisConfig>) {
    this.config = {
      apiKey: process.env.OPENAI_API_KEY || '',
      model: process.env.AI_MODEL || 'gpt-4o',
      maxTokens: parseInt(process.env.AI_MAX_TOKENS || '2000'),
      temperature: parseFloat(process.env.AI_TEMPERATURE || '0.3'),
      dailyBudgetUsd: parseFloat(process.env.AI_DAILY_BUDGET_USD || '20'),
      maxRetries: 3,
      retryDelayMs: 1000,
      ...config,
    };

    this.openai = new OpenAI({
      apiKey: this.config.apiKey,
    });

    // Rate limiting: 10 requests per minute
    this.queue = new PQueue({
      concurrency: 3,
      interval: 60000,
      intervalCap: 10,
    });

    this.circuitBreaker = {
      failures: 0,
      lastFailureTime: null,
      state: 'closed',
    };
  }

  /**
   * Calculate cost from token usage
   */
  private calculateCost(inputTokens: number, outputTokens: number): number {
    const inputCost = (inputTokens / 1000) * AIAnalysisService.PRICING.inputPer1k;
    const outputCost = (outputTokens / 1000) * AIAnalysisService.PRICING.outputPer1k;
    return Math.round((inputCost + outputCost) * 10000) / 10000; // Round to 4 decimal places
  }

  /**
   * Check if circuit breaker should allow request
   */
  private checkCircuitBreaker(): boolean {
    if (this.circuitBreaker.state === 'closed') {
      return true;
    }

    if (this.circuitBreaker.state === 'open') {
      const timeSinceFailure = Date.now() - (this.circuitBreaker.lastFailureTime || 0);
      if (timeSinceFailure >= AIAnalysisService.CIRCUIT_BREAKER.recoveryTimeMs) {
        this.circuitBreaker.state = 'half-open';
        return true;
      }
      return false;
    }

    // half-open state allows requests
    return true;
  }

  /**
   * Record success for circuit breaker
   */
  private recordSuccess(): void {
    if (this.circuitBreaker.state === 'half-open') {
      this.circuitBreaker.failures = 0;
      this.circuitBreaker.state = 'closed';
    }
  }

  /**
   * Record failure for circuit breaker
   */
  private recordFailure(): void {
    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailureTime = Date.now();

    if (this.circuitBreaker.failures >= AIAnalysisService.CIRCUIT_BREAKER.failureThreshold) {
      this.circuitBreaker.state = 'open';
      console.error(
        `Circuit breaker OPEN after ${this.circuitBreaker.failures} failures`
      );
    }
  }

  /**
   * Check daily budget before making request
   */
  async checkDailyBudget(): Promise<{ withinBudget: boolean; usedToday: number; remaining: number }> {
    const today = new Date().toISOString().split('T')[0];

    const usage = await db('ai_usage_metrics')
      .where('date', today)
      .where('model', this.config.model)
      .first();

    const usedToday = usage?.total_cost_usd || 0;
    const remaining = this.config.dailyBudgetUsd - usedToday;

    return {
      withinBudget: remaining > 0,
      usedToday,
      remaining,
    };
  }

  /**
   * Update daily usage metrics
   */
  async updateUsageMetrics(tokenUsage: TokenUsage): Promise<void> {
    const today = new Date().toISOString().split('T')[0];

    await db('ai_usage_metrics')
      .insert({
        date: today,
        model: this.config.model,
        total_requests: 1,
        successful_requests: 1,
        total_input_tokens: tokenUsage.inputTokens,
        total_output_tokens: tokenUsage.outputTokens,
        total_tokens: tokenUsage.totalTokens,
        total_cost_usd: tokenUsage.estimatedCostUsd,
      })
      .onConflict(['date', 'model'])
      .merge({
        total_requests: db.raw('ai_usage_metrics.total_requests + 1'),
        successful_requests: db.raw('ai_usage_metrics.successful_requests + 1'),
        total_input_tokens: db.raw(`ai_usage_metrics.total_input_tokens + ${tokenUsage.inputTokens}`),
        total_output_tokens: db.raw(`ai_usage_metrics.total_output_tokens + ${tokenUsage.outputTokens}`),
        total_tokens: db.raw(`ai_usage_metrics.total_tokens + ${tokenUsage.totalTokens}`),
        total_cost_usd: db.raw(`ai_usage_metrics.total_cost_usd + ${tokenUsage.estimatedCostUsd}`),
      });
  }

  /**
   * Make a vision API call with frames
   */
  async analyzeFramesWithRetry(
    prompt: string,
    frames: ExtractedFrame[],
    retryCount = 0
  ): Promise<{ response: string; tokenUsage: TokenUsage }> {
    // Check circuit breaker
    if (!this.checkCircuitBreaker()) {
      throw new Error('Circuit breaker is OPEN - too many recent failures');
    }

    // Check daily budget
    const budget = await this.checkDailyBudget();
    if (!budget.withinBudget) {
      throw new Error(`Daily budget exceeded: $${budget.usedToday.toFixed(2)} used of $${this.config.dailyBudgetUsd}`);
    }

    try {
      // Build message content with frames
      const content: OpenAI.ChatCompletionContentPart[] = [
        { type: 'text', text: prompt },
        ...frames.map((frame) => ({
          type: 'image_url' as const,
          image_url: {
            url: `data:image/jpeg;base64,${frame.base64}`,
            detail: 'high' as const,
          },
        })),
      ];

      const response = await this.openai.chat.completions.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        messages: [
          {
            role: 'user',
            content,
          },
        ],
      });

      const tokenUsage: TokenUsage = {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
        estimatedCostUsd: this.calculateCost(
          response.usage?.prompt_tokens || 0,
          response.usage?.completion_tokens || 0
        ),
      };

      // Update metrics
      await this.updateUsageMetrics(tokenUsage);

      // Record success
      this.recordSuccess();

      return {
        response: response.choices[0]?.message?.content || '',
        tokenUsage,
      };
    } catch (error) {
      // Record failure
      this.recordFailure();

      // Retry logic
      const isRetryable =
        (error as any)?.status === 429 || // Rate limit
        (error as any)?.status >= 500; // Server error

      if (isRetryable && retryCount < this.config.maxRetries) {
        const delay = this.config.retryDelayMs * Math.pow(2, retryCount);
        console.log(`Retrying in ${delay}ms (attempt ${retryCount + 1}/${this.config.maxRetries})`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.analyzeFramesWithRetry(prompt, frames, retryCount + 1);
      }

      throw error;
    }
  }

  /**
   * Make a text-only API call (for synthesis)
   */
  async synthesizeWithRetry(
    prompt: string,
    retryCount = 0
  ): Promise<{ response: string; tokenUsage: TokenUsage }> {
    // Check circuit breaker
    if (!this.checkCircuitBreaker()) {
      throw new Error('Circuit breaker is OPEN - too many recent failures');
    }

    // Check daily budget
    const budget = await this.checkDailyBudget();
    if (!budget.withinBudget) {
      throw new Error(`Daily budget exceeded: $${budget.usedToday.toFixed(2)} used of $${this.config.dailyBudgetUsd}`);
    }

    try {
      const response = await this.openai.chat.completions.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const tokenUsage: TokenUsage = {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
        estimatedCostUsd: this.calculateCost(
          response.usage?.prompt_tokens || 0,
          response.usage?.completion_tokens || 0
        ),
      };

      // Update metrics
      await this.updateUsageMetrics(tokenUsage);

      // Record success
      this.recordSuccess();

      return {
        response: response.choices[0]?.message?.content || '',
        tokenUsage,
      };
    } catch (error) {
      // Record failure
      this.recordFailure();

      // Retry logic
      const isRetryable =
        (error as any)?.status === 429 || // Rate limit
        (error as any)?.status >= 500; // Server error

      if (isRetryable && retryCount < this.config.maxRetries) {
        const delay = this.config.retryDelayMs * Math.pow(2, retryCount);
        console.log(`Retrying in ${delay}ms (attempt ${retryCount + 1}/${this.config.maxRetries})`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.synthesizeWithRetry(prompt, retryCount + 1);
      }

      throw error;
    }
  }

  /**
   * Analyze a batch of rubric elements against video frames
   */
  async analyzeBatch(
    frames: ExtractedFrame[],
    elements: RubricElement[],
    teacherContext: TeacherContext,
    frameworkName: string,
    batchNumber: number,
    totalBatches: number
  ): Promise<BatchAnalysisResult> {
    const startTime = Date.now();

    const config: FrameAnalysisPromptConfig = {
      teacherContext,
      videoContext: {
        duration: 0, // Will be set by caller
        frameCount: frames.length,
        frameTimestamps: frames.map((f) => f.timestamp),
      },
      rubricElements: elements,
      frameworkName,
    };

    const prompt = promptService.generateBatchAnalysisPrompt(
      config,
      batchNumber,
      totalBatches
    );

    // Use queue for rate limiting
    const result = await this.queue.add(() =>
      this.analyzeFramesWithRetry(prompt, frames)
    );

    // Parse the response
    const parsed = promptService.parseFrameAnalysisResponse(result!.response);

    return {
      analyses: parsed.element_analyses,
      tokenUsage: result!.tokenUsage,
      processingTimeMs: Date.now() - startTime,
      model: this.config.model,
      retryCount: 0,
    };
  }

  /**
   * Generate synthesis from element analyses
   */
  async generateSynthesis(
    elementAnalyses: ElementAnalysis[],
    teacherContext: TeacherContext,
    frameworkName: string,
    domains: string[]
  ): Promise<{ synthesis: SynthesisResponse; tokenUsage: TokenUsage; processingTimeMs: number }> {
    const startTime = Date.now();

    const config: SynthesisPromptConfig = {
      teacherContext,
      elementAnalyses,
      frameworkName,
      domains,
    };

    const prompt = promptService.generateSynthesisPrompt(config);

    // Use queue for rate limiting
    const result = await this.queue.add(() => this.synthesizeWithRetry(prompt));

    // Parse the response
    const parsed = promptService.parseSynthesisResponse(result!.response);

    return {
      synthesis: parsed,
      tokenUsage: result!.tokenUsage,
      processingTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Perform complete video analysis
   */
  async analyzeVideo(
    frames: ExtractedFrame[],
    elements: RubricElement[],
    teacherContext: TeacherContext,
    frameworkName: string,
    videoDuration: number
  ): Promise<VideoAnalysisResult> {
    const startTime = Date.now();
    const allAnalyses: ElementAnalysis[] = [];
    let totalTokenUsage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
    };

    // Batch elements (10 per batch)
    const batchSize = 10;
    const batches: RubricElement[][] = [];
    for (let i = 0; i < elements.length; i += batchSize) {
      batches.push(elements.slice(i, i + batchSize));
    }

    console.log(`Processing ${batches.length} batches of elements...`);

    // Process each batch
    for (let i = 0; i < batches.length; i++) {
      console.log(`Processing batch ${i + 1}/${batches.length}...`);

      const batchResult = await this.analyzeBatch(
        frames,
        batches[i],
        teacherContext,
        frameworkName,
        i + 1,
        batches.length
      );

      allAnalyses.push(...batchResult.analyses);

      // Accumulate token usage
      totalTokenUsage.inputTokens += batchResult.tokenUsage.inputTokens;
      totalTokenUsage.outputTokens += batchResult.tokenUsage.outputTokens;
      totalTokenUsage.totalTokens += batchResult.tokenUsage.totalTokens;
      totalTokenUsage.estimatedCostUsd += batchResult.tokenUsage.estimatedCostUsd;
    }

    // Get unique domains from elements
    const domains = [...new Set(elements.map((e) => e.domain_name || 'Unknown'))];

    // Generate synthesis
    console.log('Generating synthesis...');
    const synthesisResult = await this.generateSynthesis(
      allAnalyses,
      teacherContext,
      frameworkName,
      domains
    );

    // Accumulate synthesis token usage
    totalTokenUsage.inputTokens += synthesisResult.tokenUsage.inputTokens;
    totalTokenUsage.outputTokens += synthesisResult.tokenUsage.outputTokens;
    totalTokenUsage.totalTokens += synthesisResult.tokenUsage.totalTokens;
    totalTokenUsage.estimatedCostUsd += synthesisResult.tokenUsage.estimatedCostUsd;

    return {
      elementAnalyses: allAnalyses,
      synthesis: synthesisResult.synthesis,
      totalTokenUsage,
      totalProcessingTimeMs: Date.now() - startTime,
      batchCount: batches.length,
      frameCount: frames.length,
      model: this.config.model,
    };
  }

  /**
   * Get current circuit breaker status
   */
  getCircuitBreakerStatus(): CircuitBreakerState {
    return { ...this.circuitBreaker };
  }

  /**
   * Reset circuit breaker (for admin use)
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker = {
      failures: 0,
      lastFailureTime: null,
      state: 'closed',
    };
  }
}

// Export singleton instance
export const aiAnalysisService = new AIAnalysisService();
