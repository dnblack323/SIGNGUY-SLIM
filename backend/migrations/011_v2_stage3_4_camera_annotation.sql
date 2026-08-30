-- migrate:up
PRAGMA foreign_keys = ON;

ALTER TABLE order_attachments ADD COLUMN source_type TEXT NOT NULL DEFAULT 'upload' CHECK (source_type IN ('upload', 'device_capture', 'intake', 'annotation_derivative'));
ALTER TABLE order_attachments ADD COLUMN original_attachment_id TEXT REFERENCES order_attachments(id);
ALTER TABLE order_attachments ADD COLUMN derivative_type TEXT CHECK (derivative_type IS NULL OR derivative_type IN ('annotation'));
ALTER TABLE order_attachments ADD COLUMN image_width INTEGER CHECK (image_width IS NULL OR image_width > 0);
ALTER TABLE order_attachments ADD COLUMN image_height INTEGER CHECK (image_height IS NULL OR image_height > 0);
ALTER TABLE order_attachments ADD COLUMN annotation_json TEXT;

CREATE INDEX idx_order_attachments_original ON order_attachments(tenant_id, order_id, original_attachment_id, deleted_at);

CREATE TRIGGER trg_order_attachment_derivative_insert
BEFORE INSERT ON order_attachments
WHEN NEW.original_attachment_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NEW.original_attachment_id = NEW.id THEN RAISE(ABORT, 'attachment_derivative_self_reference') END;
  SELECT CASE WHEN NEW.source_type <> 'annotation_derivative' THEN RAISE(ABORT, 'attachment_derivative_source_type_required') END;
  SELECT CASE WHEN NEW.derivative_type <> 'annotation' THEN RAISE(ABORT, 'attachment_derivative_type_required') END;
  SELECT CASE WHEN NEW.annotation_json IS NULL OR length(NEW.annotation_json) = 0 THEN RAISE(ABORT, 'annotation_payload_invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM order_attachments source
    WHERE source.id = NEW.original_attachment_id
      AND source.tenant_id = NEW.tenant_id
      AND source.order_id = NEW.order_id
      AND source.deleted_at IS NULL
  ) THEN RAISE(ABORT, 'attachment_original_relationship_invalid') END;
END;

CREATE TRIGGER trg_order_attachment_derivative_update
BEFORE UPDATE OF tenant_id, order_id, original_attachment_id, source_type, derivative_type, annotation_json ON order_attachments
WHEN NEW.original_attachment_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NEW.original_attachment_id = NEW.id THEN RAISE(ABORT, 'attachment_derivative_self_reference') END;
  SELECT CASE WHEN NEW.source_type <> 'annotation_derivative' THEN RAISE(ABORT, 'attachment_derivative_source_type_required') END;
  SELECT CASE WHEN NEW.derivative_type <> 'annotation' THEN RAISE(ABORT, 'attachment_derivative_type_required') END;
  SELECT CASE WHEN NEW.annotation_json IS NULL OR length(NEW.annotation_json) = 0 THEN RAISE(ABORT, 'annotation_payload_invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM order_attachments source
    WHERE source.id = NEW.original_attachment_id
      AND source.tenant_id = NEW.tenant_id
      AND source.order_id = NEW.order_id
      AND source.deleted_at IS NULL
  ) THEN RAISE(ABORT, 'attachment_original_relationship_invalid') END;
END;

-- migrate:down
DROP TRIGGER IF EXISTS trg_order_attachment_derivative_update;
DROP TRIGGER IF EXISTS trg_order_attachment_derivative_insert;
DROP INDEX IF EXISTS idx_order_attachments_original;
