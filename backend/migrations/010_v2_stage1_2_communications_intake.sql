-- migrate:up
PRAGMA foreign_keys = ON;

CREATE TABLE tenant_email_settings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  sender_name TEXT NOT NULL DEFAULT '',
  sender_email TEXT,
  sendgrid_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE outbound_email_sends (
  id TEXT PRIMARY KEY,
  portable_id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  idempotency_key TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  related_entity_type TEXT NOT NULL CHECK (related_entity_type IN ('estimate', 'order', 'invoice')),
  related_entity_id TEXT NOT NULL,
  message_type TEXT NOT NULL CHECK (message_type IN ('estimate', 'order', 'invoice', 'general')),
  sender_user_id TEXT NOT NULL REFERENCES users(id),
  from_email TEXT NOT NULL,
  from_name TEXT NOT NULL,
  to_email TEXT NOT NULL,
  cc_json TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'sendgrid',
  provider_message_id TEXT,
  delivery_state TEXT NOT NULL CHECK (delivery_state IN ('queued', 'sent', 'delivered', 'deferred', 'bounced', 'dropped', 'blocked', 'spam_report', 'opened', 'clicked', 'failed')),
  failure_reason TEXT,
  document_attached INTEGER NOT NULL DEFAULT 0,
  order_attachment_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE customer_communications (
  id TEXT PRIMARY KEY,
  portable_id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  direction TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound', 'internal')),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'phone', 'walk_in', 'manual')),
  activity_type TEXT NOT NULL CHECK (activity_type IN ('app_sent_email', 'manual_note', 'delivery_event', 'intake_source')),
  author_user_id TEXT REFERENCES users(id),
  sender_email TEXT,
  recipient_emails_json TEXT NOT NULL DEFAULT '[]',
  subject TEXT,
  body_text TEXT,
  summary TEXT NOT NULL,
  related_entity_type TEXT CHECK (related_entity_type IN ('customer', 'estimate', 'order', 'invoice', 'order_intake')),
  related_entity_id TEXT,
  outbound_email_send_id TEXT REFERENCES outbound_email_sends(id),
  intake_item_id TEXT,
  delivery_state TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE sendgrid_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  outbound_email_send_id TEXT NOT NULL REFERENCES outbound_email_sends(id),
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, provider_event_id)
);

CREATE TABLE tenant_intake_addresses (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  address_token TEXT NOT NULL UNIQUE,
  full_address TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  rotated_at TEXT,
  rotation_reason TEXT,
  created_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE intake_source_messages (
  id TEXT PRIMARY KEY,
  portable_id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  provider TEXT NOT NULL DEFAULT 'sendgrid_inbound_parse',
  provider_message_id TEXT NOT NULL,
  intake_address TEXT NOT NULL,
  sender_name TEXT,
  sender_email TEXT NOT NULL,
  recipients_json TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL,
  sent_at TEXT,
  received_at TEXT NOT NULL,
  text_body TEXT,
  html_body TEXT,
  sanitized_html TEXT,
  payload_hash TEXT NOT NULL,
  receipt_status TEXT NOT NULL CHECK (receipt_status IN ('received', 'quarantined', 'rejected')),
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, provider_message_id)
);

CREATE TABLE order_intake_items (
  id TEXT PRIMARY KEY,
  portable_id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  source_message_id TEXT NOT NULL REFERENCES intake_source_messages(id),
  customer_id TEXT REFERENCES customers(id),
  assigned_user_id TEXT REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('new', 'reviewing', 'need_information', 'waiting_for_customer', 'ready_to_create', 'converted_to_order', 'attached_to_existing_order', 'closed_not_an_order')),
  summary TEXT NOT NULL,
  follow_up_at TEXT,
  converted_order_id TEXT UNIQUE REFERENCES orders(id),
  linked_order_id TEXT REFERENCES orders(id),
  converted_by_user_id TEXT REFERENCES users(id),
  converted_at TEXT,
  internal_notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, source_message_id)
);

CREATE TABLE intake_attachments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  source_message_id TEXT NOT NULL REFERENCES intake_source_messages(id),
  original_filename TEXT NOT NULL,
  storage_key TEXT UNIQUE,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT,
  order_attachment_id TEXT REFERENCES order_attachments(id),
  accepted INTEGER NOT NULL DEFAULT 1,
  rejection_reason TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_outbound_email_tenant_customer ON outbound_email_sends(tenant_id, customer_id, created_at);
CREATE INDEX idx_outbound_email_related ON outbound_email_sends(tenant_id, related_entity_type, related_entity_id, created_at);
CREATE INDEX idx_communications_customer ON customer_communications(tenant_id, customer_id, created_at);
CREATE INDEX idx_communications_related ON customer_communications(tenant_id, related_entity_type, related_entity_id, created_at);
CREATE INDEX idx_sendgrid_events_send ON sendgrid_events(tenant_id, outbound_email_send_id, occurred_at);
CREATE INDEX idx_intake_addresses_tenant_active ON tenant_intake_addresses(tenant_id, active);
CREATE INDEX idx_intake_messages_tenant_received ON intake_source_messages(tenant_id, received_at);
CREATE INDEX idx_order_intake_status ON order_intake_items(tenant_id, status, assigned_user_id, follow_up_at);
CREATE INDEX idx_order_intake_customer ON order_intake_items(tenant_id, customer_id, created_at);
CREATE INDEX idx_intake_attachments_message ON intake_attachments(tenant_id, source_message_id);

CREATE TRIGGER trg_outbound_email_customer_tenant_insert
BEFORE INSERT ON outbound_email_sends
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM customers c WHERE c.id = NEW.customer_id AND c.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'email_customer_tenant_mismatch') END;
  SELECT CASE WHEN NEW.related_entity_type = 'estimate' AND NOT EXISTS (
    SELECT 1 FROM estimates e WHERE e.id = NEW.related_entity_id AND e.customer_id = NEW.customer_id AND e.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'email_related_record_invalid') END;
  SELECT CASE WHEN NEW.related_entity_type = 'order' AND NOT EXISTS (
    SELECT 1 FROM orders o WHERE o.id = NEW.related_entity_id AND o.customer_id = NEW.customer_id AND o.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'email_related_record_invalid') END;
  SELECT CASE WHEN NEW.related_entity_type = 'invoice' AND NOT EXISTS (
    SELECT 1 FROM invoices i WHERE i.id = NEW.related_entity_id AND i.customer_id = NEW.customer_id AND i.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'email_related_record_invalid') END;
END;

CREATE TRIGGER trg_order_intake_relationship_insert
BEFORE INSERT ON order_intake_items
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM intake_source_messages m WHERE m.id = NEW.source_message_id AND m.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'intake_source_message_invalid') END;
  SELECT CASE WHEN NEW.customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM customers c WHERE c.id = NEW.customer_id AND c.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'intake_customer_tenant_mismatch') END;
  SELECT CASE WHEN NEW.assigned_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = NEW.assigned_user_id AND u.tenant_id = NEW.tenant_id AND u.active = 1
  ) THEN RAISE(ABORT, 'intake_assignee_tenant_mismatch') END;
  SELECT CASE WHEN NEW.converted_order_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM orders o WHERE o.id = NEW.converted_order_id AND o.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'intake_order_tenant_mismatch') END;
  SELECT CASE WHEN NEW.linked_order_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM orders o WHERE o.id = NEW.linked_order_id AND o.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'intake_order_tenant_mismatch') END;
END;

CREATE TRIGGER trg_order_intake_relationship_update
BEFORE UPDATE OF tenant_id, source_message_id, customer_id, assigned_user_id, converted_order_id, linked_order_id ON order_intake_items
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM intake_source_messages m WHERE m.id = NEW.source_message_id AND m.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'intake_source_message_invalid') END;
  SELECT CASE WHEN NEW.customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM customers c WHERE c.id = NEW.customer_id AND c.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'intake_customer_tenant_mismatch') END;
  SELECT CASE WHEN NEW.assigned_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = NEW.assigned_user_id AND u.tenant_id = NEW.tenant_id AND u.active = 1
  ) THEN RAISE(ABORT, 'intake_assignee_tenant_mismatch') END;
  SELECT CASE WHEN NEW.converted_order_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM orders o WHERE o.id = NEW.converted_order_id AND o.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'intake_order_tenant_mismatch') END;
  SELECT CASE WHEN NEW.linked_order_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM orders o WHERE o.id = NEW.linked_order_id AND o.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'intake_order_tenant_mismatch') END;
END;

-- migrate:down
DROP TRIGGER IF EXISTS trg_order_intake_relationship_update;
DROP TRIGGER IF EXISTS trg_order_intake_relationship_insert;
DROP TRIGGER IF EXISTS trg_outbound_email_customer_tenant_insert;
DROP INDEX IF EXISTS idx_intake_attachments_message;
DROP INDEX IF EXISTS idx_order_intake_customer;
DROP INDEX IF EXISTS idx_order_intake_status;
DROP INDEX IF EXISTS idx_intake_messages_tenant_received;
DROP INDEX IF EXISTS idx_intake_addresses_tenant_active;
DROP INDEX IF EXISTS idx_sendgrid_events_send;
DROP INDEX IF EXISTS idx_communications_related;
DROP INDEX IF EXISTS idx_communications_customer;
DROP INDEX IF EXISTS idx_outbound_email_related;
DROP INDEX IF EXISTS idx_outbound_email_tenant_customer;
DROP TABLE IF EXISTS intake_attachments;
DROP TABLE IF EXISTS order_intake_items;
DROP TABLE IF EXISTS intake_source_messages;
DROP TABLE IF EXISTS tenant_intake_addresses;
DROP TABLE IF EXISTS sendgrid_events;
DROP TABLE IF EXISTS customer_communications;
DROP TABLE IF EXISTS outbound_email_sends;
DROP TABLE IF EXISTS tenant_email_settings;
