-- migrate:up
PRAGMA foreign_keys = ON;

CREATE TABLE employee_announcements (
  id TEXT PRIMARY KEY,
  portable_id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  author_user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  publish_at TEXT NOT NULL,
  expires_at TEXT,
  audience_role TEXT NOT NULL DEFAULT 'all' CHECK (audience_role IN ('all', 'owner', 'admin', 'manager', 'staff')),
  archived_at TEXT,
  archived_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (expires_at IS NULL OR expires_at > publish_at)
);

CREATE INDEX idx_employee_announcements_tenant_visible ON employee_announcements(tenant_id, archived_at, publish_at, expires_at);
CREATE INDEX idx_employee_announcements_tenant_audience ON employee_announcements(tenant_id, audience_role, publish_at);

CREATE TABLE employee_announcement_reads (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  announcement_id TEXT NOT NULL REFERENCES employee_announcements(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  read_at TEXT NOT NULL,
  UNIQUE (tenant_id, announcement_id, employee_id)
);

CREATE INDEX idx_employee_announcement_reads_employee ON employee_announcement_reads(tenant_id, employee_id, read_at);

CREATE TABLE employee_direct_messages (
  id TEXT PRIMARY KEY,
  portable_id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  sender_user_id TEXT NOT NULL REFERENCES users(id),
  recipient_user_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  recipient_read_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (sender_user_id <> recipient_user_id)
);

CREATE INDEX idx_employee_direct_messages_sender ON employee_direct_messages(tenant_id, sender_user_id, recipient_user_id, sent_at);
CREATE INDEX idx_employee_direct_messages_recipient ON employee_direct_messages(tenant_id, recipient_user_id, sender_user_id, sent_at);
CREATE INDEX idx_employee_direct_messages_unread ON employee_direct_messages(tenant_id, recipient_user_id, recipient_read_at);

CREATE TRIGGER trg_employee_announcement_author_insert
BEFORE INSERT ON employee_announcements
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = NEW.author_user_id AND u.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_announcement_relationship_invalid') END;
  SELECT CASE WHEN NEW.archived_by_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = NEW.archived_by_user_id AND u.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_announcement_relationship_invalid') END;
END;

CREATE TRIGGER trg_employee_announcement_author_update
BEFORE UPDATE OF tenant_id, author_user_id, archived_by_user_id ON employee_announcements
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = NEW.author_user_id AND u.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_announcement_relationship_invalid') END;
  SELECT CASE WHEN NEW.archived_by_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = NEW.archived_by_user_id AND u.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_announcement_relationship_invalid') END;
END;

CREATE TRIGGER trg_employee_announcement_read_insert
BEFORE INSERT ON employee_announcement_reads
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM employee_announcements a WHERE a.id = NEW.announcement_id AND a.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_announcement_relationship_invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM employees e WHERE e.id = NEW.employee_id AND e.tenant_id = NEW.tenant_id AND e.user_id = NEW.user_id
  ) THEN RAISE(ABORT, 'employee_announcement_relationship_invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = NEW.user_id AND u.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_announcement_relationship_invalid') END;
END;

CREATE TRIGGER trg_employee_announcement_read_update
BEFORE UPDATE OF tenant_id, announcement_id, employee_id, user_id ON employee_announcement_reads
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM employee_announcements a WHERE a.id = NEW.announcement_id AND a.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_announcement_relationship_invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM employees e WHERE e.id = NEW.employee_id AND e.tenant_id = NEW.tenant_id AND e.user_id = NEW.user_id
  ) THEN RAISE(ABORT, 'employee_announcement_relationship_invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = NEW.user_id AND u.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_announcement_relationship_invalid') END;
END;

CREATE TRIGGER trg_employee_direct_message_insert
BEFORE INSERT ON employee_direct_messages
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users u
    JOIN employees e ON e.user_id = u.id AND e.tenant_id = u.tenant_id
    WHERE u.id = NEW.sender_user_id AND u.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_message_relationship_invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users u
    JOIN employees e ON e.user_id = u.id AND e.tenant_id = u.tenant_id
    WHERE u.id = NEW.recipient_user_id AND u.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_message_relationship_invalid') END;
END;

CREATE TRIGGER trg_employee_direct_message_update
BEFORE UPDATE OF tenant_id, sender_user_id, recipient_user_id ON employee_direct_messages
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users u
    JOIN employees e ON e.user_id = u.id AND e.tenant_id = u.tenant_id
    WHERE u.id = NEW.sender_user_id AND u.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_message_relationship_invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users u
    JOIN employees e ON e.user_id = u.id AND e.tenant_id = u.tenant_id
    WHERE u.id = NEW.recipient_user_id AND u.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_message_relationship_invalid') END;
END;

-- migrate:down
DROP TRIGGER IF EXISTS trg_employee_direct_message_update;
DROP TRIGGER IF EXISTS trg_employee_direct_message_insert;
DROP TRIGGER IF EXISTS trg_employee_announcement_read_update;
DROP TRIGGER IF EXISTS trg_employee_announcement_read_insert;
DROP TRIGGER IF EXISTS trg_employee_announcement_author_update;
DROP TRIGGER IF EXISTS trg_employee_announcement_author_insert;
DROP INDEX IF EXISTS idx_employee_direct_messages_unread;
DROP INDEX IF EXISTS idx_employee_direct_messages_recipient;
DROP INDEX IF EXISTS idx_employee_direct_messages_sender;
DROP INDEX IF EXISTS idx_employee_announcement_reads_employee;
DROP INDEX IF EXISTS idx_employee_announcements_tenant_audience;
DROP INDEX IF EXISTS idx_employee_announcements_tenant_visible;
DROP TABLE IF EXISTS employee_direct_messages;
DROP TABLE IF EXISTS employee_announcement_reads;
DROP TABLE IF EXISTS employee_announcements;
