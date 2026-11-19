# Bangron Virtual Office — Database Schema Specification

## 1. Engine & Storage
- **Engine:** SQLite 3 (via `better-sqlite3`)
- **Default Database File:** `storage/database/bangron-virtual-office.sqlite`
- **Concurrency Mode:** WAL (`PRAGMA journal_mode = WAL;`)
- **Integrity:** Foreign Key Constraints (`PRAGMA foreign_keys = ON;`)
- **Performance Settings:** `PRAGMA busy_timeout = 5000;`, `PRAGMA synchronous = NORMAL;`

---

## 2. Table Specifications

### 2.1 `users`
Director and operator accounts.
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `name` TEXT NOT NULL
- `email` TEXT UNIQUE NOT NULL
- `password_hash` TEXT NOT NULL
- `role` TEXT NOT NULL DEFAULT 'director'
- `is_active` INTEGER NOT NULL DEFAULT 1
- `last_login_at` TEXT
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

### 2.2 `agent_profiles`
Conceptual specialist agent definitions.
- `id` TEXT PRIMARY KEY
- `name` TEXT NOT NULL
- `slug` TEXT UNIQUE NOT NULL
- `department` TEXT NOT NULL
- `description` TEXT
- `system_role` TEXT NOT NULL
- `capabilities_json` TEXT NOT NULL DEFAULT '[]'
- `allowed_tools_json` TEXT NOT NULL DEFAULT '[]'
- `default_room_id` TEXT NOT NULL
- `is_active` INTEGER NOT NULL DEFAULT 1
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

### 2.3 `agent_instances`
Running or registered runtime agent instances.
- `id` TEXT PRIMARY KEY
- `profile_id` TEXT NOT NULL REFERENCES `agent_profiles`(id) ON DELETE RESTRICT
- `runtime_type` TEXT NOT NULL DEFAULT 'hermes'
- `runtime_identifier` TEXT
- `display_name` TEXT NOT NULL
- `status` TEXT NOT NULL DEFAULT 'offline' -- offline, idle, thinking, walking, working, waiting, collaborating, completed, failed
- `current_room_id` TEXT REFERENCES `office_rooms`(id)
- `current_workstation_id` TEXT REFERENCES `office_workstations`(id)
- `metadata_json` TEXT DEFAULT '{}'
- `last_seen_at` TEXT
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

### 2.4 `agent_sessions`
Execution sessions corresponding to tasks.
- `id` TEXT PRIMARY KEY
- `agent_instance_id` TEXT NOT NULL REFERENCES `agent_instances`(id) ON DELETE CASCADE
- `parent_session_id` TEXT REFERENCES `agent_sessions`(id) ON DELETE SET NULL
- `external_session_id` TEXT
- `task_id` TEXT REFERENCES `agent_tasks`(id) ON DELETE SET NULL
- `status` TEXT NOT NULL DEFAULT 'running'
- `started_at` TEXT NOT NULL
- `ended_at` TEXT
- `metadata_json` TEXT DEFAULT '{}'
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

### 2.5 `projects`
Studio projects.
- `id` TEXT PRIMARY KEY
- `name` TEXT NOT NULL
- `slug` TEXT UNIQUE NOT NULL
- `description` TEXT
- `status` TEXT NOT NULL DEFAULT 'active'
- `priority` TEXT NOT NULL DEFAULT 'normal'
- `start_date` TEXT
- `due_date` TEXT
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

### 2.6 `agent_tasks`
Tasks assigned to agents.
- `id` TEXT PRIMARY KEY
- `project_id` TEXT REFERENCES `projects`(id) ON DELETE SET NULL
- `parent_task_id` TEXT REFERENCES `agent_tasks`(id) ON DELETE SET NULL
- `title` TEXT NOT NULL
- `description` TEXT
- `status` TEXT NOT NULL DEFAULT 'pending' -- draft, pending, assigned, running, waiting, blocked, completed, failed, cancelled
- `priority` TEXT NOT NULL DEFAULT 'normal' -- low, normal, high, critical
- `assigned_agent_id` TEXT REFERENCES `agent_instances`(id) ON DELETE SET NULL
- `created_by` TEXT NOT NULL DEFAULT 'director'
- `requires_approval` INTEGER NOT NULL DEFAULT 0
- `started_at` TEXT
- `completed_at` TEXT
- `due_at` TEXT
- `result_summary` TEXT
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

### 2.7 `agent_dependencies`
DAG-enforced task dependencies.
- `id` TEXT PRIMARY KEY
- `task_id` TEXT NOT NULL REFERENCES `agent_tasks`(id) ON DELETE CASCADE
- `depends_on_task_id` TEXT NOT NULL REFERENCES `agent_tasks`(id) ON DELETE CASCADE
- `dependency_type` TEXT NOT NULL DEFAULT 'finish_to_start'
- `created_at` TEXT NOT NULL
- UNIQUE (`task_id`, `depends_on_task_id`)

### 2.8 `agent_activities`
Fine-grained operational activity log.
- `id` TEXT PRIMARY KEY
- `agent_instance_id` TEXT NOT NULL REFERENCES `agent_instances`(id) ON DELETE CASCADE
- `session_id` TEXT REFERENCES `agent_sessions`(id) ON DELETE SET NULL
- `task_id` TEXT REFERENCES `agent_tasks`(id) ON DELETE SET NULL
- `activity_type` TEXT NOT NULL
- `description` TEXT NOT NULL
- `metadata_json` TEXT DEFAULT '{}'
- `occurred_at` TEXT NOT NULL
- `created_at` TEXT NOT NULL

### 2.9 `agent_events`
Ingested event log for audit, replay, and idempotency.
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `event_id` TEXT UNIQUE NOT NULL
- `event_type` TEXT NOT NULL
- `source` TEXT NOT NULL DEFAULT 'hermes'
- `agent_id` TEXT
- `instance_id` TEXT
- `session_id` TEXT
- `parent_session_id` TEXT
- `task_id` TEXT
- `correlation_id` TEXT
- `payload_json` TEXT NOT NULL
- `occurred_at` TEXT NOT NULL
- `processed_at` TEXT
- `processing_status` TEXT NOT NULL DEFAULT 'received' -- received, processed, ignored, failed
- `created_at` TEXT NOT NULL

### 2.10 `office_rooms`
The 12 studio rooms in the 2.5D virtual office.
- `id` TEXT PRIMARY KEY
- `name` TEXT NOT NULL
- `slug` TEXT UNIQUE NOT NULL
- `department` TEXT NOT NULL
- `description` TEXT
- `position_x` REAL NOT NULL
- `position_y` REAL NOT NULL
- `width` REAL NOT NULL
- `height` REAL NOT NULL
- `metadata_json` TEXT DEFAULT '{}'
- `is_active` INTEGER NOT NULL DEFAULT 1
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

### 2.11 `office_workstations`
Specific furniture stations in rooms.
- `id` TEXT PRIMARY KEY
- `room_id` TEXT NOT NULL REFERENCES `office_rooms`(id) ON DELETE CASCADE
- `name` TEXT NOT NULL
- `workstation_type` TEXT NOT NULL DEFAULT 'desk'
- `position_x` REAL NOT NULL
- `position_y` REAL NOT NULL
- `capacity` INTEGER NOT NULL DEFAULT 1
- `status` TEXT NOT NULL DEFAULT 'available'
- `metadata_json` TEXT DEFAULT '{}'
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

### 2.12 `office_positions`
Current spatial positioning of agents.
- `id` TEXT PRIMARY KEY
- `agent_instance_id` TEXT UNIQUE NOT NULL REFERENCES `agent_instances`(id) ON DELETE CASCADE
- `room_id` TEXT NOT NULL REFERENCES `office_rooms`(id) ON DELETE CASCADE
- `workstation_id` TEXT REFERENCES `office_workstations`(id) ON DELETE SET NULL
- `position_x` REAL NOT NULL
- `position_y` REAL NOT NULL
- `direction` TEXT NOT NULL DEFAULT 'SE'
- `updated_at` TEXT NOT NULL

### 2.13 `deliverables`
Files, design specs, code patches produced by tasks.
- `id` TEXT PRIMARY KEY
- `task_id` TEXT NOT NULL REFERENCES `agent_tasks`(id) ON DELETE CASCADE
- `agent_instance_id` TEXT NOT NULL REFERENCES `agent_instances`(id) ON DELETE CASCADE
- `name` TEXT NOT NULL
- `description` TEXT
- `file_path` TEXT NOT NULL
- `mime_type` TEXT NOT NULL
- `file_size` INTEGER NOT NULL
- `status` TEXT NOT NULL DEFAULT 'ready'
- `metadata_json` TEXT DEFAULT '{}'
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

### 2.14 `approval_requests`
Sensitive actions requiring Director authorization.
- `id` TEXT PRIMARY KEY
- `task_id` TEXT REFERENCES `agent_tasks`(id) ON DELETE SET NULL
- `requested_by` TEXT NOT NULL REFERENCES `agent_instances`(id) ON DELETE CASCADE
- `action_type` TEXT NOT NULL
- `description` TEXT NOT NULL
- `risk_level` TEXT NOT NULL DEFAULT 'medium' -- low, medium, high, critical
- `payload_json` TEXT NOT NULL DEFAULT '{}'
- `status` TEXT NOT NULL DEFAULT 'pending' -- pending, approved, rejected, expired, cancelled
- `reviewed_by` TEXT REFERENCES `users`(id) ON DELETE SET NULL
- `reviewed_at` TEXT
- `review_notes` TEXT
- `expires_at` TEXT
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

### 2.15 `audit_logs`
Immutable record of security and administrative operations.
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `user_id` INTEGER REFERENCES `users`(id) ON DELETE SET NULL
- `actor_type` TEXT NOT NULL DEFAULT 'user'
- `actor_id` TEXT NOT NULL
- `action` TEXT NOT NULL
- `resource_type` TEXT NOT NULL
- `resource_id` TEXT
- `before_json` TEXT
- `after_json` TEXT
- `ip_address` TEXT
- `user_agent` TEXT
- `created_at` TEXT NOT NULL

### 2.16 `system_settings`
Configurable operational keys.
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `setting_key` TEXT UNIQUE NOT NULL
- `setting_value` TEXT NOT NULL
- `is_secret` INTEGER NOT NULL DEFAULT 0
- `updated_at` TEXT NOT NULL

### 2.17 `sessions`
Express session storage table in SQLite.
- `sid` TEXT PRIMARY KEY
- `sess` TEXT NOT NULL
- `expired_at` INTEGER NOT NULL
