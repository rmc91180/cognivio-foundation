export function buildInstitutionContextTags({
  subject,
  schoolLabel,
  organizationLabel,
  managerLabel,
  unknownLabel = "Unknown",
}) {
  if (!subject) return [];
  const schoolName = subject.school_name || subject.requested_school_name;
  const organizationName =
    subject.organization_name || subject.requested_organization_name;
  const managerValue =
    subject.manager_name ||
    subject.manager_email ||
    subject.requested_manager_email;

  return [
    schoolLabel
      ? { label: schoolLabel, value: schoolName || unknownLabel }
      : null,
    organizationLabel
      ? { label: organizationLabel, value: organizationName || unknownLabel }
      : null,
    managerLabel
      ? { label: managerLabel, value: managerValue || unknownLabel }
      : null,
  ].filter(Boolean);
}
