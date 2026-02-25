export interface CurriculumDocument {
  id: string;
  name: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface RecordingCompliancePolicy {
  requireGuardianConsent: boolean;
  requireTeacherConsent: boolean;
  defaultToAnonymizedVideo: boolean;
  retentionWindowDays: number;
}

const SCHOOL_CURRICULUM_KEY = 'school_curriculum_documents';
const TEACHER_CURRICULUM_PREFIX = 'teacher_curriculum_documents';
const RECORDING_POLICY_KEY = 'recording_compliance_policy';

const defaultPolicy: RecordingCompliancePolicy = {
  requireGuardianConsent: true,
  requireTeacherConsent: true,
  defaultToAnonymizedVideo: true,
  retentionWindowDays: 180,
};

const readJson = <T>(key: string, fallback: T): T => {
  try {
    const value = localStorage.getItem(key);
    if (!value) return fallback;
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const writeJson = (key: string, value: unknown) => {
  localStorage.setItem(key, JSON.stringify(value));
};

const createDocument = (file: File): CurriculumDocument => ({
  id: `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
  name: file.name,
  sizeBytes: file.size,
  uploadedAt: new Date().toISOString(),
});

export const curriculumStorage = {
  getSchoolDocuments(): CurriculumDocument[] {
    return readJson<CurriculumDocument[]>(SCHOOL_CURRICULUM_KEY, []);
  },

  addSchoolDocument(file: File): CurriculumDocument[] {
    const current = curriculumStorage.getSchoolDocuments();
    const updated = [createDocument(file), ...current];
    writeJson(SCHOOL_CURRICULUM_KEY, updated);
    return updated;
  },

  removeSchoolDocument(documentId: string): CurriculumDocument[] {
    const updated = curriculumStorage
      .getSchoolDocuments()
      .filter((doc) => doc.id !== documentId);
    writeJson(SCHOOL_CURRICULUM_KEY, updated);
    return updated;
  },

  getTeacherDocuments(userId: string): CurriculumDocument[] {
    return readJson<CurriculumDocument[]>(
      `${TEACHER_CURRICULUM_PREFIX}:${userId}`,
      []
    );
  },

  addTeacherDocument(userId: string, file: File): CurriculumDocument[] {
    const current = curriculumStorage.getTeacherDocuments(userId);
    const updated = [createDocument(file), ...current];
    writeJson(`${TEACHER_CURRICULUM_PREFIX}:${userId}`, updated);
    return updated;
  },

  removeTeacherDocument(userId: string, documentId: string): CurriculumDocument[] {
    const updated = curriculumStorage
      .getTeacherDocuments(userId)
      .filter((doc) => doc.id !== documentId);
    writeJson(`${TEACHER_CURRICULUM_PREFIX}:${userId}`, updated);
    return updated;
  },
};

export const recordingComplianceStorage = {
  getPolicy(): RecordingCompliancePolicy {
    return readJson<RecordingCompliancePolicy>(RECORDING_POLICY_KEY, defaultPolicy);
  },

  savePolicy(policy: RecordingCompliancePolicy): RecordingCompliancePolicy {
    writeJson(RECORDING_POLICY_KEY, policy);
    return policy;
  },
};
