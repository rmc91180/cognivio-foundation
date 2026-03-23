# Admin Teacher Assessment Platform

A comprehensive teacher assessment platform that uses AI-powered video analysis to evaluate teaching performance against educational frameworks (Danielson and Marshall rubrics).

## Features

- **Screen 1: Homepage Dashboard** - Quick stats showing teacher counts, pending observations, and performance overview
- **Screen 2: Authentication** - Secure login with email/password and SSO stubs (Google, Microsoft)
- **Screen 3: Framework Selection** - Choose from Danielson, Marshall, or create custom evaluation rubrics
- **Screen 4: Element Selection Pane** - Drag-and-drop interface to assign rubric elements to metric columns
- **Screen 5: Color-coded Teacher Roster** - At-a-glance view of all teachers with green/yellow/red status indicators
- **Screen 6: Teacher Dashboard** - Detailed analysis with AI observations, element scores, and performance trends

## Tech Stack

- **Frontend**: React + TypeScript, Vite, Tailwind CSS, Zustand
- **Backend**: Node.js + Express + TypeScript
- **Database**: PostgreSQL with Knex.js migrations
- **Testing**: Jest (unit), Playwright (E2E)
- **Containerization**: Docker + Docker Compose

## Prerequisites

- Node.js 20+
- PostgreSQL 15+ (or Docker)
- npm 9+

## Quick Start with Docker

The fastest way to get started:

```bash
# Clone the repository
git clone <repository-url>
cd admin-teacher-assessment

# Start all services
docker-compose up -d

# Access the application
# Frontend: http://localhost:5173
# Backend API: http://localhost:8000
```

## Manual Setup

### 1. Database Setup

```bash
# Create PostgreSQL database
createdb teacher_assessment

# Or use Docker
docker run -d \
  --name postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=teacher_assessment \
  -p 5432:5432 \
  postgres:15-alpine
```

### 2. Backend Setup

```bash
cd server

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your database credentials
# DATABASE_URL=postgresql://postgres:postgres@localhost:5432/teacher_assessment

# Run migrations
npm run migrate

# Seed demo data
npm run seed

# Start development server
npm run dev
```

### 3. Frontend Setup

```bash
cd client

# Install dependencies
npm install

# Start development server
npm run dev
```

### 4. Access the Application

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000

## Demo Credentials

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@cognivio.demo | demo123 |
| Observer | observer@cognivio.demo | demo123 |

## Project Structure

```
admin-teacher-assessment/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/     # React components
│   │   │   ├── screens/    # Page components
│   │   │   ├── shared/     # Layout components
│   │   │   └── ui/         # Reusable UI components
│   │   ├── services/       # API client
│   │   ├── store/          # Zustand stores
│   │   └── types/          # TypeScript types
│   └── package.json
├── server/                 # Express backend
│   ├── src/
│   │   ├── routes/         # API routes
│   │   ├── services/       # Business logic
│   │   ├── middleware/     # Express middleware
│   │   ├── workers/        # Background workers
│   │   └── utils/          # Utilities
│   ├── migrations/         # Knex migrations
│   ├── seeds/              # Seed data
│   └── package.json
├── e2e/                    # Playwright E2E tests
├── docker-compose.yml      # Docker orchestration
└── README.md
```

## API Documentation

See [API.md](./API.md) for complete API documentation.

## Available Scripts

### Server

```bash
npm run dev          # Start development server with hot reload
npm run build        # Build for production
npm run start        # Start production server
npm run migrate      # Run database migrations
npm run migrate:down # Rollback last migration
npm run seed         # Seed demo data
npm run test         # Run unit tests
npm run test:watch   # Run tests in watch mode
```

### Client

```bash
npm run dev          # Start Vite development server
npm run build        # Build for production
npm run preview      # Preview production build
npm run test         # Run unit tests
npm run lint         # Run ESLint
```

### E2E Tests

```bash
cd e2e
npm install
npm test             # Run all E2E tests
npm run test:headed  # Run with browser visible
npm run test:ui      # Run with Playwright UI
```

## Environment Variables

### Server (.env)

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/teacher_assessment
JWT_SECRET=your-super-secret-jwt-key-change-in-production
PORT=8000
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173
```

### Client (.env)

```env
VITE_API_URL=http://localhost:8000
```

## Color Aggregation

The platform uses a sophisticated color aggregation system:

| Score Range | Color | Meaning |
|-------------|-------|---------|
| 80-100 | Green | Excellent performance |
| 60-79 | Yellow | Needs improvement |
| 0-59 | Red | Critical attention needed |

Aggregation modes:
- **Weighted Average**: Default mode, calculates weighted mean of element scores
- **Worst Score**: Shows the lowest score in the group
- **Majority Color**: Shows the most common color status

## AI Video Analysis

The platform includes an AI stub worker that simulates video analysis. In production, this would connect to GPT-5.2 vision model to:

1. Extract frames from uploaded classroom videos
2. Analyze teaching behaviors against rubric elements
3. Generate observations with evidence and confidence scores
4. Flag observations for human review

## License

MIT
