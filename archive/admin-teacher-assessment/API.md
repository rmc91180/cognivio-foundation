# API Documentation

Base URL: `http://localhost:8000/api`

## Authentication

All protected endpoints require a JWT token in the Authorization header:

```
Authorization: Bearer <token>
```

---

## Auth Endpoints

### POST /api/auth/login

Authenticate a user and receive a JWT token.

**Request Body:**
```json
{
  "email": "admin@cognivio.demo",
  "password": "demo123"
}
```

**Response (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "email": "admin@cognivio.demo",
    "name": "Demo Admin",
    "roles": ["admin", "observer"],
    "activeRole": "admin"
  }
}
```

**Error (401):**
```json
{
  "error": "Invalid credentials"
}
```

### POST /api/auth/sso/:provider

Initiate SSO login (stub).

**Parameters:**
- `provider`: `google` | `microsoft`

**Response (200):**
```json
{
  "message": "SSO stub - would redirect to provider",
  "provider": "google"
}
```

### POST /api/auth/role

Switch active role for current user.

**Request Body:**
```json
{
  "role": "observer"
}
```

**Response (200):**
```json
{
  "user": {
    "id": "uuid",
    "activeRole": "observer"
  }
}
```

---

## Dashboard Endpoints

### GET /api/dashboard/summary

Get dashboard statistics.

**Response (200):**
```json
{
  "teacherCount": 8,
  "observationCount": 24,
  "pendingReviews": 5,
  "averageScore": 76.5,
  "statusDistribution": {
    "green": 3,
    "yellow": 3,
    "red": 2
  }
}
```

---

## Rubric Endpoints

### GET /api/rubrics/templates

List all rubric templates.

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 20)

**Response (200):**
```json
{
  "templates": [
    {
      "id": "uuid",
      "name": "Danielson Framework",
      "description": "Charlotte Danielson's Framework for Teaching",
      "elementCount": 22,
      "isBuiltIn": true,
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 2
  }
}
```

### GET /api/rubrics/templates/:id

Get a specific template with all elements.

**Response (200):**
```json
{
  "id": "uuid",
  "name": "Danielson Framework",
  "description": "Charlotte Danielson's Framework for Teaching",
  "elements": [
    {
      "id": "uuid",
      "code": "1a",
      "name": "Demonstrating Knowledge of Content and Pedagogy",
      "domain": "Planning and Preparation",
      "description": "Teacher displays solid knowledge...",
      "weight": 1.0
    }
  ]
}
```

### POST /api/rubrics/templates

Create a new custom template.

**Request Body:**
```json
{
  "name": "My Custom Framework",
  "description": "Custom evaluation criteria",
  "elements": [
    {
      "code": "C1",
      "name": "Custom Element 1",
      "domain": "Custom Domain",
      "description": "Description...",
      "weight": 1.0
    }
  ]
}
```

**Response (201):**
```json
{
  "id": "uuid",
  "name": "My Custom Framework",
  "createdAt": "2024-01-15T10:30:00Z"
}
```

### GET /api/rubrics/columns

Get metric column configuration for active template.

**Response (200):**
```json
{
  "columns": [
    {
      "id": "uuid",
      "name": "Instruction",
      "position": 0,
      "elementIds": ["uuid1", "uuid2"]
    },
    {
      "id": "uuid",
      "name": "Assessment",
      "position": 1,
      "elementIds": ["uuid3"]
    }
  ]
}
```

### PUT /api/rubrics/columns

Update column configuration.

**Request Body:**
```json
{
  "columns": [
    {
      "id": "uuid",
      "name": "Instruction",
      "position": 0,
      "elementIds": ["uuid1", "uuid2", "uuid5"]
    }
  ]
}
```

**Response (200):**
```json
{
  "success": true
}
```

---

## Roster Endpoints

### GET /api/roster

Get teacher roster with aggregated metrics.

**Query Parameters:**
- `sort` (optional): Sort field (`name`, `score`, `status`)
- `order` (optional): Sort order (`asc`, `desc`)
- `status` (optional): Filter by status (`green`, `yellow`, `red`)
- `search` (optional): Search by name
- `page` (optional): Page number
- `limit` (optional): Items per page

**Response (200):**
```json
{
  "teachers": [
    {
      "id": "uuid",
      "name": "Sarah Johnson",
      "email": "sjohnson@school.edu",
      "department": "Mathematics",
      "overallScore": 85,
      "overallStatus": "green",
      "columns": [
        {
          "columnId": "uuid",
          "columnName": "Instruction",
          "score": 88,
          "status": "green"
        },
        {
          "columnId": "uuid",
          "columnName": "Assessment",
          "score": 72,
          "status": "yellow"
        }
      ],
      "lastObservation": "2024-01-10T14:30:00Z",
      "gradebookFlag": false
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 8
  }
}
```

---

## Teacher Endpoints

### GET /api/teachers/:id

Get detailed teacher information.

**Response (200):**
```json
{
  "id": "uuid",
  "name": "Sarah Johnson",
  "email": "sjohnson@school.edu",
  "department": "Mathematics",
  "hireDate": "2020-08-15",
  "overallScore": 85,
  "overallStatus": "green"
}
```

### GET /api/teachers/:id/elements

Get element-level scores for a teacher.

**Response (200):**
```json
{
  "elements": [
    {
      "elementId": "uuid",
      "code": "1a",
      "name": "Knowledge of Content",
      "domain": "Planning and Preparation",
      "score": 90,
      "status": "green",
      "trend": "improving",
      "observationCount": 3,
      "lastObserved": "2024-01-10T14:30:00Z"
    }
  ]
}
```

### GET /api/teachers/:id/observations

Get AI observations for a teacher.

**Query Parameters:**
- `status` (optional): Filter by review status (`pending`, `accepted`, `rejected`, `edited`)
- `elementId` (optional): Filter by element

**Response (200):**
```json
{
  "observations": [
    {
      "id": "uuid",
      "elementId": "uuid",
      "elementCode": "1a",
      "elementName": "Knowledge of Content",
      "videoId": "uuid",
      "timestamp": "00:05:32",
      "score": 85,
      "confidence": 0.92,
      "evidence": "Teacher demonstrated strong content knowledge when explaining quadratic equations, using multiple representations.",
      "reviewStatus": "pending",
      "reviewedAt": null,
      "reviewedBy": null,
      "createdAt": "2024-01-10T14:30:00Z"
    }
  ]
}
```

### GET /api/teachers/:id/trends

Get performance trend data for charts.

**Query Parameters:**
- `period` (optional): `week`, `month`, `quarter`, `year`

**Response (200):**
```json
{
  "trends": [
    {
      "date": "2024-01-01",
      "score": 78
    },
    {
      "date": "2024-01-08",
      "score": 82
    }
  ]
}
```

---

## AI Observation Endpoints

### POST /api/ai/observations/:id/review

Review an AI observation.

**Request Body:**
```json
{
  "action": "accept" | "reject" | "edit",
  "reason": "Optional reason for rejection",
  "editedScore": 80,
  "editedEvidence": "Updated evidence text"
}
```

**Response (200):**
```json
{
  "id": "uuid",
  "reviewStatus": "accepted",
  "reviewedAt": "2024-01-15T10:30:00Z",
  "reviewedBy": "uuid"
}
```

### GET /api/ai/pending

Get all pending AI observations.

**Response (200):**
```json
{
  "observations": [
    {
      "id": "uuid",
      "teacherName": "Sarah Johnson",
      "elementCode": "1a",
      "score": 85,
      "confidence": 0.92,
      "evidence": "...",
      "createdAt": "2024-01-10T14:30:00Z"
    }
  ],
  "count": 5
}
```

---

## Video Endpoints

### POST /api/videos/upload

Upload a video for AI analysis (stub).

**Request:**
- Content-Type: `multipart/form-data`
- Body: `file` (video file), `teacherId` (uuid)

**Response (202):**
```json
{
  "videoId": "uuid",
  "status": "processing",
  "message": "Video queued for AI analysis"
}
```

### GET /api/videos/:id/status

Check video processing status.

**Response (200):**
```json
{
  "videoId": "uuid",
  "status": "completed" | "processing" | "failed",
  "progress": 100,
  "observationCount": 5
}
```

---

## Gradebook Endpoints

### GET /api/gradebook/status/:teacherId

Get gradebook integration status (stub).

**Response (200):**
```json
{
  "teacherId": "uuid",
  "connected": true,
  "lastSync": "2024-01-14T08:00:00Z",
  "flags": [
    {
      "type": "missing_grades",
      "count": 3,
      "description": "3 assignments without grades"
    }
  ]
}
```

---

## Settings Endpoints

### GET /api/settings/thresholds

Get color threshold configuration.

**Response (200):**
```json
{
  "greenMin": 80,
  "yellowMin": 60,
  "redMax": 60,
  "aggregationMode": "weighted"
}
```

### PUT /api/settings/thresholds

Update color thresholds.

**Request Body:**
```json
{
  "greenMin": 85,
  "yellowMin": 65,
  "aggregationMode": "worst_score"
}
```

**Response (200):**
```json
{
  "success": true
}
```

### GET /api/settings/pinned-elements

Get pinned elements configuration.

**Response (200):**
```json
{
  "pinnedElements": ["uuid1", "uuid2"]
}
```

### PUT /api/settings/pinned-elements

Update pinned elements.

**Request Body:**
```json
{
  "elementIds": ["uuid1", "uuid2", "uuid3"]
}
```

---

## Audit Endpoints

### GET /api/audit

Get audit log entries.

**Query Parameters:**
- `action` (optional): Filter by action type
- `userId` (optional): Filter by user
- `startDate` (optional): Start date filter
- `endDate` (optional): End date filter
- `page` (optional): Page number
- `limit` (optional): Items per page

**Response (200):**
```json
{
  "entries": [
    {
      "id": "uuid",
      "userId": "uuid",
      "userName": "Demo Admin",
      "action": "observation_reviewed",
      "details": {
        "observationId": "uuid",
        "action": "accept"
      },
      "ipAddress": "127.0.0.1",
      "createdAt": "2024-01-15T10:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 125
  }
}
```

---

## Error Responses

All endpoints may return these error responses:

### 400 Bad Request
```json
{
  "error": "Validation error",
  "details": ["Email is required", "Password must be at least 8 characters"]
}
```

### 401 Unauthorized
```json
{
  "error": "Unauthorized",
  "message": "Invalid or expired token"
}
```

### 403 Forbidden
```json
{
  "error": "Forbidden",
  "message": "Insufficient permissions"
}
```

### 404 Not Found
```json
{
  "error": "Not found",
  "message": "Teacher not found"
}
```

### 500 Internal Server Error
```json
{
  "error": "Internal server error",
  "message": "An unexpected error occurred"
}
```
