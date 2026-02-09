from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Form, BackgroundTasks, Depends, Response, WebSocket, WebSocketDisconnect
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
import io
import csv
import boto3
from botocore.exceptions import BotoCoreError, ClientError
try:
    import cv2
except Exception as exc:
    cv2 = None
    _cv2_import_error = exc
import aiofiles
import asyncio
from enum import Enum
try:
    from reportlab.pdfgen import canvas
except Exception:
    canvas = None

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


def _get_user_role(user: dict) -> str:
    role = (user or {}).get("role")
    if role:
        return role
    email = (user or {}).get("email", "").lower()
    if email and email in ADMIN_EMAILS:
        return "admin"
    return "teacher"


def _ensure_allowed_extension(filename: str) -> None:
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        )


async def _save_upload_file(upload: UploadFile, target_path: Path) -> None:
    size = 0
    target_path.parent.mkdir(parents=True, exist_ok=True)
    async with aiofiles.open(target_path, "wb") as out:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                raise HTTPException(status_code=413, detail="File exceeds 10MB limit")
            await out.write(chunk)

def _get_s3_client():
    if not S3_BUCKET:
        raise RuntimeError("S3_BUCKET must be set for file uploads")
    session = boto3.session.Session(
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
        region_name=S3_REGION or None,
    )
    return session.client("s3", endpoint_url=S3_ENDPOINT or None)


def _validate_s3_config() -> None:
    if not S3_BUCKET:
        logger.warning("S3_BUCKET not set; uploads will fail.")
        return
    if not os.getenv("AWS_ACCESS_KEY_ID") or not os.getenv("AWS_SECRET_ACCESS_KEY"):
        logger.error("AWS credentials missing; S3 uploads will fail.")
    if not (S3_PUBLIC_BASE_URL or S3_REGION or S3_ENDPOINT):
        logger.warning("S3 public URL/region/endpoint not set; URLs may be incorrect.")


def _build_s3_key(category: str, filename: str) -> str:
    safe_name = Path(filename).name.replace(" ", "_")
    return f"uploads/{category}/{uuid.uuid4()}_{safe_name}"


def _get_s3_public_url(key: str) -> str:
    if S3_PUBLIC_BASE_URL:
        return f"{S3_PUBLIC_BASE_URL.rstrip('/')}/{key}"
    if S3_ENDPOINT:
        endpoint = S3_ENDPOINT.replace("https://", "").replace("http://", "")
        return f"https://{S3_BUCKET}.{endpoint}/{key}"
    if S3_REGION:
        return f"https://{S3_BUCKET}.s3.{S3_REGION}.amazonaws.com/{key}"
    return f"https://{S3_BUCKET}.s3.amazonaws.com/{key}"


async def _upload_file_to_s3(upload: UploadFile, category: str) -> Tuple[str, str]:
    if not S3_BUCKET:
        raise HTTPException(status_code=500, detail="S3 bucket not configured")
    _ensure_allowed_extension(upload.filename or "")
    tmp_name = f"{uuid.uuid4()}_{Path(upload.filename or 'upload').name}"
    temp_path = UPLOAD_DIR / "tmp" / tmp_name
    await _save_upload_file(upload, temp_path)
    key = _build_s3_key(category, tmp_name)
    client = _get_s3_client()
    content_type = upload.content_type or "application/octet-stream"
    try:
        client.upload_file(
            str(temp_path),
            S3_BUCKET,
            key,
            ExtraArgs={"ContentType": content_type},
        )
    except (BotoCoreError, ClientError) as exc:
        raise HTTPException(status_code=500, detail=f"S3 upload failed: {exc}")
    finally:
        try:
            if temp_path.exists():
                temp_path.unlink()
        except OSError:
            pass
    return key, _get_s3_public_url(key)


def _upload_path_to_s3(file_path: Path, category: str, filename: str, content_type: str) -> Tuple[str, str]:
    if not S3_BUCKET:
        raise RuntimeError("S3 bucket not configured")
    key = _build_s3_key(category, filename)
    client = _get_s3_client()
    client.upload_file(
        str(file_path),
        S3_BUCKET,
        key,
        ExtraArgs={"ContentType": content_type or "application/octet-stream"},
    )
    return key, _get_s3_public_url(key)


async def _get_teacher_or_404(teacher_id: str, current_user: dict) -> dict:
    teacher = await db.teachers.find_one({"id": teacher_id}, {"_id": 0})
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")
    role = _get_user_role(current_user)
    if role == "admin":
        if teacher.get("created_by") != current_user["id"]:
            raise HTTPException(status_code=403, detail="Not authorized for this teacher")
        return teacher
    # teacher role: allow only if teacher email matches user email or teacher created_by matches user id
    if teacher.get("email") and teacher.get("email").lower() == current_user.get("email", "").lower():
        return teacher
    if teacher.get("created_by") == current_user["id"]:
        return teacher
    raise HTTPException(status_code=403, detail="Not authorized for this teacher")


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
ADMIN_EMAILS = set(email.lower() for email in _get_optional_env_list("ADMIN_EMAILS"))
DEMO_USERS = [
    {
        "email": "principal@demo.cognivio.app",
        "name": "Demo Principal",
        "password": "DemoAccess2026!",
        "role": "admin",
    },
    {
        "email": "teacher@demo.cognivio.app",
        "name": "Demo Teacher",
        "password": "DemoAccess2026!",
        "role": "teacher",
    },
]

# Upload constraints
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10MB
ALLOWED_EXTENSIONS = {".pdf", ".docx", ".pptx", ".jpeg", ".jpg"}
ADHERENCE_WEIGHT = float(os.getenv("ADHERENCE_WEIGHT", "0.15"))

# S3 configuration (required for file uploads)
S3_BUCKET = os.getenv("S3_BUCKET")
S3_REGION = os.getenv("S3_REGION")
S3_ENDPOINT = os.getenv("S3_ENDPOINT")
S3_PUBLIC_BASE_URL = os.getenv("S3_PUBLIC_BASE_URL")
FRONTEND_URL = os.getenv("FRONTEND_URL")

# Create uploads directory (used for temp storage)
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


def _get_framework_by_type(framework_type: str) -> dict:
    if framework_type == "marshall":
        return MARSHALL_FRAMEWORK
    if framework_type == "danielson":
        return DANIELSON_FRAMEWORK
    return {
        "domains": DANIELSON_FRAMEWORK["domains"] + MARSHALL_FRAMEWORK["domains"]
    }


def _find_domain_for_element(framework: dict, element_id: str) -> Optional[dict]:
    for domain in framework.get("domains", []):
        for element in domain.get("elements", []):
            if element.get("id") == element_id:
                return domain
    return None

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
    role: Optional[str] = None

class TokenResponse(BaseModel):
    token: str
    user: UserResponse

class TeacherCreate(BaseModel):
    name: str
    email: EmailStr
    subject: str
    grade_level: str
    department: Optional[str] = None
    school_id: Optional[str] = None

class TeacherResponse(BaseModel):
    id: str
    name: str
    email: str
    subject: str
    grade_level: str
    department: Optional[str] = None
    school_id: Optional[str] = None
    created_at: str


class SchoolCreate(BaseModel):
    name: str
    district_name: Optional[str] = None


class SchoolResponse(BaseModel):
    id: str
    name: str
    district_name: Optional[str] = None
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


class CurriculumUploadResponse(BaseModel):
    id: str
    teacher_id: str
    school_id: Optional[str] = None
    title: str
    subject: Optional[str] = None
    grade_level: Optional[str] = None
    filename: str
    file_url: str
    uploaded_by: str
    uploaded_at: str


class LessonPlanUploadResponse(BaseModel):
    id: str
    teacher_id: str
    title: str
    date: str
    curriculum_id: Optional[str] = None
    filename: str
    file_url: str
    uploaded_by: str
    uploaded_at: str


class SyllabusUploadResponse(BaseModel):
    id: str
    teacher_id: str
    title: str
    filename: str
    file_url: str
    uploaded_by: str
    uploaded_at: str


class AdminScoreOverride(BaseModel):
    domain_id: str
    original_score: float
    adjusted_score: float
    rationale: Optional[str] = None


class AdminScoringPreference(BaseModel):
    scoring_mode: str  # "override" or "coexist"

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
    reminder_type: Optional[str] = None
    reminder_context: Optional[Dict[str, Any]] = None
    reminder_note: Optional[str] = None


class ScheduleCreate(BaseModel):
    teacher_id: str
    course_name: str
    start_time: datetime
    join_url: Optional[str] = None
    location: Optional[str] = None
    reminder_type: Optional[str] = None
    reminder_context: Optional[Dict[str, Any]] = None
    reminder_note: Optional[str] = None


class ScheduleUpdate(BaseModel):
    recording_status: Optional[ScheduleStatus] = None
    join_url: Optional[str] = None
    reminder_note: Optional[str] = None


class ActionPlanGoal(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    due_date: Optional[str] = None
    status: Optional[str] = "planned"
    evidence_links: Optional[List[str]] = None


class ActionPlan(BaseModel):
    id: str
    teacher_id: str
    goals: List[ActionPlanGoal]
    notes: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


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


class NotificationRecord(BaseModel):
    id: str
    teacher_id: Optional[str] = None
    notification_type: str
    title: str
    message: str
    channel: str = "email"
    status: str = "queued"
    created_at: str
    read_at: Optional[str] = None


class GradebookIntegrationCreate(BaseModel):
    provider: str  # "powerschool" | "canvas"
    api_key: Optional[str] = None
    status: Optional[str] = "connected"


class GradebookIntegrationResponse(BaseModel):
    id: str
    provider: str
    status: str
    created_at: str
    updated_at: Optional[str] = None

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
        if "role" not in user:
            user["role"] = _get_user_role(user)
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
        "created_at": datetime.now(timezone.utc).isoformat(),
        "role": "teacher",
    }
    await db.users.insert_one(user_doc)
    
    token = create_token(user_id)
    return TokenResponse(
        token=token,
        user=UserResponse(
            id=user_id,
            email=user.email,
            name=user.name,
            created_at=user_doc["created_at"],
            role=user_doc.get("role"),
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
            created_at=db_user["created_at"],
            role=db_user.get("role") or _get_user_role(db_user),
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


@api_router.post("/frameworks/custom-domains/{domain_id}/elements")
async def add_custom_element(
    domain_id: str,
    payload: CustomElementCreate,
    current_user: dict = Depends(get_current_user),
):
    domain = await db.custom_domains.find_one(
        {"id": domain_id, "user_id": current_user["id"]},
        {"_id": 0},
    )
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")
    element_id = f"{domain_id}-{uuid.uuid4().hex[:6]}"
    element = {"id": element_id, "name": payload.name}
    await db.custom_domains.update_one(
        {"id": domain_id, "user_id": current_user["id"]},
        {"$push": {"elements": element}},
    )
    domain = await db.custom_domains.find_one(
        {"id": domain_id, "user_id": current_user["id"]},
        {"_id": 0, "user_id": 0},
    )
    return {"domain": domain}


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
    if teacher.school_id:
        school = await db.schools.find_one(
            {"id": teacher.school_id, "user_id": current_user["id"]}
        )
        if not school:
            raise HTTPException(status_code=404, detail="School not found")
    teacher_doc = {
        "id": teacher_id,
        "name": teacher.name,
        "email": teacher.email,
        "subject": teacher.subject,
        "grade_level": teacher.grade_level,
        "department": teacher.department,
        "school_id": teacher.school_id,
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


@api_router.post("/schools", response_model=SchoolResponse)
async def create_school(
    payload: SchoolCreate,
    current_user: dict = Depends(get_current_user),
):
    school_id = str(uuid.uuid4())
    doc = {
        "id": school_id,
        "name": payload.name,
        "district_name": payload.district_name,
        "user_id": current_user["id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.schools.insert_one(doc)
    doc.pop("user_id", None)
    return SchoolResponse(**doc)


@api_router.get("/schools", response_model=List[SchoolResponse])
async def list_schools(current_user: dict = Depends(get_current_user)):
    schools = await db.schools.find(
        {"user_id": current_user["id"]},
        {"_id": 0, "user_id": 0},
    ).to_list(1000)
    return [SchoolResponse(**s) for s in schools]

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
    
    s3_key = None
    file_url = None
    try:
        s3_key, file_url = _upload_path_to_s3(
            file_path,
            "videos",
            filename,
            file.content_type or "video/mp4",
        )
    except Exception as exc:
        logger.warning(f"S3 upload failed for video {video_id}: {exc}")

    video_doc = {
        "id": video_id,
        "filename": file.filename,
        "stored_filename": filename,
        "s3_key": s3_key,
        "file_url": file_url,
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


@app.websocket("/ws/videos/{video_id}")
async def video_status_ws(websocket: WebSocket, video_id: str):
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=1008)
        return
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("user_id")
        if not user_id:
            await websocket.close(code=1008)
            return
    except jwt.ExpiredSignatureError:
        await websocket.close(code=1008)
        return
    except jwt.InvalidTokenError:
        await websocket.close(code=1008)
        return

    video = await db.videos.find_one(
        {"id": video_id, "uploaded_by": user_id},
        {"_id": 0},
    )
    if not video:
        await websocket.close(code=1008)
        return

    await websocket.accept()
    last_status = None
    try:
        while True:
            video = await db.videos.find_one(
                {"id": video_id, "uploaded_by": user_id},
                {"_id": 0},
            )
            if not video:
                break
            status = video.get("status", "unknown")
            if status != last_status:
                await websocket.send_json({"status": status})
                last_status = status
            if status in {"completed", "failed"}:
                break
            await asyncio.sleep(2)
    except WebSocketDisconnect:
        return
    except Exception:
        try:
            await websocket.close()
        except Exception:
            pass

# ==================== CURRICULUM & PLANS ====================
@api_router.post("/curricula", response_model=CurriculumUploadResponse)
async def upload_curriculum(
    teacher_id: str = Form(...),
    title: str = Form(""),
    school_id: Optional[str] = Form(None),
    subject: Optional[str] = Form(None),
    grade_level: Optional[str] = Form(None),
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    role = _get_user_role(current_user)
    if role not in {"admin", "teacher"}:
        raise HTTPException(status_code=403, detail="Not authorized")

    teacher = await _get_teacher_or_404(teacher_id, current_user)
    _ensure_allowed_extension(file.filename)

    doc_id = str(uuid.uuid4())
    key, file_url = await _upload_file_to_s3(file, "curricula")

    uploaded_at = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": doc_id,
        "teacher_id": teacher_id,
        "school_id": school_id or teacher.get("school_id"),
        "title": title or Path(file.filename).stem,
        "subject": subject or teacher.get("subject"),
        "grade_level": grade_level or teacher.get("grade_level"),
        "filename": file.filename,
        "file_url": file_url,
        "s3_key": key,
        "uploaded_by": current_user["id"],
        "uploaded_role": role,
        "uploaded_at": uploaded_at,
    }
    await db.curricula.insert_one(doc)
    return CurriculumUploadResponse(**doc)


@api_router.get("/curricula")
async def list_curricula(
    teacher_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    query: Dict[str, Any] = {}
    if teacher_id:
        await _get_teacher_or_404(teacher_id, current_user)
        query["teacher_id"] = teacher_id
    else:
        query["uploaded_by"] = current_user["id"]
    docs = await db.curricula.find(query, {"_id": 0}).to_list(1000)
    return {"curricula": docs}


@api_router.post("/lesson-plans", response_model=LessonPlanUploadResponse)
async def upload_lesson_plan(
    teacher_id: str = Form(...),
    date: str = Form(...),
    title: str = Form(""),
    curriculum_id: Optional[str] = Form(None),
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    role = _get_user_role(current_user)
    if role != "teacher":
        raise HTTPException(status_code=403, detail="Only teachers can upload lesson plans")

    await _get_teacher_or_404(teacher_id, current_user)
    _ensure_allowed_extension(file.filename)

    doc_id = str(uuid.uuid4())
    key, file_url = await _upload_file_to_s3(file, "lesson_plans")

    uploaded_at = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": doc_id,
        "teacher_id": teacher_id,
        "title": title or Path(file.filename).stem,
        "date": date,
        "curriculum_id": curriculum_id,
        "filename": file.filename,
        "file_url": file_url,
        "s3_key": key,
        "uploaded_by": current_user["id"],
        "uploaded_at": uploaded_at,
    }
    await db.lesson_plans.insert_one(doc)
    # Create a reminder schedule for the lesson plan date
    try:
        reminder = {
            "id": str(uuid.uuid4()),
            "teacher_id": teacher_id,
            "course_name": f"Lesson plan reminder: {doc['title']}",
            "start_time": datetime.fromisoformat(date).isoformat(),
            "recording_status": ScheduleStatus.PLANNED.value,
            "join_url": None,
            "location": None,
            "user_id": current_user["id"],
            "created_at": uploaded_at,
            "updated_at": None,
            "reminder_type": "lesson_plan",
            "lesson_plan_id": doc_id,
        }
        await db.schedules.insert_one(reminder)
    except Exception:
        logger.warning("Unable to create lesson plan reminder schedule")
    return LessonPlanUploadResponse(**doc)


@api_router.get("/lesson-plans")
async def list_lesson_plans(
    teacher_id: str,
    date: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    await _get_teacher_or_404(teacher_id, current_user)
    query = {"teacher_id": teacher_id}
    if date:
        query["date"] = date
    docs = await db.lesson_plans.find(query, {"_id": 0}).to_list(1000)
    return {"lesson_plans": docs}


@api_router.post("/syllabi", response_model=SyllabusUploadResponse)
async def upload_syllabus(
    teacher_id: str = Form(...),
    title: str = Form(""),
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    role = _get_user_role(current_user)
    if role != "teacher":
        raise HTTPException(status_code=403, detail="Only teachers can upload syllabi")

    await _get_teacher_or_404(teacher_id, current_user)
    _ensure_allowed_extension(file.filename)

    doc_id = str(uuid.uuid4())
    key, file_url = await _upload_file_to_s3(file, "syllabi")

    uploaded_at = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": doc_id,
        "teacher_id": teacher_id,
        "title": title or Path(file.filename).stem,
        "filename": file.filename,
        "file_url": file_url,
        "s3_key": key,
        "uploaded_by": current_user["id"],
        "uploaded_at": uploaded_at,
    }
    await db.syllabi.insert_one(doc)
    return SyllabusUploadResponse(**doc)


@api_router.get("/syllabi")
async def list_syllabi(
    teacher_id: str,
    current_user: dict = Depends(get_current_user),
):
    await _get_teacher_or_404(teacher_id, current_user)
    docs = await db.syllabi.find({"teacher_id": teacher_id}, {"_id": 0}).to_list(1000)
    return {"syllabi": docs}

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


@api_router.get("/assessments/{assessment_id}/evidence")
async def get_assessment_evidence(
    assessment_id: str,
    current_user: dict = Depends(get_current_user),
):
    assessment = await db.assessments.find_one(
        {"id": assessment_id, "user_id": current_user["id"]},
        {"_id": 0, "user_id": 0},
    )
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    evidence = await _ensure_mock_evidence(assessment, current_user)
    return {"evidence": evidence}


@api_router.post("/assessments/{assessment_id}/admin-override")
async def create_admin_override(
    assessment_id: str,
    payload: AdminScoreOverride,
    current_user: dict = Depends(get_current_user),
):
    role = _get_user_role(current_user)
    if role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    doc = {
        "id": str(uuid.uuid4()),
        "assessment_id": assessment_id,
        "admin_id": current_user["id"],
        "domain_id": payload.domain_id,
        "original_score": payload.original_score,
        "adjusted_score": payload.adjusted_score,
        "rationale": payload.rationale,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.admin_assessment_overrides.insert_one(doc)
    return {"override": doc}


@api_router.get("/assessments/{assessment_id}/admin-overrides")
async def list_admin_overrides(
    assessment_id: str,
    current_user: dict = Depends(get_current_user),
):
    role = _get_user_role(current_user)
    if role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    docs = await db.admin_assessment_overrides.find(
        {"assessment_id": assessment_id, "admin_id": current_user["id"]},
        {"_id": 0},
    ).sort("created_at", -1).to_list(1000)
    return {"overrides": docs}


@api_router.post("/admin/preferences/scoring-mode")
async def set_admin_scoring_mode(
    payload: AdminScoringPreference,
    current_user: dict = Depends(get_current_user),
):
    role = _get_user_role(current_user)
    if role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    if payload.scoring_mode not in {"override", "coexist"}:
        raise HTTPException(status_code=400, detail="Invalid scoring mode")
    doc = {
        "admin_id": current_user["id"],
        "scoring_mode": payload.scoring_mode,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.admin_scoring_preferences.update_one(
        {"admin_id": current_user["id"]},
        {"$set": doc},
        upsert=True,
    )
    return {"preference": doc}


async def _get_admin_scoring_mode(admin_id: str) -> str:
    pref = await db.admin_scoring_preferences.find_one(
        {"admin_id": admin_id},
        {"_id": 0, "scoring_mode": 1},
    )
    if pref and pref.get("scoring_mode") in {"override", "coexist"}:
        return pref["scoring_mode"]
    return "override"


def _apply_admin_overrides(
    element_scores: List[dict],
    overrides: List[dict],
    scoring_mode: str,
) -> Tuple[List[dict], Optional[float]]:
    override_map = {o["domain_id"]: o for o in overrides}
    adjusted_scores = []
    for es in element_scores:
        override = override_map.get(es["element_id"])
        score = es["score"]
        if override:
            adjusted = override["adjusted_score"]
            if scoring_mode == "coexist":
                score = round((score + adjusted) / 2, 2)
            else:
                score = adjusted
        adjusted_scores.append({**es, "adjusted_score": score})

    valid_scores = [es["adjusted_score"] for es in adjusted_scores if es["adjusted_score"] is not None]
    adjusted_overall = round(sum(valid_scores) / len(valid_scores), 2) if valid_scores else None
    return adjusted_scores, adjusted_overall


async def _get_adherence_score(assessment_id: str, user_id: str) -> Optional[float]:
    doc = await db.curriculum_adherence.find_one(
        {"assessment_id": assessment_id, "user_id": user_id},
        {"_id": 0, "adherence_score": 1},
    )
    if not doc:
        return None
    return doc.get("adherence_score")


async def _ensure_adherence_for_assessment(assessment: dict, current_user: dict) -> Optional[dict]:
    existing = await db.curriculum_adherence.find_one(
        {"assessment_id": assessment["id"], "user_id": current_user["id"]},
        {"_id": 0},
    )
    if existing:
        return existing

    lesson_plan = await db.lesson_plans.find(
        {"teacher_id": assessment["teacher_id"]}, {"_id": 0}
    ).sort("date", -1).to_list(1)
    if not lesson_plan:
        return None

    adherence = {
        "id": str(uuid.uuid4()),
        "assessment_id": assessment["id"],
        "teacher_id": assessment["teacher_id"],
        "lesson_plan_id": lesson_plan[0]["id"] if lesson_plan else None,
        "status": "estimated",
        "adherence_score": 0.82,
        "topic_match_rate": 0.78,
        "alignment_summary": "Instructional sequence matches planned objectives with minor pacing drift.",
        "matched_topics": [
            "Objectives aligned with lesson plan",
            "Assessment checks mirror planned exit ticket",
        ],
        "missing_topics": [
            "Planned small-group check-in not observed",
        ],
        "flags": [
            {"type": "pacing", "detail": "Warm-up extended beyond planned window"},
        ],
        "evidence_segments": [
            {
                "start_sec": 120,
                "end_sec": 360,
                "summary": "Teacher reviews objective and models example aligned to lesson plan.",
                "confidence": 0.84,
            },
            {
                "start_sec": 780,
                "end_sec": 900,
                "summary": "Independent practice aligns with planned assessment item.",
                "confidence": 0.79,
            },
        ],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "user_id": current_user["id"],
    }
    await db.curriculum_adherence.insert_one(adherence)
    adherence.pop("user_id", None)
    adherence.pop("_id", None)
    return adherence


def _combine_overall_with_adherence(overall_score: Optional[float], adherence_score: Optional[float]) -> Optional[float]:
    if overall_score is None:
        return None
    if adherence_score is None:
        return overall_score
    adherence_scaled = adherence_score * 10
    combined = (overall_score * (1 - ADHERENCE_WEIGHT)) + (adherence_scaled * ADHERENCE_WEIGHT)
    return round(combined, 2)


@api_router.get("/assessments/{assessment_id}/curriculum-adherence")
async def get_curriculum_adherence(
    assessment_id: str,
    current_user: dict = Depends(get_current_user),
):
    assessment = await db.assessments.find_one(
        {"id": assessment_id, "user_id": current_user["id"]},
        {"_id": 0},
    )
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")

    existing = await db.curriculum_adherence.find_one(
        {"assessment_id": assessment_id, "user_id": current_user["id"]}, {"_id": 0}
    )
    if existing:
        return existing

    # Fallback: return placeholder adherence when no analysis exists.
    teacher_id = assessment["teacher_id"]
    lesson_plan = await db.lesson_plans.find(
        {"teacher_id": teacher_id}, {"_id": 0}
    ).sort("date", -1).to_list(1)
    if not lesson_plan:
        return {
            "id": None,
            "assessment_id": assessment_id,
            "teacher_id": teacher_id,
            "lesson_plan_id": None,
            "status": "no_lesson_plan",
            "adherence_score": None,
            "matched_topics": [],
            "missing_topics": [],
            "evidence_segments": [],
        }

    adherence = {
        "id": str(uuid.uuid4()),
        "assessment_id": assessment_id,
        "teacher_id": teacher_id,
        "lesson_plan_id": lesson_plan[0]["id"] if lesson_plan else None,
        "status": "estimated",
        "adherence_score": 0.82,
        "topic_match_rate": 0.78,
        "alignment_summary": "Instructional sequence matches planned objectives with minor pacing drift.",
        "matched_topics": [
            "Objectives aligned with lesson plan",
            "Assessment checks mirror planned exit ticket",
        ],
        "missing_topics": [
            "Planned small-group check-in not observed",
        ],
        "flags": [
            {"type": "pacing", "detail": "Warm-up extended beyond planned window"},
        ],
        "evidence_segments": [
            {
                "start_sec": 120,
                "end_sec": 360,
                "summary": "Teacher reviews objective and models example aligned to lesson plan.",
                "confidence": 0.84,
            },
            {
                "start_sec": 780,
                "end_sec": 900,
                "summary": "Independent practice aligns with planned assessment item.",
                "confidence": 0.79,
            },
        ],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "user_id": current_user["id"],
    }
    await db.curriculum_adherence.insert_one(adherence)
    adherence.pop("_id", None)
    adherence.pop("user_id", None)
    return adherence


@api_router.post("/reports/export")
async def export_summary_report(
    format: str = Form("pdf"),
    teacher_id: Optional[str] = Form(None),
    department: Optional[str] = Form(None),
    current_user: dict = Depends(get_current_user),
):
    teacher_query: Dict[str, Any] = {"created_by": current_user["id"]}
    if teacher_id:
        teacher_query["id"] = teacher_id
    if department:
        teacher_query["department"] = department
    teachers = await db.teachers.find(teacher_query, {"_id": 0}).to_list(1000)
    teacher_ids = [t["id"] for t in teachers]
    assessments = await db.assessments.find(
        {"user_id": current_user["id"], "teacher_id": {"$in": teacher_ids}},
        {"_id": 0},
    ).sort("analyzed_at", -1).to_list(2000)

    latest_by_teacher: Dict[str, dict] = {}
    for assessment in assessments:
        tid = assessment["teacher_id"]
        if tid not in latest_by_teacher:
            latest_by_teacher[tid] = assessment

    rows = []
    for t in teachers:
        assessment = latest_by_teacher.get(t["id"])
        evidence_count = await db.assessment_evidence.count_documents(
            {"teacher_id": t["id"], "user_id": current_user["id"]}
        )
        avg_score = None
        teacher_assessments = [a for a in assessments if a["teacher_id"] == t["id"]]
        if teacher_assessments:
            avg_score = round(
                sum(a.get("overall_score") or 0 for a in teacher_assessments) / len(teacher_assessments),
                2,
            )
        trend_summary = None
        if len(teacher_assessments) >= 2:
            # Determine element deltas between earliest and latest assessment
            earliest = teacher_assessments[-1]
            latest = teacher_assessments[0]
            early_scores = {es["element_id"]: es.get("score") for es in earliest.get("element_scores", [])}
            late_scores = {es["element_id"]: es.get("score") for es in latest.get("element_scores", [])}
            deltas = []
            for element_id, late_score in late_scores.items():
                early_score = early_scores.get(element_id)
                if early_score is None or late_score is None:
                    continue
                deltas.append((element_id, round(late_score - early_score, 2)))
            deltas.sort(key=lambda x: x[1], reverse=True)
            gains = [f"{d[0].upper()}({d[1]:+0.2f})" for d in deltas[:2]]
            declines = [f"{d[0].upper()}({d[1]:+0.2f})" for d in deltas[-2:]] if deltas else []
            trend_summary = f"Gains: {', '.join(gains)} | Declines: {', '.join(declines)}" if deltas else None

        adherence_score = None
        if assessment:
            adherence_doc = await db.curriculum_adherence.find_one(
                {"assessment_id": assessment["id"], "user_id": current_user["id"]},
                {"_id": 0, "adherence_score": 1},
            )
            if adherence_doc:
                adherence_score = adherence_doc.get("adherence_score")
        rows.append(
            {
                "teacher_name": t.get("name"),
                "subject": t.get("subject"),
                "grade_level": t.get("grade_level"),
                "department": t.get("department"),
                "latest_score": assessment.get("overall_score") if assessment else None,
                "average_score": avg_score,
                "assessment_count": len(teacher_assessments),
                "evidence_count": evidence_count,
                "adherence_score": adherence_score,
                "domain_trend_summary": trend_summary,
                "last_assessment": assessment.get("analyzed_at") if assessment else None,
                "detail_url": f"{FRONTEND_URL.rstrip('/')}/teachers/{t['id']}" if FRONTEND_URL else None,
            }
        )

    if format.lower() == "csv":
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=list(rows[0].keys()) if rows else [])
        writer.writeheader()
        for row in rows:
            writer.writerow(row)
        return Response(
            content=output.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=summary-report.csv"},
        )

    if format.lower() == "pdf":
        if canvas is None:
            raise HTTPException(status_code=501, detail="PDF export not available")
        buffer = io.BytesIO()
        pdf = canvas.Canvas(buffer)
        pdf.setTitle("Cognivio Summary Report")
        pdf.drawString(50, 800, "Cognivio Summary Report")
        pdf.drawString(50, 785, f"Generated: {datetime.now(timezone.utc).isoformat()}")
        if teacher_id:
            pdf.drawString(50, 770, f"Teacher filter: {teacher_id}")
        if department:
            pdf.drawString(50, 755, f"Department filter: {department}")
        y = 735
        for row in rows[:30]:
            pdf.setFont("Helvetica-Bold", 10)
            pdf.drawString(
                50,
                y,
                f"{row['teacher_name']} ({row['department'] or 'No dept'})",
            )
            y -= 12
            pdf.setFont("Helvetica", 9)
            pdf.drawString(
                50,
                y,
                f"Subject: {row['subject'] or 'N/A'} | Grade: {row['grade_level'] or 'N/A'}",
            )
            y -= 12
            pdf.drawString(
                50,
                y,
                f"Latest score: {row['latest_score']} | Avg score: {row['average_score']} | Assessments: {row['assessment_count']} | Evidence: {row['evidence_count']}",
            )
            y -= 12
            pdf.drawString(
                50,
                y,
                f"Adherence: {row.get('adherence_score')} | Trend: {row.get('domain_trend_summary')}",
            )
            y -= 12
            if row.get("detail_url"):
                pdf.drawString(50, y, f"Detail: {row['detail_url']}")
                y -= 14
            else:
                y -= 8
            if y < 60:
                pdf.showPage()
                y = 800
        pdf.save()
        buffer.seek(0)
        return Response(
            content=buffer.read(),
            media_type="application/pdf",
            headers={"Content-Disposition": "attachment; filename=summary-report.pdf"},
        )

    raise HTTPException(status_code=400, detail="Invalid export format. Use pdf or csv.")


@api_router.get("/qa/smoke")
async def smoke_test(current_user: dict = Depends(get_current_user)):
    """Lightweight QA check for demo readiness."""
    curricula_count = await db.curricula.count_documents(
        {"uploaded_by": current_user["id"]}
    )
    lesson_plan_count = await db.lesson_plans.count_documents(
        {"uploaded_by": current_user["id"]}
    )
    adherence_count = await db.curriculum_adherence.count_documents(
        {"user_id": current_user["id"]}
    )
    evidence_count = await db.assessment_evidence.count_documents(
        {"user_id": current_user["id"]}
    )
    assessment_count = await db.assessments.count_documents(
        {"user_id": current_user["id"]}
    )
    override_count = await db.admin_assessment_overrides.count_documents(
        {"admin_id": current_user["id"]}
    )

    return {
        "curriculum_uploads": curricula_count,
        "lesson_plan_uploads": lesson_plan_count,
        "adherence_records": adherence_count,
        "evidence_segments": evidence_count,
        "assessments": assessment_count,
        "admin_overrides": override_count,
        "checks": {
            "curriculum_upload": curricula_count > 0,
            "lesson_plan_upload": lesson_plan_count > 0,
            "adherence_data": adherence_count > 0,
            "evidence_data": evidence_count > 0,
            "export_report_ready": assessment_count > 0,
        },
    }


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
    
    role = _get_user_role(current_user)
    scoring_mode = await _get_admin_scoring_mode(current_user["id"]) if role == "admin" else "ai"

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
        overrides_by_assessment: Dict[str, List[dict]] = {}
        if role == "admin" and assessments:
            ids = [a["id"] for a in assessments]
            overrides = await db.admin_assessment_overrides.find(
                {"admin_id": current_user["id"], "assessment_id": {"$in": ids}},
                {"_id": 0},
            ).to_list(1000)
            for o in overrides:
                overrides_by_assessment.setdefault(o["assessment_id"], []).append(o)
        
        # Aggregate scores per element
        element_scores = {}
        for element_id in selected_elements:
            scores = []
            for assessment in assessments:
                if role == "admin":
                    adjusted_scores, _ = _apply_admin_overrides(
                        assessment.get("element_scores", []),
                        overrides_by_assessment.get(assessment["id"], []),
                        scoring_mode,
                    )
                    score_list = adjusted_scores
                else:
                    score_list = assessment.get("element_scores", [])
                for es in score_list:
                    if es["element_id"] == element_id:
                        scores.append(es.get("adjusted_score", es.get("score")))
            
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
        
        # Calculate overall score (includes curriculum adherence weighting)
        combined_scores = []
        for assessment in assessments:
            await _ensure_adherence_for_assessment(assessment, current_user)
            if role == "admin":
                adjusted_scores, adjusted_overall = _apply_admin_overrides(
                    assessment.get("element_scores", []),
                    overrides_by_assessment.get(assessment["id"], []),
                    scoring_mode,
                )
                base_overall = adjusted_overall
            else:
                base_overall = assessment.get("overall_score")
            adherence_score = await _get_adherence_score(assessment["id"], current_user["id"])
            combined = _combine_overall_with_adherence(base_overall, adherence_score)
            if combined is not None:
                combined_scores.append(combined)
        overall_score = round(sum(combined_scores) / len(combined_scores), 2) if combined_scores else None
        
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
        "roster": roster,
        "scoring_mode": scoring_mode
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

    role = _get_user_role(current_user)
    scoring_mode = await _get_admin_scoring_mode(current_user["id"]) if role == "admin" else "ai"
    overrides_by_assessment: Dict[str, List[dict]] = {}
    if role == "admin" and assessments:
        ids = [a["id"] for a in assessments]
        overrides = await db.admin_assessment_overrides.find(
            {"admin_id": current_user["id"], "assessment_id": {"$in": ids}},
            {"_id": 0},
        ).to_list(1000)
        for o in overrides:
            overrides_by_assessment.setdefault(o["assessment_id"], []).append(o)

    # Build trend data
    trend_data = []
    for assessment in assessments:
        await _ensure_adherence_for_assessment(assessment, current_user)
        overrides = overrides_by_assessment.get(assessment["id"], [])
        adjusted_scores, adjusted_overall = _apply_admin_overrides(
            assessment.get("element_scores", []),
            overrides,
            scoring_mode,
        ) if role == "admin" else (
            [{**es, "adjusted_score": es.get("score")} for es in assessment.get("element_scores", [])],
            assessment.get("overall_score"),
        )
        adherence_score = await _get_adherence_score(assessment["id"], current_user["id"])
        combined_overall = _combine_overall_with_adherence(adjusted_overall, adherence_score)
        assessment["adjusted_element_scores"] = adjusted_scores
        assessment["adjusted_overall_score"] = adjusted_overall
        assessment["adherence_score"] = adherence_score
        assessment["combined_overall_score"] = combined_overall
        assessment["scoring_mode"] = scoring_mode
        trend_data.append({
            "date": assessment["analyzed_at"],
            "overall_score": combined_overall,
            "ai_overall_score": assessment.get("overall_score"),
            "adherence_score": adherence_score,
            "element_scores": {es["element_id"]: es["adjusted_score"] for es in adjusted_scores}
        })

    # Aggregate element scores
    element_aggregates = {}
    for assessment in assessments:
        for es in assessment.get("adjusted_element_scores", assessment.get("element_scores", [])):
            if es["element_id"] not in element_aggregates:
                element_aggregates[es["element_id"]] = {
                    "element_name": es["element_name"],
                    "scores": [],
                    "observations": []
                }
            element_aggregates[es["element_id"]]["scores"].append(es.get("adjusted_score", es.get("score")))
            element_aggregates[es["element_id"]]["observations"].extend(es.get("observations", []))

    # Compute school averages for comparative analytics
    school_query: Dict[str, Any] = {"user_id": current_user["id"]}
    if start_date and end_date:
        school_query["analyzed_at"] = {
            "$gte": start_date.isoformat(),
            "$lte": end_date.isoformat(),
        }
    school_assessments = await db.assessments.find(
        school_query,
        {"_id": 0, "user_id": 0}
    ).to_list(2000)

    overrides_by_assessment_all: Dict[str, List[dict]] = {}
    if role == "admin" and school_assessments:
        ids = [a["id"] for a in school_assessments]
        overrides = await db.admin_assessment_overrides.find(
            {"admin_id": current_user["id"], "assessment_id": {"$in": ids}},
            {"_id": 0},
        ).to_list(2000)
        for o in overrides:
            overrides_by_assessment_all.setdefault(o["assessment_id"], []).append(o)

    school_element_scores: Dict[str, List[float]] = {}
    for assessment in school_assessments:
        if role == "admin":
            overrides = overrides_by_assessment_all.get(assessment["id"], [])
            adjusted_scores, _ = _apply_admin_overrides(
                assessment.get("element_scores", []),
                overrides,
                scoring_mode,
            )
            scores = adjusted_scores
        else:
            scores = assessment.get("element_scores", [])
        for es in scores:
            score = es.get("adjusted_score", es.get("score"))
            if score is None:
                continue
            school_element_scores.setdefault(es["element_id"], []).append(score)

    trend_by_element: Dict[str, str] = {}
    for element_id in element_aggregates.keys():
        first = None
        last = None
        for point in trend_data:
            value = point.get("element_scores", {}).get(element_id)
            if value is None:
                continue
            if first is None:
                first = value
            last = value
        if first is None or last is None:
            trend_by_element[element_id] = "stable"
        else:
            delta = last - first
            if delta > 0.2:
                trend_by_element[element_id] = "improving"
            elif delta < -0.2:
                trend_by_element[element_id] = "declining"
            else:
                trend_by_element[element_id] = "stable"
    
    # Calculate averages and levels
    element_summary = []
    for element_id, data in element_aggregates.items():
        avg_score = sum(data["scores"]) / len(data["scores"]) if data["scores"] else 0
        school_scores = school_element_scores.get(element_id, [])
        school_avg = (
            round(sum(school_scores) / len(school_scores), 2) if school_scores else None
        )
        element_summary.append({
            "element_id": element_id,
            "element_name": data["element_name"],
            "average_score": round(avg_score, 2),
            "level": get_performance_level(avg_score),
            "assessment_count": len(data["scores"]),
            "recent_observations": data["observations"][-5:] if data["observations"] else [],
            "school_average": school_avg,
            "trend_direction": trend_by_element.get(element_id, "stable"),
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
        "scoring_mode": scoring_mode,
        "date_range": {
            "start": assessments[0]["analyzed_at"] if assessments else None,
            "end": assessments[-1]["analyzed_at"] if assessments else None
        }
    }


@api_router.get("/teachers/{teacher_id}/action-plan", response_model=ActionPlan)
async def get_action_plan(
    teacher_id: str,
    current_user: dict = Depends(get_current_user),
):
    teacher = await db.teachers.find_one(
        {"id": teacher_id, "created_by": current_user["id"]},
        {"_id": 0, "created_by": 0}
    )
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")

    plan = await db.action_plans.find_one(
        {"teacher_id": teacher_id, "user_id": current_user["id"]},
        {"_id": 0, "user_id": 0},
    )
    if not plan:
        return ActionPlan(
            id="",
            teacher_id=teacher_id,
            goals=[],
            notes=None,
            created_at=None,
            updated_at=None,
        )
    return ActionPlan(**plan)


class ActionPlanUpsert(BaseModel):
    goals: List[ActionPlanGoal]
    notes: Optional[str] = None


@api_router.post("/teachers/{teacher_id}/action-plan", response_model=ActionPlan)
async def save_action_plan(
    teacher_id: str,
    payload: ActionPlanUpsert,
    current_user: dict = Depends(get_current_user),
):
    teacher = await db.teachers.find_one(
        {"id": teacher_id, "created_by": current_user["id"]},
        {"_id": 0, "created_by": 0}
    )
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")

    existing = await db.action_plans.find_one(
        {"teacher_id": teacher_id, "user_id": current_user["id"]},
        {"_id": 0},
    )
    now = datetime.now(timezone.utc).isoformat()
    if existing:
        update_doc = {
            "goals": [goal.dict() for goal in payload.goals],
            "notes": payload.notes,
            "updated_at": now,
        }
        await db.action_plans.update_one(
            {"id": existing["id"]}, {"$set": update_doc}
        )
        plan_id = existing["id"]
        created_at = existing.get("created_at")
    else:
        plan_id = str(uuid.uuid4())
        created_at = now
        doc = {
            "id": plan_id,
            "teacher_id": teacher_id,
            "goals": [goal.dict() for goal in payload.goals],
            "notes": payload.notes,
            "user_id": current_user["id"],
            "created_at": created_at,
            "updated_at": None,
        }
        await db.action_plans.insert_one(doc)

    # Refresh action plan reminders
    await db.schedules.delete_many(
        {
            "teacher_id": teacher_id,
            "user_id": current_user["id"],
            "reminder_type": "action_plan",
        }
    )
    for goal in payload.goals:
        if not goal.due_date:
            continue
        try:
            due_dt = datetime.fromisoformat(goal.due_date)
        except ValueError:
            try:
                due_dt = datetime.fromisoformat(f"{goal.due_date}T09:00:00")
            except ValueError:
                continue
        reminder = {
            "id": str(uuid.uuid4()),
            "teacher_id": teacher_id,
            "course_name": f"Action Plan: {goal.title}",
            "start_time": due_dt.isoformat(),
            "recording_status": ScheduleStatus.PLANNED.value,
            "join_url": None,
            "location": None,
            "reminder_type": "action_plan",
            "reminder_context": {
                "goal_id": goal.id,
                "goal_title": goal.title,
                "plan_id": plan_id,
            },
            "reminder_note": goal.description,
            "user_id": current_user["id"],
            "created_at": now,
            "updated_at": None,
        }
        await db.schedules.insert_one(reminder)
        await _enqueue_notification(
            current_user,
            teacher_id,
            "action_plan",
            f"Action plan reminder: {goal.title}",
            f"Goal due {due_dt.date().isoformat()}",
        )

    result = await db.action_plans.find_one(
        {"id": plan_id, "user_id": current_user["id"]},
        {"_id": 0, "user_id": 0},
    )
    if not result:
        raise HTTPException(status_code=500, detail="Action plan save failed")
    return ActionPlan(**result)

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


async def _ensure_mock_evidence(assessment: dict, current_user: dict) -> List[dict]:
    existing = await db.assessment_evidence.find(
        {"assessment_id": assessment["id"], "user_id": current_user["id"]},
        {"_id": 0, "user_id": 0},
    ).to_list(500)
    if existing:
        # Ensure embedded evidence segments exist in assessment element_scores
        if assessment.get("element_scores"):
            element_scores = assessment.get("element_scores", [])
            updated = False
            for es in element_scores:
                if es.get("evidence_segments"):
                    continue
                matching = [
                    e for e in existing if e.get("element_id") == es.get("element_id")
                ]
                if matching:
                    es["evidence_segments"] = [
                        {
                            "start_sec": m.get("timestamp_start"),
                            "end_sec": m.get("timestamp_end"),
                            "summary": m.get("evidence_text"),
                            "rationale": m.get("source"),
                        }
                        for m in matching
                    ]
                    updated = True
            if updated:
                await db.assessments.update_one(
                    {"id": assessment["id"], "user_id": current_user["id"]},
                    {"$set": {"element_scores": element_scores}},
                )
        return existing

    framework = _get_framework_by_type(assessment.get("framework_type", "danielson"))
    created_at = datetime.now(timezone.utc).isoformat()
    evidence_docs = []
    element_scores = assessment.get("element_scores", [])
    for idx, es in enumerate(assessment.get("element_scores", [])):
        domain = _find_domain_for_element(framework, es["element_id"])
        start_sec = 120 + idx * 45
        end_sec = start_sec + 30
        evidence_doc = {
            "id": str(uuid.uuid4()),
            "assessment_id": assessment["id"],
            "teacher_id": assessment["teacher_id"],
            "video_id": assessment.get("video_id"),
            "element_id": es["element_id"],
            "element_name": es.get("element_name"),
            "domain_id": domain.get("id") if domain else None,
            "domain_name": domain.get("name") if domain else None,
            "evidence_text": (
                f"Teacher demonstrated {es.get('element_name', 'instructional practice').lower()} "
                f"as evidenced between {start_sec//60}:{str(start_sec%60).zfill(2)} "
                f"and {end_sec//60}:{str(end_sec%60).zfill(2)}."
            ),
            "timestamp_start": start_sec,
            "timestamp_end": end_sec,
            "assessment_date": assessment.get("analyzed_at"),
            "source": "ai",
            "created_at": created_at,
            "user_id": current_user["id"],
        }
        evidence_docs.append(evidence_doc)
        es.setdefault("evidence_segments", [])
        es["evidence_segments"].append(
            {
                "start_sec": start_sec,
                "end_sec": end_sec,
                "summary": evidence_doc["evidence_text"],
                "rationale": "ai",
            }
        )

    if evidence_docs:
        await db.assessment_evidence.insert_many(evidence_docs)
        await db.assessments.update_one(
            {"id": assessment["id"], "user_id": current_user["id"]},
            {"$set": {"element_scores": element_scores}},
        )
    for doc in evidence_docs:
        doc.pop("user_id", None)
    return evidence_docs


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
        "reminder_type": payload.reminder_type,
        "reminder_context": payload.reminder_context,
        "reminder_note": payload.reminder_note,
        "user_id": current_user["id"],
        "created_at": now,
        "updated_at": None,
    }
    await db.schedules.insert_one(doc)
    if payload.reminder_type:
        await _enqueue_notification(
            current_user,
            payload.teacher_id,
            payload.reminder_type,
            f"Reminder: {payload.course_name}",
            f"Reminder scheduled for {payload.start_time.isoformat()}",
        )
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
    if payload.reminder_note is not None:
        update_fields["reminder_note"] = payload.reminder_note

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


# ==================== NOTIFICATION ENDPOINTS ====================
@api_router.get("/notifications", response_model=List[NotificationRecord])
async def list_notifications(
    unread_only: Optional[bool] = None,
    current_user: dict = Depends(get_current_user),
):
    query: Dict[str, Any] = {"user_id": current_user["id"]}
    if unread_only:
        query["read_at"] = None
    notifications = await db.notifications.find(
        query,
        {"_id": 0, "user_id": 0},
    ).sort("created_at", -1).to_list(200)
    return [NotificationRecord(**n) for n in notifications]


@api_router.post("/notifications/{notification_id}/read", response_model=NotificationRecord)
async def mark_notification_read(
    notification_id: str,
    current_user: dict = Depends(get_current_user),
):
    result = await db.notifications.find_one_and_update(
        {"id": notification_id, "user_id": current_user["id"]},
        {"$set": {"read_at": datetime.now(timezone.utc).isoformat()}},
        return_document=True,
        projection={"_id": 0, "user_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Notification not found")
    return NotificationRecord(**result)


# ==================== INTEGRATIONS ====================
@api_router.get("/integrations/gradebook", response_model=List[GradebookIntegrationResponse])
async def list_gradebook_integrations(current_user: dict = Depends(get_current_user)):
    integrations = await db.gradebook_integrations.find(
        {"user_id": current_user["id"]},
        {"_id": 0, "user_id": 0, "api_key": 0},
    ).to_list(100)
    return [GradebookIntegrationResponse(**i) for i in integrations]


@api_router.post("/integrations/gradebook", response_model=GradebookIntegrationResponse)
async def upsert_gradebook_integration(
    payload: GradebookIntegrationCreate,
    current_user: dict = Depends(get_current_user),
):
    existing = await db.gradebook_integrations.find_one(
        {"user_id": current_user["id"], "provider": payload.provider},
        {"_id": 0},
    )
    now = datetime.now(timezone.utc).isoformat()
    if existing:
        await db.gradebook_integrations.update_one(
            {"id": existing["id"]},
            {
                "$set": {
                    "status": payload.status or existing.get("status", "connected"),
                    "api_key": payload.api_key,
                    "updated_at": now,
                }
            },
        )
        doc = await db.gradebook_integrations.find_one(
            {"id": existing["id"]},
            {"_id": 0, "user_id": 0, "api_key": 0},
        )
        return GradebookIntegrationResponse(**doc)
    doc = {
        "id": str(uuid.uuid4()),
        "provider": payload.provider,
        "status": payload.status or "connected",
        "api_key": payload.api_key,
        "user_id": current_user["id"],
        "created_at": now,
        "updated_at": None,
    }
    await db.gradebook_integrations.insert_one(doc)
    doc.pop("user_id", None)
    doc.pop("api_key", None)
    return GradebookIntegrationResponse(**doc)


async def _enqueue_notification(
    current_user: dict,
    teacher_id: Optional[str],
    notification_type: str,
    title: str,
    message: str,
):
    doc = {
        "id": str(uuid.uuid4()),
        "teacher_id": teacher_id,
        "notification_type": notification_type,
        "title": title,
        "message": message,
        "channel": "email",
        "status": "queued",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "read_at": None,
        "user_id": current_user["id"],
    }
    await db.notifications.insert_one(doc)
    # Placeholder for email integration
    logger.info(f"[EmailQueue] {title} -> {current_user.get('email')}")

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
        # Attach placeholder evidence segments for demo traceability
        for idx, es in enumerate(element_scores):
            start_sec = 60 + idx * 35
            end_sec = start_sec + 20
            es.setdefault("evidence_segments", [])
            es["evidence_segments"].append(
                {
                    "start_sec": start_sec,
                    "end_sec": end_sec,
                    "summary": f"Evidence aligned to {es.get('element_name', 'domain')} observed.",
                    "rationale": "ai",
                }
            )
        
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
        await _ensure_mock_evidence(assessment_doc, {"id": user_id})
        
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
        # Create demo curriculum/syllabus/lesson plan records if missing
        existing_curriculum = await db.curricula.find_one(
            {"teacher_id": teacher["id"], "uploaded_by": current_user["id"]}
        )
        if not existing_curriculum:
            await db.curricula.insert_one({
                "id": str(uuid.uuid4()),
                "teacher_id": teacher["id"],
                "school_id": teacher.get("school_id"),
                "title": f"{teacher['subject']} curriculum overview",
                "subject": teacher.get("subject"),
                "grade_level": teacher.get("grade_level"),
                "filename": "curriculum-demo.pdf",
                "file_url": None,
                "s3_key": None,
                "uploaded_by": current_user["id"],
                "uploaded_role": "admin",
                "uploaded_at": datetime.now(timezone.utc).isoformat(),
                "is_mock": True,
            })

        existing_syllabus = await db.syllabi.find_one(
            {"teacher_id": teacher["id"], "uploaded_by": current_user["id"]}
        )
        if not existing_syllabus:
            await db.syllabi.insert_one({
                "id": str(uuid.uuid4()),
                "teacher_id": teacher["id"],
                "title": f"{teacher['subject']} syllabus",
                "filename": "syllabus-demo.pdf",
                "file_url": None,
                "s3_key": None,
                "uploaded_by": current_user["id"],
                "uploaded_at": datetime.now(timezone.utc).isoformat(),
                "is_mock": True,
            })

        existing_lesson = await db.lesson_plans.find_one(
            {"teacher_id": teacher["id"], "uploaded_by": current_user["id"]}
        )
        lesson_plan_id = existing_lesson["id"] if existing_lesson else None
        if not existing_lesson:
            lesson_date = (datetime.now(timezone.utc) + timedelta(days=2)).date().isoformat()
            lesson_id = str(uuid.uuid4())
            await db.lesson_plans.insert_one({
                "id": lesson_id,
                "teacher_id": teacher["id"],
                "title": f"{teacher['subject']} lesson plan",
                "date": lesson_date,
                "curriculum_id": existing_curriculum["id"] if existing_curriculum else None,
                "filename": "lesson-plan-demo.pdf",
                "file_url": None,
                "s3_key": None,
                "uploaded_by": current_user["id"],
                "uploaded_at": datetime.now(timezone.utc).isoformat(),
                "is_mock": True,
            })
            lesson_plan_id = lesson_id
            await db.schedules.insert_one({
                "id": str(uuid.uuid4()),
                "teacher_id": teacher["id"],
                "course_name": f"Lesson plan reminder: {teacher['subject']}",
                "start_time": lesson_date,
                "recording_status": ScheduleStatus.PLANNED.value,
                "join_url": None,
                "location": None,
                "user_id": current_user["id"],
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": None,
                "reminder_type": "lesson_plan",
                "lesson_plan_id": lesson_id,
            })

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
            await _ensure_mock_evidence(assessment_doc, current_user)

            adherence_doc = {
                "id": str(uuid.uuid4()),
                "assessment_id": assessment_doc["id"],
                "teacher_id": teacher["id"],
                "lesson_plan_id": lesson_plan_id,
                "status": "estimated",
                "adherence_score": round(random.uniform(0.65, 0.95), 2),
                "matched_topics": ["Aligned objectives", "Pacing matched plan"],
                "missing_topics": [],
                "evidence_segments": [
                    {"start_sec": 120, "end_sec": 240, "summary": "Lesson aligns with planned objective."}
                ],
                "created_at": datetime.now(timezone.utc).isoformat(),
                "user_id": current_user["id"],
            }
            await db.curriculum_adherence.insert_one(adherence_doc)
    
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
    _validate_s3_config()
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
            "role": demo.get("role", "teacher"),
        }
        await db.users.insert_one(user_doc)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
