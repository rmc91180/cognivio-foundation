# Signup Rubric And Flow Implementation Plan

## Goal

Refactor Cognivio signup into a cleaner, lower-friction flow that:

- captures institution identity reliably
- captures institution type explicitly
- derives the correct tenant role automatically
- improves master-admin approval clarity
- reduces duplicate / ambiguous requests
- keeps routing and dashboard assignment aligned with the tenancy model

## Product Contract

### 1. User chooses access type first

- `Teacher`
- `Administrator`

### 2. User chooses institution type second

- `K-12 school`
- `Teacher training`

### 3. Cognivio derives the internal tenant role

- `Teacher` + `K-12 school` -> `teacher`
- `Teacher` + `Teacher training` -> `teacher`
- `Administrator` + `K-12 school` -> `school_admin`
- `Administrator` + `Teacher training` -> `training_admin`

### 4. Signup captures parent institution explicitly

Required:
- name
- email
- password
- parent organization / institution name
- institution type

K-12 specific:
- school name
- optional school administrator email for teachers

Teacher training specific:
- parent college / provider / training organization
- optional program / cohort / campus name
- optional training administrator email for teachers

## UX Changes

### Signup rubric

Replace role-only signup with two simple selectors:

1. `I am requesting access as`
   - `Teacher`
   - `Administrator`

2. `My institution is`
   - `K-12 school`
   - `Teacher training`

### Dynamic institution fields

#### Teacher + K-12
- district / network / parent organization
- school name
- optional school administrator email

#### Teacher + Teacher training
- college / provider / parent organization
- optional program / cohort name
- optional training administrator email

#### Administrator + K-12
- district / network / parent organization
- school name

#### Administrator + Teacher training
- college / provider / parent organization
- optional program / cohort name

### Signup summary block

Before submit, show a simple summary:

- access requested
- institution type
- parent organization
- school / program / cohort if entered
- linked administrator if entered

## Backend / Approval Changes

### Required

- frontend sends `organization_type`
- backend stores and returns `organization_type`
- approval emails show institution type explicitly
- user confirmation emails show institution type explicitly

### Streamline

- if the email already has a pending request, resubmission updates the request cleanly and returns a clearer message

## Validation

### Backend

- request-access accepts institution type cleanly
- K-12 teacher requires school name
- training teacher does not require school name
- pending re-request returns a clear pending-update message

### Frontend

- login stays simple
- signup branches correctly by access type + institution type
- K-12 and teacher-training variants show correct field labels
- summary block reflects the final derived role

### Browser smoke

- admin login works for both school and training admins
- signup rubric switches correctly across the four combinations

## Rollout Order

1. Add explicit institution-type rubric to auth UI
2. Derive tenant role from access type + institution type
3. Send `organization_type` in signup payload
4. Improve approval / confirmation messaging
5. Add pending-request update message
6. Validate with backend tests, frontend build, and Playwright smoke
