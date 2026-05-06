# Cognivio - AI-Powered Teacher Assessment Platform

## Project Overview
Cognivio is a Teacher Assessment Platform that uses AI-powered video analysis to evaluate teacher performance against educational frameworks (Danielson and Marshall Teacher Evaluation Rubrics). Administrators upload classroom videos which are analyzed by GPT-5.2 vision model to provide structured feedback on teaching effectiveness.

## Tech Stack

### Frontend
- **Framework**: React (Create React App with Craco)
- **Styling**: Tailwind CSS + shadcn/ui (New York style)
- **Icons**: lucide-react
- **Path Alias**: `@/` → `src/`
- **Toasts**: Sonner

### Backend
- **Framework**: FastAPI (Python, async)
- **Database**: MongoDB with Motor async driver
- **Auth**: JWT (HS256, 24h expiration) + bcrypt
- **AI**: Emergent LLM API (GPT-5.2 vision model)
- **Video Processing**: OpenCV for frame extraction

## Project Structure
```
/frontend          # React application
  /src             # Source code
/backend           # FastAPI application
  server.py        # Main API server (~1078 lines)
  /uploads         # Video file storage
/tests             # Test suite
```

## Commands

### Frontend
```bash
cd frontend
npm install        # Install dependencies
npm start          # Dev server on localhost:3000
npm test           # Run tests (Jest)
npm run build      # Production build
```

### Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn server:app --reload    # Dev server on localhost:8000
```

## Environment Variables

### Frontend (.env)
- `REACT_APP_BACKEND_URL` - Backend API URL
- `WDS_SOCKET_PORT` - Dev server socket port

### Backend (.env)
- `MONGO_URL` - MongoDB connection string
- `DB_NAME` - Database name
- `JWT_SECRET` - JWT signing secret
- `EMERGENT_LLM_KEY` - AI API key
- `CORS_ORIGINS` - Allowed CORS origins

## Code Conventions

### Frontend
- Named exports for components, default exports for pages
- Use `@/` path alias for imports from src
- Use existing shadcn/ui components from `@/components/ui/`
- Tailwind utility classes for styling
- `data-testid` attributes for testing

### Backend
- Async/await for all I/O operations
- Pydantic models for data validation
- HTTPException for error responses
- Routes prefixed with `/api`
- Enums for FrameworkType and PerformanceLevel

## Key API Routes
- `POST /api/auth/register` & `/api/auth/login` - Authentication
- `GET /api/frameworks` - List evaluation frameworks
- `POST /api/videos/upload` - Upload video for AI analysis
- `GET /api/assessments` - List teacher assessments
- `GET /api/teachers/{id}/dashboard` - Teacher performance dashboard
- `POST /api/seed-demo-data` - Seed demo data for testing

## Design System
- **Primary**: Cognivio Indigo (#4F46E5)
- **Typography**: Manrope (headings), Public Sans (body), JetBrains Mono (code)
- **Performance Colors**: Green (Excellent), Yellow (Needs Improvement), Red (Critical)
- **Layout**: Sidebar navigation + main content area
- **Grid**: `grid-cols-1 md:grid-cols-12`

## Testing
- Frontend: Jest via `npm test`
- Backend: Pytest (`pytest` in backend directory)
- Test tracking: `test_result.md` (YAML format)

## Database Collections
- `users` - User accounts
- `teachers` - Teacher records
- `videos` - Uploaded videos
- `assessments` - AI-generated assessments
- `framework_selections` - User framework preferences

## Video Processing Flow
1. Video uploaded to `/backend/uploads/`
2. OpenCV extracts 5 frames
3. Frames converted to base64
4. Sent to GPT-5.2 vision model for analysis
5. Structured assessment stored in MongoDB
6. Performance scores calculated (1-4 scale)
