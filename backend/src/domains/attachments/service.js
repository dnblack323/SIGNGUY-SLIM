import * as shared from "../shared.js";
import { methodsFromClass } from "../install.js";

const {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  BLOCKED_EXTENSION_RE,
  IMAGE_ATTACHMENT_MIME_TYPES,
  MIME_EXTENSIONS,
  PREVIEW_ATTACHMENT_MIME_TYPES,
  WRITE_ROLES,
  annotationOperationsFromField,
  attachmentSourceType,
  chmodSync,
  contentDisposition,
  createReadStream,
  error,
  existsSync,
  fileExtension,
  fileSha256,
  imageDimensions,
  join,
  lstatSync,
  mapAttachment,
  mkdtempSync,
  now,
  portable,
  randomUUID,
  renameSync,
  rmSync,
  safeFilename,
  statSync,
  tmpdir,
  uploadLimitBytes,
  verifyAttachmentContent,
  writeFileSync,
} = shared;

class AttachmentDomainMethods {
  validateAttachmentInput(filename, mimeType, path) {
    const original = safeFilename(filename);
    const stat = statSync(path);
    const size = stat.size;
    if (!size) throw error("attachment_empty", 400);
    if (size > uploadLimitBytes()) throw error("attachment_too_large", 413);
    if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(mimeType)) throw error("attachment_type_not_allowed", 400);
    if (BLOCKED_EXTENSION_RE.test(original)) throw error("attachment_type_not_allowed", 400);
    const extension = fileExtension(original);
    if (!MIME_EXTENSIONS[mimeType]?.has(extension)) throw error("attachment_type_not_allowed", 400);
    verifyAttachmentContent(path, mimeType);
    return original;
  }

  listOrderAttachments(actor, orderId) {
    this.order(actor, orderId);
    return this.db
      .prepare("SELECT * FROM order_attachments WHERE tenant_id = ? AND order_id = ? AND deleted_at IS NULL ORDER BY created_at DESC")
      .all(actor.tenant_id, orderId)
      .map(mapAttachment);
  }

  uploadOrderAttachment(actor, orderId, file) {
    this.requireRole(actor, WRITE_ROLES);
    const order = this.order(actor, orderId);
    const mimeType = file?.mime_type || file?.mimeType || "application/octet-stream";
    const sourceType = attachmentSourceType(file);
    let sourcePath = file?.temp_path || null;
    const createdSource = !sourcePath;
    const id = randomUUID();
    const pid = portable("order_attachment");
    const timestamp = now();
    let finalPath = null;
    let storageKey = null;
    let fallbackTempDir = null;
    const buffer = Buffer.isBuffer(file?.buffer) ? file.buffer : Buffer.from(file?.buffer || "");
    if (!sourcePath) {
      fallbackTempDir = mkdtempSync(join(tmpdir(), "signguy-slim-buffer-upload-"));
      sourcePath = join(fallbackTempDir, randomUUID());
      writeFileSync(sourcePath, buffer, { flag: "wx", mode: 0o600 });
      chmodSync(sourcePath, 0o600);
    }
    try {
      const original = this.validateAttachmentInput(file?.filename, mimeType, sourcePath);
      if (sourceType === "device_capture" && !IMAGE_ATTACHMENT_MIME_TYPES.has(mimeType)) throw error("attachment_type_not_allowed", 400);
      const stat = statSync(sourcePath);
      const byteSize = stat.size;
      const sha256 = fileSha256(sourcePath);
      if (file?.byte_size !== undefined && file.byte_size !== byteSize) throw error("attachment_integrity_mismatch", 409);
      if (file?.sha256 && file.sha256 !== sha256) throw error("attachment_integrity_mismatch", 409);
      const dimensions = imageDimensions(sourcePath, mimeType);
      const extension = fileExtension(original);
      storageKey = join(actor.tenant_id, orderId, `${randomUUID()}${extension}`).replace(/\\/g, "/");
      finalPath = this.attachmentPath(storageKey);
      return this.transaction(() => {
        renameSync(sourcePath, finalPath);
        chmodSync(finalPath, 0o600);
        this.db
          .prepare(
            `INSERT INTO order_attachments
             (id, portable_id, tenant_id, order_id, original_filename, storage_key, mime_type, byte_size, sha256, created_by_user_id, created_at, source_type, image_width, image_height)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(id, pid, actor.tenant_id, orderId, original, storageKey, mimeType, byteSize, sha256, actor.id, timestamp, sourceType, dimensions.width, dimensions.height);
        const action = sourceType === "device_capture" ? "attachment.device_capture" : "attachment.upload";
        this.audit(actor, action, "order", orderId, order.portable_id, `Attachment ${original} uploaded`, { attachment_id: id, sha256, source_type: sourceType });
        return mapAttachment(this.db.prepare("SELECT * FROM order_attachments WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id));
      });
    } catch (err) {
      try {
        if (existsSync(sourcePath)) rmSync(sourcePath, { force: true });
        if (finalPath && existsSync(finalPath) && !this.db.prepare("SELECT id FROM order_attachments WHERE storage_key = ?").get(storageKey)) rmSync(finalPath, { force: true });
      } catch {
        // Best-effort cleanup; the original failure remains authoritative.
      }
      throw err;
    } finally {
      if (createdSource && existsSync(sourcePath)) rmSync(sourcePath, { force: true });
      if (fallbackTempDir && existsSync(fallbackTempDir)) rmSync(fallbackTempDir, { recursive: true, force: true });
      if (file?.cleanup_dir && existsSync(file.cleanup_dir)) rmSync(file.cleanup_dir, { recursive: true, force: true });
    }
  }

  createAnnotatedAttachment(actor, orderId, sourceAttachmentId, file) {
    this.requireRole(actor, WRITE_ROLES);
    const order = this.order(actor, orderId);
    const source = this.attachmentRecord(actor, orderId, sourceAttachmentId);
    if (!IMAGE_ATTACHMENT_MIME_TYPES.has(source.mime_type)) throw error("annotation_source_not_image", 400);
    const originalId = source.original_attachment_id || source.id;
    this.attachmentRecord(actor, orderId, originalId);
    const operations = annotationOperationsFromField(file?.fields?.annotation_json);
    const mimeType = file?.mime_type || file?.mimeType || "application/octet-stream";
    if (!IMAGE_ATTACHMENT_MIME_TYPES.has(mimeType)) throw error("attachment_type_not_allowed", 400);
    let sourcePath = file?.temp_path || null;
    const createdSource = !sourcePath;
    const id = randomUUID();
    const pid = portable("order_attachment");
    const timestamp = now();
    let finalPath = null;
    let storageKey = null;
    let fallbackTempDir = null;
    const buffer = Buffer.isBuffer(file?.buffer) ? file.buffer : Buffer.from(file?.buffer || "");
    if (!sourcePath) {
      fallbackTempDir = mkdtempSync(join(tmpdir(), "signguy-slim-buffer-upload-"));
      sourcePath = join(fallbackTempDir, randomUUID());
      writeFileSync(sourcePath, buffer, { flag: "wx", mode: 0o600 });
      chmodSync(sourcePath, 0o600);
    }
    try {
      const requestedName = file?.filename || `${source.original_filename.replace(/\.[^.]+$/, "")}-annotated.png`;
      const original = this.validateAttachmentInput(requestedName, mimeType, sourcePath);
      const stat = statSync(sourcePath);
      const byteSize = stat.size;
      const sha256 = fileSha256(sourcePath);
      if (file?.byte_size !== undefined && file.byte_size !== byteSize) throw error("attachment_integrity_mismatch", 409);
      if (file?.sha256 && file.sha256 !== sha256) throw error("attachment_integrity_mismatch", 409);
      const dimensions = imageDimensions(sourcePath, mimeType);
      const extension = fileExtension(original);
      storageKey = join(actor.tenant_id, orderId, `${randomUUID()}${extension}`).replace(/\\/g, "/");
      finalPath = this.attachmentPath(storageKey);
      return this.transaction(() => {
        renameSync(sourcePath, finalPath);
        chmodSync(finalPath, 0o600);
        this.db
          .prepare(
            `INSERT INTO order_attachments
             (id, portable_id, tenant_id, order_id, original_filename, storage_key, mime_type, byte_size, sha256, created_by_user_id,
              created_at, source_type, original_attachment_id, derivative_type, image_width, image_height, annotation_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'annotation_derivative', ?, 'annotation', ?, ?, ?)`,
          )
          .run(id, pid, actor.tenant_id, orderId, original, storageKey, mimeType, byteSize, sha256, actor.id, timestamp, originalId, dimensions.width, dimensions.height, JSON.stringify(operations));
        this.audit(actor, "attachment.annotation_create", "order", orderId, order.portable_id, `Annotated copy ${original} created`, {
          attachment_id: id,
          original_attachment_id: originalId,
          source_attachment_id: source.id,
          sha256,
          operation_count: operations.length,
        });
        return mapAttachment(this.db.prepare("SELECT * FROM order_attachments WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id));
      });
    } catch (err) {
      try {
        if (existsSync(sourcePath)) rmSync(sourcePath, { force: true });
        if (finalPath && existsSync(finalPath) && !this.db.prepare("SELECT id FROM order_attachments WHERE storage_key = ?").get(storageKey)) rmSync(finalPath, { force: true });
      } catch {
        // Best-effort cleanup; the original failure remains authoritative.
      }
      throw err;
    } finally {
      if (createdSource && existsSync(sourcePath)) rmSync(sourcePath, { force: true });
      if (fallbackTempDir && existsSync(fallbackTempDir)) rmSync(fallbackTempDir, { recursive: true, force: true });
      if (file?.cleanup_dir && existsSync(file.cleanup_dir)) rmSync(file.cleanup_dir, { recursive: true, force: true });
    }
  }

  attachmentRecord(actor, orderId, attachmentId, { includeDeleted = false } = {}) {
    this.order(actor, orderId);
    const row = this.db
      .prepare(`SELECT * FROM order_attachments WHERE id = ? AND order_id = ? AND tenant_id = ? ${includeDeleted ? "" : "AND deleted_at IS NULL"}`)
      .get(attachmentId, orderId, actor.tenant_id);
    if (!row) throw error("attachment_not_found", 404);
    return row;
  }

  attachmentDownload(actor, orderId, attachmentId, { preview = false } = {}) {
    const row = this.attachmentRecord(actor, orderId, attachmentId);
    if (preview && !PREVIEW_ATTACHMENT_MIME_TYPES.has(row.mime_type)) throw error("attachment_preview_not_allowed", 400);
    const fullPath = this.attachmentPath(row.storage_key);
    if (!existsSync(fullPath)) throw error("attachment_file_missing", 404);
    const stat = lstatSync(fullPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw error("attachment_file_missing", 404);
    if (stat.size !== row.byte_size || fileSha256(fullPath) !== row.sha256) throw error("attachment_integrity_mismatch", 409);
    const disposition = preview ? "inline" : "attachment";
    const order = this.order(actor, orderId);
    this.audit(actor, preview ? "attachment.preview" : "attachment.download", "order", orderId, order.portable_id, `${preview ? "Previewed" : "Downloaded"} ${row.original_filename}`, { attachment_id: attachmentId });
    return {
      stream: createReadStream(fullPath),
      byte_size: row.byte_size,
      mime_type: row.mime_type,
      headers: {
        "Content-Type": row.mime_type,
        "Content-Disposition": contentDisposition(row.original_filename, disposition),
        "X-Content-Type-Options": "nosniff",
      },
    };
  }

  deleteOrderAttachment(actor, orderId, attachmentId) {
    this.requireRole(actor, WRITE_ROLES);
    return this.transaction(() => {
      const row = this.attachmentRecord(actor, orderId, attachmentId);
      const deletedAt = now();
      this.db.prepare("UPDATE order_attachments SET deleted_at = ? WHERE id = ? AND tenant_id = ?").run(deletedAt, attachmentId, actor.tenant_id);
      const order = this.order(actor, orderId);
      this.audit(actor, "attachment.delete", "order", orderId, order.portable_id, `Attachment ${row.original_filename} deleted`, { attachment_id: attachmentId });
      return { ok: true, deleted_at: deletedAt };
    });
  }

}

export const attachmentMethods = methodsFromClass(AttachmentDomainMethods);
