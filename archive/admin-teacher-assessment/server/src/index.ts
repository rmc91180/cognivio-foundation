import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import session from 'express-session';
import passport from 'passport';
import { configurePassport } from './config/passport';

// Load environment variables
dotenv.config();

// Configure Passport strategies
configurePassport();

// Import routes
import authRoutes from './routes/auth';
import dashboardRoutes from './routes/dashboard';
import rubricRoutes from './routes/rubrics';
import rosterRoutes from './routes/roster';
import teacherRoutes from './routes/teachers';
import aiRoutes from './routes/ai';
import videoRoutes from './routes/video';
import gradebookRoutes from './routes/gradebook';
import settingsRoutes from './routes/settings';
import auditRoutes from './routes/audit';
import notesRoutes from './routes/notes';
import feedbackRoutes from './routes/feedback';
// AI Learning & Feedback Loop routes
import aiSuggestionsRoutes from './routes/aiSuggestions';
import teacherFeedbackRoutes from './routes/teacherFeedback';
import trendsRoutes from './routes/trends';

const app = express();
const PORT = process.env.PORT || 8000;
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  throw new Error('SESSION_SECRET environment variable is required. Refusing to start.');
}

// Middleware
// In development, allow multiple frontend ports (Vite may use different ports)
const corsOrigin = process.env.NODE_ENV === 'production'
  ? process.env.CORS_ORIGIN
  : (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) return callback(null, true);
      // Allow any localhost port in development
      if (origin.startsWith('http://localhost:')) {
        return callback(null, true);
      }
      callback(new Error('Not allowed by CORS'));
    };

app.use(cors({
  origin: corsOrigin as any,
  credentials: true,
}));
app.use(express.json());

// Session middleware (required for OAuth state management)
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000, // 10 minutes (short-lived for OAuth state only)
  },
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Request logging (development)
if (process.env.NODE_ENV !== 'production') {
  app.use((req: Request, res: Response, next: NextFunction) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
    next();
  });
}

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/rubrics', rubricRoutes);
app.use('/api/roster', rosterRoutes);
app.use('/api/teachers', teacherRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/video', videoRoutes);
app.use('/api/gradebook', gradebookRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/notes', notesRoutes);
app.use('/api/feedback', feedbackRoutes);
// AI Learning & Feedback Loop routes
app.use('/api/ai/suggestions', aiSuggestionsRoutes);
app.use('/api/feedback/teacher', teacherFeedbackRoutes);
app.use('/api/trends', trendsRoutes);
// AI Learning & Feedback Loop routes
app.use('/api/ai/suggestions', aiSuggestionsRoutes);
app.use('/api/feedback/teacher', teacherFeedbackRoutes);
app.use('/api/trends', trendsRoutes);

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    },
  });
});

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'production'
        ? 'An internal error occurred'
        : err.message,
    },
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`
  =============================================
  🚀 Teacher Assessment API Server
  =============================================

  Server running on http://localhost:${PORT}
  Environment: ${process.env.NODE_ENV || 'development'}

  API Endpoints:
  - POST /api/auth/login
  - GET  /api/auth/google (SSO)
  - GET  /api/auth/microsoft (SSO)
  - GET  /api/auth/sso/status
  - GET  /api/dashboard/summary
  - GET  /api/rubrics/templates
  - GET  /api/rubrics/elements
  - POST /api/rubrics/templates
  - GET  /api/roster
  - GET  /api/teachers/:id/detail
  - POST /api/ai/review
  - POST /api/video/upload
  - GET  /api/video/:id/analysis (AI analysis)
  - GET  /api/gradebook/status
  - GET  /api/settings/thresholds
  - GET  /api/audit
  - GET  /api/notes (user notes on observations)
  - POST /api/notes
  - GET  /api/feedback (AI feedback loop)
  - POST /api/feedback
  - GET  /api/feedback/analytics (AI training insights)

  AI Learning & Feedback Loop:
  - GET  /api/ai/suggestions (pending suggestions)
  - POST /api/ai/suggestions/generate/:teacherId
  - POST /api/ai/suggestions/:id/accept
  - POST /api/ai/suggestions/:id/reject
  - GET  /api/ai/suggestions/history/:teacherId
  - GET  /api/ai/suggestions/model/version
  - POST /api/feedback/teacher (send feedback)
  - GET  /api/feedback/teacher/:teacherId
  - GET  /api/feedback/teacher/:teacherId/unread
  - GET  /api/trends/teacher/:teacherId
  - GET  /api/trends/teacher/:teacherId/alerts
  - GET  /api/trends/teacher/:teacherId/predicted-risk
  - GET  /api/trends/school

  Health check: GET /health
  =============================================
  `);
});

export default app;
