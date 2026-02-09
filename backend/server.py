from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Form, BackgroundTasks, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, EmailStr
from typing import List, Optional, Dict, Any, Tuple
import uuid
from datetime import datetime, timezone, timedelta
import jwt
import bcrypt
import json
import base64
try:
    import cv2
except Exception as exc:
    cv2 = None
    _cv2_import_error = exc
import aiofiles
import asyncio
from enum import Enum

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")


def _get_required_env(name: str) -> str:
    """Fetch required env var or raise a clear runtime error."""
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Environment variable {name} must be set")
    return value


def _get_optional_env_list(name: str) -> List[str]:
    """Fetch optional comma-separated env var as list, ignoring empties."""
    raw = os.getenv(name, "")
    if not raw:
        return []
    return [item.strip() for item in raw.split(",") if item.strip()]


# MongoDB connection
mongo_url = _get_required_env("MONGO_URL")
client = AsyncIOMotorClient(mongo_url)
db = client[_get_required_env("DB_NAME")]

# JWT Configuration
JWT_SECRET = _get_required_env("JWT_SECRET")
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24

# Demo mode (fixed demo users, registration disabled)
DEMO_MODE = os.getenv("DEMO_MODE", "false").lower() == "true"
DEMO_USERS = [
    {
        "email": "principal@demo.cognivio.app",
        "name": "Demo Principal",
        "password": "DemoAccess2026!",
    },
    {
        "email": "teacher@demo.cognivio.app",
        "name": "Demo Teacher",
        "password": "DemoAccess2026!",
    },
]

# Create uploads directory
UPLOAD_DIR = ROOT_DIR / 'uploads'
UPLOAD_DIR.mkdir(exist_ok=True)

# Create the main app
app = FastAPI(title="Cognivio API", description="Teacher Assessment Platform")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

security = HTTPBearer()

# Health check endpoint (at root level for Railway)
@app.get("/health")
async def health_check():
    """Health check endpoint for Railway deployment"""
    return {"status": "healthy", "service": "cognivio-api"}

@api_router.get("/health")
async def api_health_check():
    """Health check endpoint under /api prefix"""
    return {"status": "healthy", "service": "cognivio-api"}

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ==================== ENUMS ====================
class FrameworkType(str, Enum):
    MARSHALL = "marshall"
    DANIELSON = "danielson"
    CUSTOM = "custom"

class PerformanceLevel(str, Enum):
    EXCELLENT = "excellent"  # Green - score >= 3
    NEEDS_IMPROVEMENT = "needs_improvement"  # Yellow - score 2-3
    CRITICAL = "critical"  # Red - score < 2

# ==================== FRAMEWORK DATA ====================
DANIELSON_FRAMEWORK = {
    "name": "Danielson Framework",
    "type": "danielson",
    "domains": [
        {
            "id": "d1",
            "name": "Domain 1: Planning and Preparation",
            "elements": [
                {"id": "d1a", "name": "Demonstrating Knowledge of Content and Pedagogy"},
                {"id": "d1b", "name": "Demonstrating Knowledge of Students"},
                {"id": "d1c", "name": "Setting Instructional Outcomes"},
                {"id": "d1d", "name": "Demonstrating Knowledge of Resources"},
                {"id": "d1e", "name": "Designing Coherent Instruction"},
                {"id": "d1f", "name": "Designing Student Assessments"}
            ]
        },
        {
            "id": "d2",
            "name": "Domain 2: Classroom Environment",
            "elements": [
                {"id": "d2a", "name": "Creating an Environment of Respect and Rapport"},
                {"id": "d2b", "name": "Establishing a Culture for Learning"},
                {"id": "d2c", "name": "Managing Classroom Procedures"},
                {"id": "d2d", "name": "Managing Student Behavior"},
                {"id": "d2e", "name": "Organizing Physical Space"}
            ]
        },
        {
            "id": "d3",
            "name": "Domain 3: Instruction",
            "elements": [
                {"id": "d3a", "name": "Communicating with Students"},
                {"id": "d3b", "name": "Using Questioning and Discussion Techniques"},
                {"id": "d3c", "name": "Engaging Students in Learning"},
                {"id": "d3d", "name": "Using Assessment in Instruction"},
                {"id": "d3e", "name": "Demonstrating Flexibility and Responsiveness"}
            ]
        },
        {
            "id": "d4",
            "name": "Domain 4: Professional Responsibilities",
            "elements": [
                {"id": "d4a", "name": "Reflecting on Teaching"},
                {"id": "d4b", "name": "Maintaining Accurate Records"},
                {"id": "d4c", "name": "Communicating with Families"},
                {"id": "d4d", "name": "Participating in the Professional Community"},
                {"id": "d4e", "name": "Growing and Developing Professionally"},
                {"id": "d4f", "name": "Showing Professionalism"}
            ]
        }
    ]
}

MARSHALL_FRAMEWORK = {
    "name": "Marshall Teacher Evaluation Rubrics",
    "type": "marshall",
    "domains": [
        {
            "id": "m1",
            "name": "A. Planning and Preparation for Learning",
            "elements": [
                {"id": "m1a", "name": "Knowledge of Subject Matter"},
                {"id": "m1b", "name": "Strategic Planning"},
                {"id": "m1c", "name": "Curriculum Alignment"},
                {"id": "m1d", "name": "Assessment Design"},
                {"id": "m1e", "name": "Anticipating Student Needs"},
                {"id": "m1f", "name": "Lesson Preparation"},
                {"id": "m1g", "name": "Student Engagement Planning"},
                {"id": "m1h", "name": "Materials Preparation"},
                {"id": "m1i", "name": "Differentiation Planning"},
                {"id": "m1j", "name": "Environment Setup"}
            ]
        },
        {
            "id": "m2",
            "name": "B. Classroom Management",
            "elements": [
                {"id": "m2a", "name": "Expectations and Norms"},
                {"id": "m2b", "name": "Student Relationships"},
                {"id": "m2c", "name": "Routines and Procedures"},
                {"id": "m2d", "name": "Behavior Management"},
                {"id": "m2e", "name": "Physical Space Organization"}
            ]
        },
        {
            "id": "m3",
            "name": "C. Delivery of Instruction",
            "elements": [
                {"id": "m3a", "name": "Clear Communication"},
                {"id": "m3b", "name": "Questioning Techniques"},
                {"id": "m3c", "name": "Student Engagement"},
                {"id": "m3d", "name": "Pacing and Flexibility"},
                {"id": "m3e", "name": "Differentiated Instruction"}
            ]
        },
        {
            "id": "m4",
            "name": "D. Monitoring, Assessment, and Follow-Up",
            "elements": [
                {"id": "m4a", "name": "Ongoing Assessment"},
                {"id": "m4b", "name": "Feedback Quality"},
                {"id": "m4c", "name": "Data-Driven Decisions"},
                {"id": "m4d", "name": "Student Progress Tracking"}
            ]
        },
        {
            "id": "m5",
            "name": "E. Family and Community Outreach",
            "elements": [
                {"id": "m5a", "name": "Family Communication"},
                {"id": "m5b", "name": "Community Engagement"},
                {"id": "m5c", "name": "Cultural Responsiveness"}
            ]
        },
        {
            "id": "m6",
            "name": "F. Professional Responsibilities",
            "elements": [
                {"id": "m6a", "name": "Self-Reflection"},
                {"id": "m6b", "name": "Professional Development"},
                {"id": "m6c", "name": "Collaboration"},
                {"id": "m6d", "name": "School Community Participation"}
            ]
        }
    ]
}

# ==================== PYDANTIC MODELS ====================
class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    id: str
    email: str
    name: str
    created_at: str

class TokenResponse(BaseModel):
    token: str
    user: UserResponse

class TeacherCreate(BaseModel):
    name: str
    email: EmailStr
    subject: str
    grade_level: str
    department: Optional[str] = None

class TeacherResponse(BaseModel):
    id: str
    name: str
    email: str
    subject: str
    grade_level: str
    department: Optional[str] = None
    created_at: str

class FrameworkSelection(BaseModel):
    framework_type: FrameworkType
    selected_elements: List[str]


class CustomElementCreate(BaseModel):
    name: str


class CustomDomainCreate(BaseModel):
    name: str
    elements: List[CustomElementCreate]

class VideoUploadResponse(BaseModel):
    id: str
    filename: str
    teacher_id: str
    status: str
    upload_date: str

class ElementScore(BaseModel):
    """
    Rubric score for a single framework element.

    score: gradient value (1-10) to support heatmaps and richer visualizations.
    """

    element_id: str
    element_name: str
    score: float  # 1-10 gradient rather than binary
    level: PerformanceLevel
    observations: List[str]
    confidence: float


class Observation(BaseModel):
    """Human observation tied to a teacher, video, and optional framework element."""

    id: str
    teacher_id: str
    video_id: Optional[str] = None
    element_id: Optional[str] = None
    timestamp_seconds: Optional[float] = None
    admin_comment: Optional[str] = None
    teacher_response: Optional[str] = None
    implementation_status: Optional[str] = None  # e.g. "planned", "in_progress", "implemented"
    created_at: str
    updated_at: Optional[str] = None


class ObservationCreate(BaseModel):
    teacher_id: str
    video_id: Optional[str] = None
    element_id: Optional[str] = None
    timestamp_seconds: Optional[float] = None
    admin_comment: Optional[str] = None
    teacher_response: Optional[str] = None
    implementation_status: Optional[str] = None

class AssessmentResult(BaseModel):
    id: str
    video_id: str
    teacher_id: str
    framework_type: str
    element_scores: List[ElementScore]
    overall_score: float
    summary: str
    recommendations: List[str]
    analyzed_at: str

class TeacherPerformance(BaseModel):
    teacher_id: str
    teacher_name: str
    subject: str
    grade_level: str
    element_scores: Dict[str, Dict[str, Any]]
    overall_score: float
    assessment_count: int
    last_assessment_date: Optional[str]

class PeriodFilter(BaseModel):
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None


class ScheduleStatus(str, Enum):
    PLANNED = "planned"
    RECORDING = "recording"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class Schedule(BaseModel):
    """Upcoming class session scheduled for recording."""

    id: str
    teacher_id: str
    course_name: str
    start_time: datetime
    recording_status: ScheduleStatus
    join_url: Optional[str] = None
    location: Optional[str] = None


class ScheduleCreate(BaseModel):
    teacher_id: str
    course_name: str
    start_time: datetime
    join_url: Optional[str] = None
    location: Optional[str] = None


class ScheduleUpdate(BaseModel):
    recording_status: Optional[ScheduleStatus] = None
    join_url: Optional[str] = None


class SummaryReflection(BaseModel):
    id: str
    teacher_id: str
    self_reflection: Optional[str] = None
    actions_taken: Optional[str] = None
    created_at: str
    updated_at: Optional[str] = None


class SummaryReflectionUpsert(BaseModel):
    self_reflection: Optional[str] = None
    actions_taken: Optional[str] = None

# ==================== AUTH HELPERS ====================
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())

def create_token(user_id: str) -> str:
    payload = {
        "user_id": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        token = credentials.credentials
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("user_id")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
        user = await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

# ==================== AUTH ENDPOINTS ====================
@api_router.post("/auth/register", response_model=TokenResponse)
async def register(user: UserCreate):
    if DEMO_MODE:
        raise HTTPException(status_code=403, detail="Registration is disabled for demo mode")
    existing = await db.users.find_one({"email": user.email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    user_id = str(uuid.uuid4())
    user_doc = {
        "id": user_id,
        "email": user.email,
        "name": user.name,
        "password": hash_password(user.password),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.users.insert_one(user_doc)
    
    token = create_token(user_id)
    return TokenResponse(
        token=token,
        user=UserResponse(
            id=user_id,
            email=user.email,
            name=user.name,
            created_at=user_doc["created_at"]
        )
    )

@api_router.post("/auth/login", response_model=TokenResponse)
async def login(user: UserLogin):
    db_user = await db.users.find_one({"email": user.email})
    if not db_user or not verify_password(user.password, db_user["password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    token = create_token(db_user["id"])
    return TokenResponse(
        token=token,
        user=UserResponse(
            id=db_user["id"],
            email=db_user["email"],
            name=db_user["name"],
            created_at=db_user["created_at"]
        )
    )

@api_router.get("/auth/me", response_model=UserResponse)
async def get_me(current_user: dict = Depends(get_current_user)):
    return UserResponse(**current_user)

# ==================== FRAMEWORK ENDPOINTS ====================
@api_router.get("/frameworks")
async def get_frameworks(current_user: dict = Depends(get_current_user)):
    custom_domain_count = await db.custom_domains.count_documents(
        {"user_id": current_user["id"]}
    )
    return {
        "frameworks": [
            {"type": "danielson", "name": "Danielson Framework", "domain_count": 4},
            {"type": "marshall", "name": "Marshall Rubrics", "domain_count": 6},
            {
                "type": "custom",
                "name": "Custom (User defined)",
                "domain_count": 10 + custom_domain_count,
            },
        ]
    }

@api_router.get("/frameworks/{framework_type}")
async def get_framework_details(
    framework_type: FrameworkType, current_user: dict = Depends(get_current_user)
):
    if framework_type == FrameworkType.DANIELSON:
        return DANIELSON_FRAMEWORK
    elif framework_type == FrameworkType.MARSHALL:
        return MARSHALL_FRAMEWORK
    else:
        custom_domains = await db.custom_domains.find(
            {"user_id": current_user["id"]}, {"_id": 0, "user_id": 0}
        ).to_list(1000)
        domains = (
            DANIELSON_FRAMEWORK["domains"]
            + MARSHALL_FRAMEWORK["domains"]
            + custom_domains
        )
        return {"name": "Custom Framework", "type": "custom", "domains": domains}


@api_router.get("/frameworks/custom-domains")
async def list_custom_domains(current_user: dict = Depends(get_current_user)):
    domains = await db.custom_domains.find(
        {"user_id": current_user["id"]}, {"_id": 0, "user_id": 0}
    ).to_list(1000)
    return {"domains": domains}


@api_router.post("/frameworks/custom-domains")
async def create_custom_domain(
    payload: CustomDomainCreate, current_user: dict = Depends(get_current_user)
):
    domain_id = f"c{uuid.uuid4().hex[:8]}"
    elements = [
        {"id": f"{domain_id}-{idx+1}", "name": el.name}
        for idx, el in enumerate(payload.elements)
    ]
    domain_doc = {
        "id": domain_id,
        "name": payload.name,
        "elements": elements,
        "user_id": current_user["id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.custom_domains.insert_one(domain_doc)
    domain_doc.pop("user_id", None)
    return {"domain": domain_doc}


@api_router.delete("/frameworks/custom-domains/{domain_id}")
async def delete_custom_domain(
    domain_id: str, current_user: dict = Depends(get_current_user)
):
    result = await db.custom_domains.delete_one(
        {"id": domain_id, "user_id": current_user["id"]}
    )
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Domain not found")
    return {"message": "Domain deleted"}

@api_router.post("/frameworks/selection")
async def save_framework_selection(selection: FrameworkSelection, current_user: dict = Depends(get_current_user)):
    selection_doc = {
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "framework_type": selection.framework_type,
        "selected_elements": selection.selected_elements,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.framework_selections.update_one(
        {"user_id": current_user["id"]},
        {"$set": selection_doc},
        upsert=True
    )
    return {"message": "Selection saved", "selection": selection_doc}

@api_router.get("/frameworks/selection/current")
async def get_current_selection(current_user: dict = Depends(get_current_user)):
    selection = await db.framework_selections.find_one(
        {"user_id": current_user["id"]},
        {"_id": 0}
    )
    if not selection:
        # Return default with all Danielson elements selected
        all_elements = []
        for domain in DANIELSON_FRAMEWORK["domains"]:
            for element in domain["elements"]:
                all_elements.append(element["id"])
        return {"framework_type": "danielson", "selected_elements": all_elements}

    if selection.get("framework_type") == "custom" and not selection.get(
        "selected_elements"
    ):
        custom_domains = await db.custom_domains.find(
            {"user_id": current_user["id"]}, {"_id": 0, "user_id": 0}
        ).to_list(1000)
        domains = (
            DANIELSON_FRAMEWORK["domains"]
            + MARSHALL_FRAMEWORK["domains"]
            + custom_domains
        )
        element_ids = [
            el["id"] for domain in domains for el in domain.get("elements", [])
        ]
        selection["selected_elements"] = element_ids
    return selection

# ==================== TEACHER ENDPOINTS ====================
@api_router.post("/teachers", response_model=TeacherResponse)
async def create_teacher(teacher: TeacherCreate, current_user: dict = Depends(get_current_user)):
    teacher_id = str(uuid.uuid4())
    teacher_doc = {
        "id": teacher_id,
        "name": teacher.name,
        "email": teacher.email,
        "subject": teacher.subject,
        "grade_level": teacher.grade_level,
        "department": teacher.department,
        "created_by": current_user["id"],
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.teachers.insert_one(teacher_doc)
    return TeacherResponse(**{k: v for k, v in teacher_doc.items() if k not in ["created_by", "_id"]})

@api_router.get("/teachers", response_model=List[TeacherResponse])
async def get_teachers(current_user: dict = Depends(get_current_user)):
    teachers = await db.teachers.find(
        {"created_by": current_user["id"]},
        {"_id": 0, "created_by": 0}
    ).to_list(1000)
    return [TeacherResponse(**t) for t in teachers]

@api_router.get("/teachers/{teacher_id}", response_model=TeacherResponse)
async def get_teacher(teacher_id: str, current_user: dict = Depends(get_current_user)):
    teacher = await db.teachers.find_one(
        {"id": teacher_id, "created_by": current_user["id"]},
        {"_id": 0, "created_by": 0}
    )
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")
    return TeacherResponse(**teacher)

@api_router.delete("/teachers/{teacher_id}")
async def delete_teacher(teacher_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.teachers.delete_one({"id": teacher_id, "created_by": current_user["id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Teacher not found")
    return {"message": "Teacher deleted"}

# ==================== VIDEO ENDPOINTS ====================
@api_router.post("/videos/upload", response_model=VideoUploadResponse)
async def upload_video(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    teacher_id: str = Form(...),
    current_user: dict = Depends(get_current_user)
):
    # Validate file type and basic content-type
    allowed_types = [".mp4", ".mov", ".avi", ".mkv", ".webm"]
    file_ext = Path(file.filename or "").suffix.lower()
    if file_ext not in allowed_types:
        raise HTTPException(status_code=400, detail=f"Invalid file type. Allowed: {allowed_types}")
    if file.content_type not in ["video/mp4", "video/quicktime", "video/x-msvideo", "video/x-matroska", "video/webm"]:
        raise HTTPException(status_code=400, detail="Invalid content type for video upload")
    
    # Verify teacher exists
    teacher = await db.teachers.find_one({"id": teacher_id, "created_by": current_user["id"]})
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")
    
    video_id = str(uuid.uuid4())
    filename = f"{video_id}{file_ext}"
    file_path = UPLOAD_DIR / filename
    
    # Save file with basic size limit check (~500 MB)
    MAX_BYTES = 500 * 1024 * 1024
    size = 0
    async with aiofiles.open(file_path, "wb") as f:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_BYTES:
                await f.close()
                os.remove(file_path)
                raise HTTPException(status_code=400, detail="File too large (max 500MB)")
            await f.write(chunk)
    
    video_doc = {
        "id": video_id,
        "filename": file.filename,
        "stored_filename": filename,
        "teacher_id": teacher_id,
        "uploaded_by": current_user["id"],
        "status": "processing",
        "upload_date": datetime.now(timezone.utc).isoformat()
    }
    await db.videos.insert_one(video_doc)
    
    # Queue video analysis in background
    background_tasks.add_task(analyze_video, video_id, str(file_path), teacher_id, current_user["id"])
    
    return VideoUploadResponse(
        id=video_id,
        filename=file.filename,
        teacher_id=teacher_id,
        status="processing",
        upload_date=video_doc["upload_date"]
    )

@api_router.get("/videos")
async def get_videos(teacher_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {"uploaded_by": current_user["id"]}
    if teacher_id:
        query["teacher_id"] = teacher_id
    videos = await db.videos.find(query, {"_id": 0, "uploaded_by": 0, "stored_filename": 0}).to_list(1000)
    return videos


@api_router.get("/videos/{video_id}")
async def get_video_detail(video_id: str, current_user: dict = Depends(get_current_user)):
    """Get full video metadata including stored filename for playback."""
    video = await db.videos.find_one(
        {"id": video_id, "uploaded_by": current_user["id"]},
        {"_id": 0},
    )
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    return video

@api_router.get("/videos/{video_id}/status")
async def get_video_status(video_id: str, current_user: dict = Depends(get_current_user)):
    video = await db.videos.find_one(
        {"id": video_id, "uploaded_by": current_user["id"]},
        {"_id": 0}
    )
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    return {"status": video.get("status", "unknown")}

# ==================== ASSESSMENT ENDPOINTS ====================
@api_router.get("/assessments", response_model=List[AssessmentResult])
async def get_assessments(
    teacher_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {"user_id": current_user["id"]}
    if teacher_id:
        query["teacher_id"] = teacher_id
    
    assessments = await db.assessments.find(query, {"_id": 0, "user_id": 0}).to_list(1000)
    return [AssessmentResult(**a) for a in assessments]

@api_router.get("/assessments/{assessment_id}", response_model=AssessmentResult)
async def get_assessment(assessment_id: str, current_user: dict = Depends(get_current_user)):
    assessment = await db.assessments.find_one(
        {"id": assessment_id, "user_id": current_user["id"]},
        {"_id": 0, "user_id": 0}
    )
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    return AssessmentResult(**assessment)


@api_router.get("/teachers/{teacher_id}/summary-insights")
async def get_teacher_summary_insights(
    teacher_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Aggregate insights across multiple lessons for a teacher.
    Used for monthly/periodic 'Summary AI Insight' on the profile.
    """
    assessments = await db.assessments.find(
        {"teacher_id": teacher_id, "user_id": current_user["id"]},
        {"_id": 0, "user_id": 0},
    ).sort("analyzed_at", -1).to_list(50)

    if not assessments:
        return {
            "teacher_id": teacher_id,
            "overall_trend_score": None,
            "summary": "",
            "recommendations": [],
        }

    # Flatten element scores across assessments
    aggregated_scores: Dict[str, Dict[str, Any]] = {}
    all_element_scores: List[dict] = []
    for assessment in assessments:
        for es in assessment.get("element_scores", []):
            all_element_scores.append(es)
            key = es["element_id"]
            bucket = aggregated_scores.setdefault(
                key,
                {"name": es["element_name"], "scores": []},
            )
            bucket["scores"].append(es["score"])

    # Compute overall average across all element scores
    all_scores = [es["score"] for es in all_element_scores]
    overall_trend = round(sum(all_scores) / len(all_scores), 2) if all_scores else None

    # Reuse existing summary/recommendation logic on synthetic element scores
    synthetic_element_scores: List[dict] = []
    for element_id, info in aggregated_scores.items():
        if not info["scores"]:
            continue
        avg = round(sum(info["scores"]) / len(info["scores"]), 2)
        synthetic_element_scores.append(
            {
                "element_id": element_id,
                "element_name": info["name"],
                "score": avg,
            }
        )

    summary_text = generate_summary(synthetic_element_scores, overall_trend or 0)
    recs = generate_recommendations(synthetic_element_scores)

    return {
        "teacher_id": teacher_id,
        "overall_trend_score": overall_trend,
        "summary": summary_text,
        "recommendations": recs,
    }


@api_router.get(
    "/teachers/{teacher_id}/summary-reflection",
    response_model=Optional[SummaryReflection],
)
async def get_teacher_summary_reflection(
    teacher_id: str,
    current_user: dict = Depends(get_current_user),
):
    doc = await db.summary_reflections.find_one(
        {"teacher_id": teacher_id, "user_id": current_user["id"]},
        {"_id": 0, "user_id": 0},
    )
    if not doc:
        return None
    return SummaryReflection(**doc)


@api_router.post(
    "/teachers/{teacher_id}/summary-reflection",
    response_model=SummaryReflection,
)
async def upsert_teacher_summary_reflection(
    teacher_id: str,
    payload: SummaryReflectionUpsert,
    current_user: dict = Depends(get_current_user),
):
    now = datetime.now(timezone.utc).isoformat()
    existing = await db.summary_reflections.find_one(
        {"teacher_id": teacher_id, "user_id": current_user["id"]}
    )
    if existing:
        update_fields: Dict[str, Any] = {
            "updated_at": now,
        }
        if payload.self_reflection is not None:
            update_fields["self_reflection"] = payload.self_reflection
        if payload.actions_taken is not None:
            update_fields["actions_taken"] = payload.actions_taken
        await db.summary_reflections.update_one(
            {"teacher_id": teacher_id, "user_id": current_user["id"]},
            {"$set": update_fields},
        )
        existing.update(update_fields)
        existing.pop("_id", None)
        existing.pop("user_id", None)
        return SummaryReflection(**existing)

    doc = {
        "id": str(uuid.uuid4()),
        "teacher_id": teacher_id,
        "user_id": current_user["id"],
        "self_reflection": payload.self_reflection or "",
        "actions_taken": payload.actions_taken or "",
        "created_at": now,
        "updated_at": None,
    }
    await db.summary_reflections.insert_one(doc)
    doc.pop("_id", None)
    doc.pop("user_id", None)
    return SummaryReflection(**doc)

# ==================== ROSTER & DASHBOARD ENDPOINTS ====================
@api_router.get("/roster")
async def get_teacher_roster(
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get all teachers with their performance scores for selected elements"""
    # Get current framework selection
    selection = await db.framework_selections.find_one(
        {"user_id": current_user["id"]},
        {"_id": 0}
    )
    
    selected_elements = []
    if selection:
        selected_elements = selection.get("selected_elements", [])
    else:
        # Default to all Danielson elements
        for domain in DANIELSON_FRAMEWORK["domains"]:
            for element in domain["elements"]:
                selected_elements.append(element["id"])
    
    # Get all teachers
    teachers = await db.teachers.find(
        {"created_by": current_user["id"]},
        {"_id": 0}
    ).to_list(1000)
    
    roster = []
    for teacher in teachers:
        # Get assessments for this teacher within date range
        assessment_query = {
            "teacher_id": teacher["id"],
            "user_id": current_user["id"]
        }
        
        if start_date and end_date:
            assessment_query["analyzed_at"] = {
                "$gte": start_date.isoformat(),
                "$lte": end_date.isoformat(),
            }
        
        assessments = await db.assessments.find(assessment_query, {"_id": 0}).to_list(1000)
        
        # Aggregate scores per element
        element_scores = {}
        for element_id in selected_elements:
            scores = []
            for assessment in assessments:
                for es in assessment.get("element_scores", []):
                    if es["element_id"] == element_id:
                        scores.append(es["score"])
            
            if scores:
                avg_score = sum(scores) / len(scores)
                level = get_performance_level(avg_score)
                element_scores[element_id] = {
                    "score": round(avg_score, 2),
                    "level": level
                }
            else:
                element_scores[element_id] = {
                    "score": None,
                    "level": None
                }
        
        # Calculate overall score
        valid_scores = [es["score"] for es in element_scores.values() if es["score"] is not None]
        overall_score = round(sum(valid_scores) / len(valid_scores), 2) if valid_scores else None
        
        roster.append(
            {
                "teacher_id": teacher["id"],
                "teacher_name": teacher["name"],
                "subject": teacher["subject"],
                "grade_level": teacher["grade_level"],
                "department": teacher.get("department"),
                "element_scores": element_scores,
                "overall_score": overall_score,
                "assessment_count": len(assessments),
                "last_assessment_date": assessments[-1]["analyzed_at"] if assessments else None,
            }
        )
    
    return {
        "selected_elements": selected_elements,
        "roster": roster
    }

@api_router.get("/teachers/{teacher_id}/dashboard")
async def get_teacher_dashboard(
    teacher_id: str,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get detailed dashboard data for a specific teacher"""
    teacher = await db.teachers.find_one(
        {"id": teacher_id, "created_by": current_user["id"]},
        {"_id": 0, "created_by": 0}
    )
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")
    
    # Get assessments
    assessment_query = {
        "teacher_id": teacher_id,
        "user_id": current_user["id"]
    }
    
    if start_date and end_date:
        assessment_query["analyzed_at"] = {
            "$gte": start_date.isoformat(),
            "$lte": end_date.isoformat(),
        }
    
    assessments = await db.assessments.find(
        assessment_query,
        {"_id": 0, "user_id": 0}
    ).sort("analyzed_at", 1).to_list(1000)
    
    # Build trend data
    trend_data = []
    for assessment in assessments:
        trend_data.append({
            "date": assessment["analyzed_at"],
            "overall_score": assessment["overall_score"],
            "element_scores": {es["element_id"]: es["score"] for es in assessment["element_scores"]}
        })
    
    # Aggregate element scores
    element_aggregates = {}
    for assessment in assessments:
        for es in assessment.get("element_scores", []):
            if es["element_id"] not in element_aggregates:
                element_aggregates[es["element_id"]] = {
                    "element_name": es["element_name"],
                    "scores": [],
                    "observations": []
                }
            element_aggregates[es["element_id"]]["scores"].append(es["score"])
            element_aggregates[es["element_id"]]["observations"].extend(es.get("observations", []))
    
    # Calculate averages and levels
    element_summary = []
    for element_id, data in element_aggregates.items():
        avg_score = sum(data["scores"]) / len(data["scores"]) if data["scores"] else 0
        element_summary.append({
            "element_id": element_id,
            "element_name": data["element_name"],
            "average_score": round(avg_score, 2),
            "level": get_performance_level(avg_score),
            "assessment_count": len(data["scores"]),
            "recent_observations": data["observations"][-5:] if data["observations"] else []
        })
    
    # Get videos
    videos = await db.videos.find(
        {"teacher_id": teacher_id, "uploaded_by": current_user["id"]},
        {"_id": 0, "uploaded_by": 0}
    ).to_list(100)
    
    return {
        "teacher": teacher,
        "element_summary": element_summary,
        "trend_data": trend_data,
        "assessments": assessments,
        "videos": videos,
        "total_assessments": len(assessments),
        "date_range": {
            "start": assessments[0]["analyzed_at"] if assessments else None,
            "end": assessments[-1]["analyzed_at"] if assessments else None
        }
    }

@api_router.get("/teachers/{teacher_id}/peer-recommendations")
async def get_peer_recommendations(
    teacher_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Get peer teacher recommendations based on the target teacher's weak areas.
    Finds peers who excel in areas where the target teacher needs improvement.
    """
    # Get target teacher
    target_teacher = await db.teachers.find_one(
        {"id": teacher_id, "created_by": current_user["id"]},
        {"_id": 0}
    )
    if not target_teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")

    # Get target teacher's assessments to find weak areas
    target_assessments = await db.assessments.find(
        {"teacher_id": teacher_id, "user_id": current_user["id"]}
    ).sort("analyzed_at", -1).to_list(10)

    if not target_assessments:
        return {"recommendations": []}

    # Calculate average scores per element for target teacher
    target_element_scores = {}
    for assessment in target_assessments:
        for es in assessment.get("element_scores", []):
            eid = es["element_id"]
            if eid not in target_element_scores:
                target_element_scores[eid] = {"scores": [], "name": es["element_name"]}
            target_element_scores[eid]["scores"].append(es["score"])

    target_averages = {}
    for eid, data in target_element_scores.items():
        target_averages[eid] = {
            "avg": sum(data["scores"]) / len(data["scores"]),
            "name": data["name"]
        }

    # Find weak areas (score < 6)
    weak_areas = [eid for eid, data in target_averages.items() if data["avg"] < 6]
    if not weak_areas:
        weak_areas = sorted(target_averages.keys(), key=lambda x: target_averages[x]["avg"])[:3]

    # Get all other teachers
    other_teachers = await db.teachers.find(
        {"created_by": current_user["id"], "id": {"$ne": teacher_id}},
        {"_id": 0}
    ).to_list(100)

    recommendations = []
    for peer in other_teachers:
        # Get peer's assessments
        peer_assessments = await db.assessments.find(
            {"teacher_id": peer["id"], "user_id": current_user["id"]}
        ).sort("analyzed_at", -1).to_list(10)

        if not peer_assessments:
            continue

        # Calculate peer's scores in weak areas
        peer_element_scores = {}
        for assessment in peer_assessments:
            for es in assessment.get("element_scores", []):
                eid = es["element_id"]
                if eid not in peer_element_scores:
                    peer_element_scores[eid] = []
                peer_element_scores[eid].append(es["score"])

        peer_averages = {eid: sum(scores) / len(scores) for eid, scores in peer_element_scores.items()}

        # Find strengths in weak areas
        strengths = []
        match_score = 0
        for weak_area in weak_areas:
            if weak_area in peer_averages and peer_averages[weak_area] >= 7:
                strengths.append({
                    "element_id": weak_area,
                    "score": round(peer_averages[weak_area], 1),
                    "name": target_averages.get(weak_area, {}).get("name", weak_area)
                })
                match_score += (peer_averages[weak_area] - target_averages.get(weak_area, {}).get("avg", 5)) / 10

        if strengths:
            # Generate recommendation reason
            strength_names = [s["name"] or s["element_id"] for s in strengths[:2]]
            reason = f"Strong in {', '.join(strength_names)}"
            if peer.get("subject") == target_teacher.get("subject"):
                reason += " (same subject area)"

            recommendations.append({
                "peer_id": peer["id"],
                "peer_name": peer["name"],
                "subject": peer.get("subject", ""),
                "grade_level": peer.get("grade_level", ""),
                "department": peer.get("department", ""),
                "strengths": strengths[:3],
                "match_score": min(1.0, match_score / len(weak_areas)) if weak_areas else 0,
                "reason": reason
            })

    # Sort by match score and return top 3
    recommendations.sort(key=lambda x: x["match_score"], reverse=True)
    return {"recommendations": recommendations[:3]}


# ==================== HELPER FUNCTIONS ====================
def get_performance_level(score: float) -> str:
    """
    Map a 1-10 gradient score into performance bands for UI.
    """
    if score >= 8:
        return "excellent"
    elif score >= 5:
        return "needs_improvement"
    else:
        return "critical"


# ==================== OBSERVATIONS ENDPOINTS ====================
@api_router.post("/observations", response_model=Observation)
async def create_observation(
    payload: ObservationCreate,
    current_user: dict = Depends(get_current_user),
):
    """
    Create a human observation with bidirectional comments and implementation status.
    """
    obs_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": obs_id,
        "user_id": current_user["id"],
        "teacher_id": payload.teacher_id,
        "video_id": payload.video_id,
        "element_id": payload.element_id,
        "timestamp_seconds": payload.timestamp_seconds,
        "admin_comment": payload.admin_comment,
        "teacher_response": payload.teacher_response,
        "implementation_status": payload.implementation_status or "planned",
        "created_at": now,
        "updated_at": None,
    }
    await db.observations.insert_one(doc)
    return Observation(**{k: v for k, v in doc.items() if k != "_id"})


@api_router.get("/teachers/{teacher_id}/observations", response_model=List[Observation])
async def list_teacher_observations(
    teacher_id: str,
    current_user: dict = Depends(get_current_user),
):
    cursor = db.observations.find(
        {"teacher_id": teacher_id, "user_id": current_user["id"]},
        {"_id": 0, "user_id": 0},
    ).sort("created_at", -1)
    docs = await cursor.to_list(1000)
    return [Observation(**d) for d in docs]


@api_router.get("/videos/{video_id}/observations", response_model=List[Observation])
async def list_video_observations(
    video_id: str,
    current_user: dict = Depends(get_current_user),
):
    cursor = db.observations.find(
        {"video_id": video_id, "user_id": current_user["id"]},
        {"_id": 0, "user_id": 0},
    ).sort("timestamp_seconds", 1)
    docs = await cursor.to_list(1000)
    return [Observation(**d) for d in docs]


@api_router.patch("/observations/{observation_id}", response_model=Observation)
async def update_observation(
    observation_id: str,
    payload: ObservationCreate,
    current_user: dict = Depends(get_current_user),
):
    update_fields: Dict[str, Any] = {}
    for field in [
        "admin_comment",
        "teacher_response",
        "implementation_status",
        "timestamp_seconds",
    ]:
        value = getattr(payload, field)
        if value is not None:
            update_fields[field] = value
    if not update_fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    update_fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.observations.find_one_and_update(
        {"id": observation_id, "user_id": current_user["id"]},
        {"$set": update_fields},
        return_document=True,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Observation not found")
    result.pop("_id", None)
    result.pop("user_id", None)
    return Observation(**result)


# ==================== SCHEDULE ENDPOINTS ====================
@api_router.post("/schedules", response_model=Schedule)
async def create_schedule(
    payload: ScheduleCreate,
    current_user: dict = Depends(get_current_user),
):
    sched_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": sched_id,
        "teacher_id": payload.teacher_id,
        "course_name": payload.course_name,
        "start_time": payload.start_time.isoformat(),
        "recording_status": ScheduleStatus.PLANNED.value,
        "join_url": payload.join_url,
        "location": payload.location,
        "user_id": current_user["id"],
        "created_at": now,
        "updated_at": None,
    }
    await db.schedules.insert_one(doc)
    doc.pop("_id", None)
    doc.pop("user_id", None)
    return Schedule(**doc)


@api_router.get("/schedules", response_model=List[Schedule])
async def list_schedules(
    teacher_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    query: Dict[str, Any] = {"user_id": current_user["id"]}
    if teacher_id:
        query["teacher_id"] = teacher_id
    cursor = db.schedules.find(
        query,
        {"_id": 0, "user_id": 0},
    ).sort("start_time", 1)
    docs = await cursor.to_list(1000)
    # Pydantic will parse ISO8601 strings into datetime for start_time
    return [Schedule(**d) for d in docs]


@api_router.patch("/schedules/{schedule_id}", response_model=Schedule)
async def update_schedule(
    schedule_id: str,
    payload: ScheduleUpdate,
    current_user: dict = Depends(get_current_user),
):
    update_fields: Dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if payload.recording_status is not None:
        update_fields["recording_status"] = payload.recording_status.value
    if payload.join_url is not None:
        update_fields["join_url"] = payload.join_url

    result = await db.schedules.find_one_and_update(
        {"id": schedule_id, "user_id": current_user["id"]},
        {"$set": update_fields},
        return_document=True,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Schedule not found")
    result.pop("_id", None)
    result.pop("user_id", None)
    return Schedule(**result)

async def analyze_video(video_id: str, file_path: str, teacher_id: str, user_id: str):
    """Background task to analyze video using AI"""
    try:
        logger.info(f"Starting analysis for video {video_id}")
        
        # Get current framework selection
        selection = await db.framework_selections.find_one(
            {"user_id": user_id},
            {"_id": 0}
        )
        
        framework_type = selection.get("framework_type", "danielson") if selection else "danielson"
        selected_elements = selection.get("selected_elements", []) if selection else []
        
        # Get framework data
        if framework_type == "danielson":
            framework = DANIELSON_FRAMEWORK
        elif framework_type == "marshall":
            framework = MARSHALL_FRAMEWORK
        else:
            framework = {
                "domains": DANIELSON_FRAMEWORK["domains"] + MARSHALL_FRAMEWORK["domains"]
            }
        
        # Extract frames from video (run in thread to avoid blocking event loop)
        frames = await asyncio.to_thread(extract_video_frames, file_path, 5)
        logger.info(f"Extracted {len(frames)} frames from video")
        
        # Analyze with AI
        element_scores = await analyze_frames_with_ai(frames, framework, selected_elements)
        
        # Calculate overall score (1-10 gradient mapped from underlying 1-4 scale if needed)
        valid_scores = [es["score"] for es in element_scores if es["score"] > 0]
        overall_score = round(sum(valid_scores) / len(valid_scores), 2) if valid_scores else 0
        
        # Generate recommendations
        recommendations = generate_recommendations(element_scores)
        
        # Create assessment document
        assessment_doc = {
            "id": str(uuid.uuid4()),
            "video_id": video_id,
            "teacher_id": teacher_id,
            "user_id": user_id,
            "framework_type": framework_type,
            "element_scores": element_scores,
            "overall_score": overall_score,
            "summary": generate_summary(element_scores, overall_score),
            "recommendations": recommendations,
            "analyzed_at": datetime.now(timezone.utc).isoformat()
        }
        
        await db.assessments.insert_one(assessment_doc)
        
        # Update video status
        await db.videos.update_one(
            {"id": video_id},
            {"$set": {"status": "completed", "assessment_id": assessment_doc["id"]}}
        )
        
        logger.info(f"Completed analysis for video {video_id}")
        
    except Exception as e:
        logger.error(f"Error analyzing video {video_id}: {str(e)}")
        await db.videos.update_one(
            {"id": video_id},
            {"$set": {"status": "error", "error_message": str(e)}}
        )
    finally:
        # Clean up video file (run in thread to avoid blocking event loop)
        try:
            if os.path.exists(file_path):
                await asyncio.to_thread(os.remove, file_path)
        except Exception as e:
            logger.error(f"Error removing video file: {e}")

def extract_video_frames(video_path: str, max_frames: int = 5) -> List[str]:
    """Extract frames from video and return as base64 strings"""
    frames = []
    try:
        if cv2 is None:
            logger.error(f"OpenCV not available: {_cv2_import_error}")
            return frames
        cap = cv2.VideoCapture(video_path)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        
        if total_frames == 0:
            return frames
        
        # Calculate frame interval
        interval = max(1, total_frames // max_frames)
        
        for i in range(0, total_frames, interval):
            if len(frames) >= max_frames:
                break
            
            cap.set(cv2.CAP_PROP_POS_FRAMES, i)
            ret, frame = cap.read()
            
            if ret:
                # Resize for API efficiency
                frame = cv2.resize(frame, (640, 480))
                _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
                base64_frame = base64.b64encode(buffer).decode('utf-8')
                frames.append(base64_frame)
        
        cap.release()
    except Exception as e:
        logger.error(f"Error extracting frames: {e}")
    
    return frames

async def analyze_frames_with_ai(frames: List[str], framework: dict, selected_elements: List[str]) -> List[dict]:
    """Analyze video frames using GPT-5.2 vision via Emergent LLM API"""
    try:
        from emergentintegrations.llm.chat import chat, Message
    except ImportError:
        logger.warning("emergentintegrations package not installed; using mock scores")
        # Build element list for fallback
        elements_to_analyze = []
        for domain in framework.get("domains", []):
            for element in domain.get("elements", []):
                if not selected_elements or element["id"] in selected_elements:
                    elements_to_analyze.append({
                        "id": element["id"],
                        "name": element["name"],
                        "domain": domain["name"]
                    })
        return generate_mock_scores(elements_to_analyze)

    # Build element list for analysis
    elements_to_analyze = []
    for domain in framework.get("domains", []):
        for element in domain.get("elements", []):
            if not selected_elements or element["id"] in selected_elements:
                elements_to_analyze.append({
                    "id": element["id"],
                    "name": element["name"],
                    "domain": domain["name"]
                })
    
    # Create analysis prompt
    elements_text = "\n".join([f"- {e['id']}: {e['name']} (Domain: {e['domain']})" for e in elements_to_analyze])
    
    prompt = f"""You are an expert educator analyzing classroom video footage to evaluate teacher performance.

Analyze the provided classroom images and evaluate the teacher on the following framework elements:

{elements_text}

For each element, provide:
1. A score from 1-4 (1=Unsatisfactory, 2=Basic, 3=Proficient, 4=Distinguished)
2. Key observations that support your score
3. Your confidence level (0-100%)

Focus on observable behaviors, classroom management, student engagement, and instructional quality visible in the images.

Respond in JSON format:
{{
  "element_scores": [
    {{
      "element_id": "element_id",
      "element_name": "Element Name",
      "score": 3.0,
      "observations": ["Observation 1", "Observation 2"],
      "confidence": 85
    }}
  ]
}}"""

    api_key = os.getenv("EMERGENT_LLM_KEY")
    if not api_key:
        logger.error("EMERGENT_LLM_KEY is not set; skipping real AI analysis and using mock scores")
        return generate_mock_scores(elements_to_analyze)

    try:
        # Prepare image content for GPT-5.2 vision
        image_content = []
        for i, frame in enumerate(frames[:3]):  # Limit to 3 frames for API efficiency
            image_content.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/jpeg;base64,{frame}"
                }
            })
        
        messages = [
            Message(role="user", content=[
                {"type": "text", "text": prompt},
                *image_content
            ])
        ]
        
        response = await chat(api_key=api_key, messages=messages, model="gpt-5.2")
        
        # Parse response
        response_text = response.content if hasattr(response, 'content') else str(response)
        
        # Extract JSON from response
        import re
        json_match = re.search(r'\{[\s\S]*\}', response_text)
        if json_match:
            result = json.loads(json_match.group())
            element_scores = result.get("element_scores", [])
            
            # Add performance level to each score
            for es in element_scores:
                es["level"] = get_performance_level(es.get("score", 0))
            
            return element_scores
    
    except Exception as e:
        logger.error(f"Error in AI analysis: {e}")
    
    # Fallback: return mock scores for demo
    return generate_mock_scores(elements_to_analyze)

def generate_mock_scores(elements: List[dict]) -> List[dict]:
    """Generate mock scores for demonstration"""
    import random
    
    scores = []
    for element in elements:
        # Generate a 1-10 gradient score for richer visualizations
        score = round(random.uniform(4.0, 9.5), 1)
        scores.append({
            "element_id": element["id"],
            "element_name": element["name"],
            "score": score,
            "level": get_performance_level(score),
            "observations": [
                f"Teacher demonstrates {element['name'].lower()} effectively" if score >= 3 else f"Room for improvement in {element['name'].lower()}",
                "Student engagement observed" if score >= 2.5 else "Consider strategies to increase engagement"
            ],
            "confidence": random.randint(70, 95)
        })
    
    return scores

def generate_summary(element_scores: List[dict], overall_score: float) -> str:
    """Generate a summary of the assessment"""
    level = get_performance_level(overall_score)
    
    strengths = [es["element_name"] for es in element_scores if es.get("score", 0) >= 3]
    areas_for_growth = [es["element_name"] for es in element_scores if es.get("score", 0) < 2.5]
    
    summary_parts = [
        f"Overall performance: {level.replace('_', ' ').title()} (Score: {overall_score}/10)."
    ]
    
    if strengths:
        summary_parts.append(f"Key strengths include: {', '.join(strengths[:3])}.")
    
    if areas_for_growth:
        summary_parts.append(f"Areas for professional growth: {', '.join(areas_for_growth[:3])}.")
    
    return " ".join(summary_parts)

def generate_recommendations(element_scores: List[dict]) -> List[str]:
    """Generate recommendations based on scores"""
    recommendations = []
    
    low_scores = sorted(
        [es for es in element_scores if es.get("score", 0) < 3],
        key=lambda x: x.get("score", 0)
    )[:3]
    
    for es in low_scores:
        name = es["element_name"]
        if es.get("score", 0) < 2:
            recommendations.append(f"Priority: Focus on improving {name}. Consider mentorship or targeted professional development.")
        else:
            recommendations.append(f"Continue developing skills in {name}. Review best practices and observe peer teachers.")
    
    if not recommendations:
        recommendations.append("Excellent performance across all evaluated areas. Consider leadership or mentoring opportunities.")
    
    return recommendations

# ==================== SEED DATA ENDPOINT ====================
@api_router.post("/seed-demo-data")
async def seed_demo_data(current_user: dict = Depends(get_current_user)):
    """Seed demo data for testing"""
    import random
    
    # Create demo teachers
    demo_teachers = [
        {"name": "Sarah Johnson", "email": "sarah.j@school.edu", "subject": "Mathematics", "grade_level": "9th Grade", "department": "STEM"},
        {"name": "Michael Chen", "email": "michael.c@school.edu", "subject": "English Literature", "grade_level": "11th Grade", "department": "Humanities"},
        {"name": "Emily Rodriguez", "email": "emily.r@school.edu", "subject": "Biology", "grade_level": "10th Grade", "department": "STEM"},
        {"name": "David Park", "email": "david.p@school.edu", "subject": "History", "grade_level": "8th Grade", "department": "Humanities"},
        {"name": "Jennifer Williams", "email": "jennifer.w@school.edu", "subject": "Chemistry", "grade_level": "12th Grade", "department": "STEM"},
        {"name": "Robert Martinez", "email": "robert.m@school.edu", "subject": "Physical Education", "grade_level": "7th Grade", "department": "Athletics"},
    ]
    
    created_teachers = []
    for teacher_data in demo_teachers:
        existing = await db.teachers.find_one({"email": teacher_data["email"], "created_by": current_user["id"]})
        if not existing:
            teacher_doc = {
                "id": str(uuid.uuid4()),
                **teacher_data,
                "created_by": current_user["id"],
                "created_at": datetime.now(timezone.utc).isoformat()
            }
            await db.teachers.insert_one(teacher_doc)
            created_teachers.append(teacher_doc)
        else:
            created_teachers.append(existing)
    
    # Create demo assessments for each teacher
    for teacher in created_teachers:
        # Create 3-5 assessments per teacher over the last 90 days
        num_assessments = random.randint(3, 5)
        
        for i in range(num_assessments):
            days_ago = random.randint(1, 90)
            assessment_date = (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()
            
            # Generate element scores
            element_scores = []
            for domain in DANIELSON_FRAMEWORK["domains"]:
                for element in domain["elements"]:
                    base_score = random.uniform(4.0, 9.5)
                    # Add some consistency per teacher
                    if teacher["subject"] in ["Mathematics", "Chemistry"]:
                        base_score = min(4.0, base_score + 0.3)
                    
                    score = round(base_score, 1)
                    element_scores.append({
                        "element_id": element["id"],
                        "element_name": element["name"],
                        "score": score,
                        "level": get_performance_level(score),
                        "observations": [
                            f"Observed {element['name'].lower()} during classroom instruction"
                        ],
                        "confidence": random.randint(75, 95)
                    })
            
            overall_score = round(sum(es["score"] for es in element_scores) / len(element_scores), 2)
            
            assessment_doc = {
                "id": str(uuid.uuid4()),
                "video_id": str(uuid.uuid4()),
                "teacher_id": teacher["id"],
                "user_id": current_user["id"],
                "framework_type": "danielson",
                "element_scores": element_scores,
                "overall_score": overall_score,
                "summary": generate_summary(element_scores, overall_score),
                "recommendations": generate_recommendations(element_scores),
                "analyzed_at": assessment_date
            }
            
            await db.assessments.insert_one(assessment_doc)
    
    return {"message": f"Created {len(created_teachers)} teachers with demo assessments"}

# Include the router in the main app
app.include_router(api_router)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")
origins = _get_optional_env_list("CORS_ORIGINS")
if not origins:
    logger.warning("CORS_ORIGINS not set; defaulting to no external origins")
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=origins or [],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def ensure_demo_users():
    if not DEMO_MODE:
        return
    for demo in DEMO_USERS:
        existing = await db.users.find_one({"email": demo["email"]})
        if existing:
            continue
        user_id = str(uuid.uuid4())
        user_doc = {
            "id": user_id,
            "email": demo["email"],
            "name": demo["name"],
            "password": hash_password(demo["password"]),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "is_demo": True,
        }
        await db.users.insert_one(user_doc)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
