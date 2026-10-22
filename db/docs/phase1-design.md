# FaceTrackDB: PostgreSQL Design (Phase 1)

Covers the relational schema, functional dependencies, the 3NF/BCNF check, the data dictionary and the procedure contract with the Qdrant/app side.

## 1. Relational schema

PK = primary key, FK = foreign key, UK = unique key (candidate key).

```
users(user_id PK, email UK, password_hash, role, created_at)
students(student_id PK, user_id FK->users UK, roll_no UK, name, hostel_id FK->hostels, room_no)
parents(parent_id PK, user_id FK->users UK, name, phone)
student_parent(student_id FK->students, parent_id FK->parents, relation)  PK(student_id, parent_id)
hostels(hostel_id PK, name UK)
gates(gate_id PK, hostel_id FK->hostels, name)
cameras(camera_id PK, gate_id FK->gates, location, status)
face_profiles(profile_id PK, student_id FK->students, qdrant_point_id UK, enrolled_at)
face_events(event_id PK, camera_id FK->cameras, student_id FK->students NULL,
            confidence, outcome, event_time, reviewed_by FK->users NULL)
attendance_sessions(session_id PK, hostel_id FK->hostels, session_date, start_time, end_time)
                    UK(hostel_id, session_date, start_time)
attendance(session_id FK->attendance_sessions, student_id FK->students,
           event_id FK->face_events NULL, status, marked_at)  PK(session_id, student_id)
entry_exit_log(log_id PK, student_id FK->students, gate_id FK->gates,
               event_id FK->face_events NULL, direction, event_time)
leave_requests(leave_id PK, student_id FK->students, start_date, end_date, reason,
               status, decided_by FK->parents NULL, decided_at NULL)
violations(violation_id PK, student_id FK->students, log_id FK->entry_exit_log NULL,
           session_id FK->attendance_sessions NULL, type, details, raised_at, status,
           resolved_by FK->users NULL)
```

### Relationships

| Relationship | Cardinality |
|---|---|
| users to students / parents | 1 : 1 (a login account belongs to one student or one parent) |
| hostels to students | 1 : N |
| students to parents | M : N (through student_parent) |
| hostels to gates, gates to cameras | 1 : N |
| students to face_profiles | 1 : N (3 to 5 enrolled images each) |
| cameras to face_events | 1 : N |
| face_events to attendance / entry_exit_log | 1 : 0..1 |
| attendance_sessions to attendance | 1 : N |
| students to attendance, entry_exit_log, leave_requests, violations | 1 : N |

## 2. Functional dependencies

| Table | Functional dependencies |
|---|---|
| users | user_id -> email, password_hash, role, created_at; email -> user_id |
| students | student_id -> user_id, roll_no, name, hostel_id, room_no; roll_no -> student_id; user_id -> student_id |
| parents | parent_id -> user_id, name, phone; user_id -> parent_id |
| student_parent | (student_id, parent_id) -> relation |
| hostels | hostel_id -> name; name -> hostel_id |
| gates | gate_id -> hostel_id, name |
| cameras | camera_id -> gate_id, location, status |
| face_profiles | profile_id -> student_id, qdrant_point_id, enrolled_at; qdrant_point_id -> profile_id |
| face_events | event_id -> camera_id, student_id, confidence, outcome, event_time, reviewed_by |
| attendance_sessions | session_id -> hostel_id, session_date, start_time, end_time; (hostel_id, session_date, start_time) -> session_id, end_time |
| attendance | (session_id, student_id) -> event_id, status, marked_at |
| entry_exit_log | log_id -> student_id, gate_id, event_id, direction, event_time |
| leave_requests | leave_id -> student_id, start_date, end_date, reason, status, decided_by, decided_at |
| violations | violation_id -> student_id, log_id, session_id, type, details, raised_at, status, resolved_by |

Note: room_no does **not** determine hostel_id, because the same room number can exist in different hostels. That is why there is no extra dependency in students.

## 3. Normalization check (3NF / BCNF)

For BCNF, the left side of every non-trivial dependency must be a candidate key.

| Table | Candidate keys | Result |
|---|---|---|
| users | user_id, email | BCNF |
| students | student_id, roll_no, user_id | BCNF |
| parents | parent_id, user_id | BCNF |
| student_parent | (student_id, parent_id) | BCNF |
| hostels | hostel_id, name | BCNF |
| gates | gate_id | BCNF |
| cameras | camera_id | BCNF |
| face_profiles | profile_id, qdrant_point_id | BCNF |
| face_events | event_id | BCNF |
| attendance_sessions | session_id, (hostel_id, session_date, start_time) | BCNF |
| attendance | (session_id, student_id) | BCNF |
| entry_exit_log | log_id | BCNF |
| leave_requests | leave_id | BCNF |
| violations | violation_id | BCNF |

**Design decisions that keep it normalized**
- Confidence is stored once, in `face_events`, not copied into `attendance` and `entry_exit_log`.
- Hostel details are stored once in `hostels`, not repeated in students or gates.
- The many-to-many between students and parents has its own table, so no repeating groups.

**Cross-table consistency (not a normal-form issue, but needs enforcing)**
- If `violations.log_id` is set, its student must match `entry_exit_log.student_id`.
- If `attendance.event_id` is set, its student must match `face_events.student_id`.
- `leave_requests.decided_by` must be a parent linked to that student.
These are enforced in Phase 3 with triggers or composite foreign keys.

## 4. Data dictionary

### users
| Column | Type | Constraints | Meaning |
|---|---|---|---|
| user_id | SERIAL | PK | Login account id |
| email | VARCHAR(255) | NOT NULL, UNIQUE | Login name |
| password_hash | VARCHAR(255) | NOT NULL | Hashed password (never plain text) |
| role | VARCHAR(20) | NOT NULL, CHECK in (student, parent, warden, security, admin) | Access role |
| created_at | TIMESTAMP | NOT NULL, DEFAULT now() | Account creation time |

### students
| Column | Type | Constraints | Meaning |
|---|---|---|---|
| student_id | SERIAL | PK | Student id (also the Qdrant payload link) |
| user_id | INT | NOT NULL, UNIQUE, FK users | Login account |
| roll_no | VARCHAR(20) | NOT NULL, UNIQUE | College roll number |
| name | VARCHAR(100) | NOT NULL | Full name |
| hostel_id | INT | NOT NULL, FK hostels | Hostel the student lives in |
| room_no | VARCHAR(10) | | Room number |

### parents
| Column | Type | Constraints | Meaning |
|---|---|---|---|
| parent_id | SERIAL | PK | Parent/guardian id |
| user_id | INT | NOT NULL, UNIQUE, FK users | Login account |
| name | VARCHAR(100) | NOT NULL | Full name |
| phone | VARCHAR(15) | | Contact number |

### student_parent
| Column | Type | Constraints | Meaning |
|---|---|---|---|
| student_id | INT | PK part, FK students | Ward |
| parent_id | INT | PK part, FK parents | Parent/guardian |
| relation | VARCHAR(20) | | Father, mother, guardian |

### hostels
| Column | Type | Constraints | Meaning |
|---|---|---|---|
| hostel_id | SERIAL | PK | Hostel id |
| name | VARCHAR(100) | NOT NULL, UNIQUE | Hostel name |

### gates
| Column | Type | Constraints | Meaning |
|---|---|---|---|
| gate_id | SERIAL | PK | Gate id |
| hostel_id | INT | NOT NULL, FK hostels | Hostel the gate belongs to |
| name | VARCHAR(50) | NOT NULL | Gate name (Main gate, Back gate) |

### cameras
| Column | Type | Constraints | Meaning |
|---|---|---|---|
| camera_id | SERIAL | PK | Camera id |
| gate_id | INT | NOT NULL, FK gates | Gate where the camera is mounted |
| location | VARCHAR(100) | | Description of position |
| status | VARCHAR(15) | NOT NULL, CHECK in (active, inactive) | Whether it is in use |

### face_profiles
| Column | Type | Constraints | Meaning |
|---|---|---|---|
| profile_id | SERIAL | PK | Profile row id |
| student_id | INT | NOT NULL, FK students | Student whose face this is |
| qdrant_point_id | UUID | NOT NULL, UNIQUE | Id of the vector stored in Qdrant |
| enrolled_at | TIMESTAMP | NOT NULL, DEFAULT now() | Enrolment time |

### face_events
| Column | Type | Constraints | Meaning |
|---|---|---|---|
| event_id | SERIAL | PK | Recognition event id |
| camera_id | INT | NOT NULL, FK cameras | Camera that captured the face |
| student_id | INT | FK students, NULL | Matched student (null if no match) |
| confidence | NUMERIC(4,3) | CHECK between 0 and 1 | Cosine similarity score |
| outcome | VARCHAR(20) | NOT NULL, CHECK in (matched, low_confidence, no_match) | Result of the threshold decision |
| event_time | TIMESTAMP | NOT NULL, DEFAULT now() | When it happened |
| reviewed_by | INT | FK users, NULL | Warden who reviewed a low-confidence event |

### attendance_sessions
| Column | Type | Constraints | Meaning |
|---|---|---|---|
| session_id | SERIAL | PK | Roll-call session id |
| hostel_id | INT | NOT NULL, FK hostels | Hostel being counted |
| session_date | DATE | NOT NULL | Date of the roll call |
| start_time | TIME | NOT NULL | Opens at |
| end_time | TIME | NOT NULL, CHECK end_time > start_time | Closes at |
| (table) | | UNIQUE (hostel_id, session_date, start_time) | One session per slot |

### attendance
| Column | Type | Constraints | Meaning |
|---|---|---|---|
| session_id | INT | PK part, FK attendance_sessions | Session |
| student_id | INT | PK part, FK students | Student |
| event_id | INT | FK face_events, NULL | Recognition event (null if marked manually) |
| status | VARCHAR(20) | NOT NULL, CHECK in (present, absent, low_confidence) | Result |
| marked_at | TIMESTAMP | | When it was marked |

### entry_exit_log
| Column | Type | Constraints | Meaning |
|---|---|---|---|
| log_id | SERIAL | PK | Gate log id |
| student_id | INT | NOT NULL, FK students | Student |
| gate_id | INT | NOT NULL, FK gates | Gate used |
| event_id | INT | FK face_events, NULL | Recognition event |
| direction | VARCHAR(3) | NOT NULL, CHECK in (IN, OUT) | Entering or leaving |
| event_time | TIMESTAMP | NOT NULL, DEFAULT now() | When it happened |

### leave_requests
| Column | Type | Constraints | Meaning |
|---|---|---|---|
| leave_id | SERIAL | PK | Leave request id |
| student_id | INT | NOT NULL, FK students | Applicant |
| start_date | DATE | NOT NULL | First day of leave |
| end_date | DATE | NOT NULL, CHECK end_date >= start_date | Last day of leave |
| reason | TEXT | | Reason given |
| status | VARCHAR(15) | NOT NULL, CHECK in (pending, approved, rejected) | Decision state |
| decided_by | INT | FK parents, NULL | Parent who decided |
| decided_at | TIMESTAMP | NULL | Decision time |

### violations
| Column | Type | Constraints | Meaning |
|---|---|---|---|
| violation_id | SERIAL | PK | Violation id |
| student_id | INT | NOT NULL, FK students | Student who broke a rule |
| log_id | INT | FK entry_exit_log, NULL | Gate event that caused it, if any |
| session_id | INT | FK attendance_sessions, NULL | Session that caused it, if any |
| type | VARCHAR(30) | NOT NULL, CHECK in (late_return, missed_attendance, no_leave) | Kind of violation |
| details | TEXT | | Remarks (full-text searchable later) |
| raised_at | TIMESTAMP | NOT NULL, DEFAULT now() | When it was raised |
| status | VARCHAR(15) | NOT NULL, CHECK in (open, resolved) | Handling state |
| resolved_by | INT | FK users, NULL | Warden who resolved it |

## 5. Contract with Person B (procedures)

The matching endpoint first inserts a row into `face_events`, then calls a procedure with that event id. Face matching and the threshold decision stay on his side; the rule checks stay in the database.

```sql
-- Mark a student present (or low_confidence) in a session.
-- Rejects duplicates and students outside the session's hostel.
CALL mark_attendance(p_student_id INT, p_session_id INT, p_event_id INT);

-- Record a gate crossing. Checks approved leave, raises a violation
-- (late_return / no_leave) in the same transaction when a rule is broken.
CALL record_entry_exit(p_student_id INT, p_gate_id INT, p_event_id INT, p_direction VARCHAR);
```

Agreed points to confirm with Person B:
1. His endpoint inserts the `face_events` row (outcome decided by his threshold) and passes the new `event_id`.
2. `face_profiles` rows are inserted by his enrolment endpoint, with `qdrant_point_id` set to the Qdrant point id.
3. Errors from the procedures (duplicate attendance, no active session) come back as SQL exceptions that his endpoint turns into HTTP responses.
