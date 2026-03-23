import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';

// Configure FFmpeg path
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

/**
 * Configuration for frame extraction based on quality preference
 */
export interface FrameExtractionConfig {
  /** Target resolution width */
  width: number;
  /** Target resolution height */
  height: number;
  /** JPEG quality (1-100) */
  quality: number;
  /** Frames per minute based on video duration */
  framesPerDurationBucket: {
    short: number; // <15 min: 8 frames
    medium: number; // 15-45 min: 15 frames
    long: number; // >45 min: 20 frames
  };
}

/**
 * Quality First configuration (user selected)
 */
export const QUALITY_FIRST_CONFIG: FrameExtractionConfig = {
  width: 1280,
  height: 720,
  quality: 85,
  framesPerDurationBucket: {
    short: 8,
    medium: 15,
    long: 20,
  },
};

/**
 * Balanced configuration (alternative)
 */
export const BALANCED_CONFIG: FrameExtractionConfig = {
  width: 640,
  height: 480,
  quality: 70,
  framesPerDurationBucket: {
    short: 5,
    medium: 10,
    long: 15,
  },
};

/**
 * Cost-optimized configuration (alternative)
 */
export const COST_OPTIMIZED_CONFIG: FrameExtractionConfig = {
  width: 640,
  height: 480,
  quality: 60,
  framesPerDurationBucket: {
    short: 3,
    medium: 5,
    long: 8,
  },
};

/**
 * Result of video metadata extraction
 */
export interface VideoMetadata {
  duration: number; // seconds
  width: number;
  height: number;
  fps: number;
  codec: string;
  bitrate?: number;
  size?: number;
}

/**
 * Result of frame extraction
 */
export interface ExtractedFrame {
  index: number;
  timestamp: number; // seconds into the video
  filepath: string;
  base64: string;
  width: number;
  height: number;
  sizeBytes: number;
}

/**
 * Result of the full frame extraction process
 */
export interface FrameExtractionResult {
  videoId: string;
  videoPath: string;
  metadata: VideoMetadata;
  frames: ExtractedFrame[];
  tempDir: string;
  totalExtractionTimeMs: number;
  config: FrameExtractionConfig;
}

/**
 * Service for processing video files and extracting frames for AI analysis
 */
export class VideoProcessingService {
  private config: FrameExtractionConfig;

  constructor(config: FrameExtractionConfig = QUALITY_FIRST_CONFIG) {
    this.config = config;
  }

  /**
   * Get video metadata (duration, resolution, etc.)
   */
  async getVideoMetadata(videoPath: string): Promise<VideoMetadata> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          reject(new Error(`Failed to get video metadata: ${err.message}`));
          return;
        }

        const videoStream = metadata.streams.find((s) => s.codec_type === 'video');
        if (!videoStream) {
          reject(new Error('No video stream found in file'));
          return;
        }

        resolve({
          duration: metadata.format.duration || 0,
          width: videoStream.width || 0,
          height: videoStream.height || 0,
          fps: eval(videoStream.r_frame_rate || '0') || 0,
          codec: videoStream.codec_name || 'unknown',
          bitrate: metadata.format.bit_rate ? parseInt(String(metadata.format.bit_rate)) : undefined,
          size: metadata.format.size ? parseInt(String(metadata.format.size)) : undefined,
        });
      });
    });
  }

  /**
   * Calculate number of frames to extract based on video duration
   */
  calculateFrameCount(durationSeconds: number): number {
    const durationMinutes = durationSeconds / 60;

    if (durationMinutes < 15) {
      return this.config.framesPerDurationBucket.short;
    } else if (durationMinutes < 45) {
      return this.config.framesPerDurationBucket.medium;
    } else {
      return this.config.framesPerDurationBucket.long;
    }
  }

  /**
   * Calculate timestamps for frame extraction (evenly distributed)
   */
  calculateFrameTimestamps(durationSeconds: number, frameCount: number): number[] {
    const timestamps: number[] = [];

    // Skip first and last 5% to avoid intro/outro
    const startOffset = durationSeconds * 0.05;
    const endOffset = durationSeconds * 0.95;
    const effectiveDuration = endOffset - startOffset;

    // Distribute frames evenly across the video
    const interval = effectiveDuration / (frameCount - 1);

    for (let i = 0; i < frameCount; i++) {
      const timestamp = startOffset + i * interval;
      timestamps.push(Math.round(timestamp * 10) / 10); // Round to 1 decimal
    }

    return timestamps;
  }

  /**
   * Extract a single frame at a specific timestamp
   */
  async extractFrame(
    videoPath: string,
    timestamp: number,
    outputPath: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .seekInput(timestamp)
        .frames(1)
        .outputOptions(['-vf', `scale=${this.config.width}:${this.config.height}`])
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(new Error(`Frame extraction failed at ${timestamp}s: ${err.message}`)))
        .run();
    });
  }

  /**
   * Convert image to optimized base64 string
   */
  async imageToBase64(imagePath: string): Promise<{ base64: string; sizeBytes: number }> {
    const optimized = await sharp(imagePath)
      .jpeg({ quality: this.config.quality })
      .toBuffer();

    return {
      base64: optimized.toString('base64'),
      sizeBytes: optimized.length,
    };
  }

  /**
   * Check if a frame is likely a blank/black screen or duplicate
   */
  async isLowQualityFrame(imagePath: string): Promise<boolean> {
    try {
      const stats = await sharp(imagePath).stats();

      // Check if the image is too dark (mostly black)
      const avgBrightness =
        (stats.channels[0].mean + stats.channels[1].mean + stats.channels[2].mean) / 3;
      if (avgBrightness < 10) {
        return true; // Too dark
      }

      // Check if the image has very low variance (solid color/blank)
      const avgStdDev =
        (stats.channels[0].stdev + stats.channels[1].stdev + stats.channels[2].stdev) / 3;
      if (avgStdDev < 5) {
        return true; // Too uniform (likely blank)
      }

      return false;
    } catch {
      return false; // If we can't check, assume it's OK
    }
  }

  /**
   * Extract all frames from a video for AI analysis
   */
  async extractFrames(videoPath: string, videoId: string): Promise<FrameExtractionResult> {
    const startTime = Date.now();

    // Create temp directory for frames
    const tempDir = path.join(os.tmpdir(), 'cognivio-frames', videoId);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Get video metadata
    const metadata = await this.getVideoMetadata(videoPath);

    // Calculate frames to extract
    const frameCount = this.calculateFrameCount(metadata.duration);
    const timestamps = this.calculateFrameTimestamps(metadata.duration, frameCount);

    // Extract frames
    const frames: ExtractedFrame[] = [];
    let extractedIndex = 0;

    for (let i = 0; i < timestamps.length; i++) {
      const timestamp = timestamps[i];
      const framePath = path.join(tempDir, `frame_${i.toString().padStart(3, '0')}.jpg`);

      try {
        // Extract frame
        await this.extractFrame(videoPath, timestamp, framePath);

        // Check if frame is low quality
        const isLowQuality = await this.isLowQualityFrame(framePath);
        if (isLowQuality) {
          console.log(`Skipping low-quality frame at ${timestamp}s`);
          fs.unlinkSync(framePath);
          continue;
        }

        // Convert to base64
        const { base64, sizeBytes } = await this.imageToBase64(framePath);

        frames.push({
          index: extractedIndex++,
          timestamp,
          filepath: framePath,
          base64,
          width: this.config.width,
          height: this.config.height,
          sizeBytes,
        });
      } catch (error) {
        console.error(`Failed to extract frame at ${timestamp}s:`, error);
        // Continue with other frames
      }
    }

    // Ensure we have at least some frames
    if (frames.length < 3) {
      throw new Error(
        `Insufficient frames extracted: ${frames.length}. Minimum required: 3`
      );
    }

    const totalExtractionTimeMs = Date.now() - startTime;

    return {
      videoId,
      videoPath,
      metadata,
      frames,
      tempDir,
      totalExtractionTimeMs,
      config: this.config,
    };
  }

  /**
   * Clean up temporary frame files
   */
  async cleanup(result: FrameExtractionResult): Promise<void> {
    try {
      if (fs.existsSync(result.tempDir)) {
        fs.rmSync(result.tempDir, { recursive: true, force: true });
      }
    } catch (error) {
      console.error('Failed to cleanup temp frames:', error);
    }
  }

  /**
   * Get frame extraction statistics
   */
  getExtractionStats(result: FrameExtractionResult): {
    totalFrames: number;
    totalSizeBytes: number;
    avgFrameSizeBytes: number;
    extractionTimeMs: number;
    videoDuration: number;
    coverage: number; // percentage of video covered
  } {
    const totalSizeBytes = result.frames.reduce((sum, f) => sum + f.sizeBytes, 0);
    const firstTimestamp = result.frames[0]?.timestamp || 0;
    const lastTimestamp = result.frames[result.frames.length - 1]?.timestamp || 0;
    const coverage = ((lastTimestamp - firstTimestamp) / result.metadata.duration) * 100;

    return {
      totalFrames: result.frames.length,
      totalSizeBytes,
      avgFrameSizeBytes: Math.round(totalSizeBytes / result.frames.length),
      extractionTimeMs: result.totalExtractionTimeMs,
      videoDuration: result.metadata.duration,
      coverage: Math.round(coverage * 10) / 10,
    };
  }
}

// Export singleton instance with Quality First config (user preference)
export const videoProcessingService = new VideoProcessingService(QUALITY_FIRST_CONFIG);
