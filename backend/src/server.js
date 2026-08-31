import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createWriteStream, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import Busboy from "busboy";
import { openDatabase, runMigrations } from "./db.js";
import { SlimService } from "./services.js";

const MAX_JSON_BYTES = 1024 * 1024;
const DEFAULT_UPLOAD_LIMIT_BYTES = 10 * 1024 * 1024;
const DEFAULT_BACKUP_LIMIT_BYTES = 25 * 1024 * 1024;
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;
const ANNOTATION_FIELD_LIMIT_BYTES = 160 * 1024;
const PUBLIC_ERROR_CODES = new Set([
  "annotation_payload_invalid",
  "annotation_payload_too_large",
  "annotation_source_not_image",
  "announcement_date_invalid",
  "announcement_archived",
  "announcement_not_found",
  "attachment_empty",
  "attachment_derivative_self_reference",
  "attachment_derivative_source_type_required",
  "attachment_derivative_type_required",
  "attachment_file_missing",
  "attachment_integrity_mismatch",
  "attachment_not_found",
  "attachment_original_relationship_invalid",
  "attachment_path_invalid",
  "attachment_preview_not_allowed",
  "attachment_too_large",
  "attachment_type_not_allowed",
  "backup_assignment_policy_required",
  "backup_attachment_type_unsupported",
  "backup_checksum_mismatch",
  "backup_confirmation_required",
  "backup_container_unrecognized",
  "backup_contains_secrets",
  "backup_decryption_failed",
  "backup_file_too_large",
  "backup_format_unsupported",
  "backup_manifest_malformed",
  "backup_manifest_missing",
  "backup_passphrase_invalid",
  "backup_passphrase_mismatch",
  "backup_path_invalid",
  "backup_record_count_mismatch",
  "backup_relationship_invalid",
  "backup_restore_blocked",
  "bundle_document_locked",
  "bundle_membership_requires_resave",
  "bundle_item_assigned_twice",
  "bundle_item_not_found",
  "bundle_override_reason_required",
  "amount_paid_exceeds_total",
  "assigned_user_not_same_tenant",
  "calendar_assigned_user_not_found",
  "calendar_event_not_found",
  "calendar_link_not_found",
  "conflict_override_reason_required",
  "converted_estimate_locked",
  "customer_not_found",
  "communication_link_invalid",
  "department_inactive",
  "department_not_found",
  "duplicate_department_membership",
  "duplicate_resource_reservation",
  "discount_exceeds_subtotal",
  "estimate_not_found",
  "email_changed_recipient_confirmation_required",
  "email_provider_rejected",
  "email_provider_unconfigured",
  "email_related_record_invalid",
  "email_sender_required",
  "email_webhook_signature_invalid",
  "downstream_closed_pay_week_requires_manual_reopen",
  "employee_inactive",
  "employee_not_found",
  "employee_portal_disabled",
  "employee_rate_missing",
  "employee_relationship_invalid",
  "employee_announcement_relationship_invalid",
  "employee_message_relationship_invalid",
  "employee_user_already_linked",
  "employee_user_tenant_mismatch",
  "invalid_calendar_date",
  "invalid_calendar_datetime",
  "invalid_calendar_filter",
  "invalid_calendar_link",
  "invalid_calendar_range",
  "invalid_calendar_status",
  "invalid_bundle_document",
  "invalid_bundle_total",
  "invalid_invoice_document_status",
  "invalid_completion",
  "invalid_order_status",
  "invalid_production_stage",
  "invoiced_order_financial_lock",
  "invoice_payment_exceeds_repriced_total",
  "malformed_multipart",
  "message_not_found",
  "message_recipient_invalid",
  "message_sender_spoof",
  "invalid_shop_email_or_password",
  "invoice_not_found",
  "invoice_void",
  "intake_address_not_found",
  "intake_already_converted",
  "intake_already_linked",
  "intake_assignee_tenant_mismatch",
  "intake_customer_required",
  "intake_customer_tenant_mismatch",
  "intake_item_not_found",
  "intake_order_tenant_mismatch",
  "intake_source_message_invalid",
  "intake_webhook_signature_invalid",
  "last_active_owner_required",
  "malformed_json",
  "no_updates",
  "order_not_found",
  "order_conflict",
  "order_item_not_found",
  "work_order_not_found",
  "owner_role_locked",
  "owner_role_requires_owner",
  "pay_ledger_not_found",
  "pay_ledger_type_invalid",
  "pay_permission_required",
  "pay_week_closed",
  "payload_too_large",
  "permission_denied",
  "quantity_decimal_invalid",
  "quantity_decimal_must_be_positive",
  "production_group_empty",
  "production_group_title_duplicate",
  "production_group_title_required",
  "production_item_assigned_twice",
  "production_item_not_found",
  "production_items_required",
  "production_items_unassigned",
  "production_regroup_reason_required",
  "released_production_item_assignment_required",
  "released_production_item_history_protected",
  "released_production_required_change_requires_regroup",
  "started_work_order_item_history_protected",
  "completed_work_order_reopen_required",
  "calendar_resolution_required",
  "calendar_resolution_replacement_required",
  "calendar_resolution_reason_required",
  "work_order_item_stage_managed_by_work_order",
  "resource_capacity_exceeded",
  "resource_inactive",
  "resource_not_found",
  "schedule_conflict",
  "schedule_view_not_found",
  "system_view_protected",
  "tenant_or_user_exists",
  "time_entry_invalid_range",
  "time_entry_not_found",
  "time_entry_overlap",
  "unauthorized",
  "user_not_found",
]);

function uploadLimitBytes() {
  const parsed = Number(process.env.SIGNGUY_SLIM_UPLOAD_LIMIT_BYTES || DEFAULT_UPLOAD_LIMIT_BYTES);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_UPLOAD_LIMIT_BYTES;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) {
      const err = new Error("payload_too_large");
      err.status = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const err = new Error("malformed_json");
    err.status = 400;
    throw err;
  }
}

function send(res, status, body, headers = {}) {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "Content-Length": data.length,
    "Content-Type": Buffer.isBuffer(body) ? (headers["Content-Type"] || "application/pdf") : "application/json; charset=utf-8",
    ...headers,
  });
  res.end(data);
}

function sendStream(res, status, payload) {
  res.writeHead(status, {
    "Content-Length": payload.byte_size,
    ...payload.headers,
  });
  payload.stream.on("error", () => {
    if (!res.destroyed) res.destroy();
  });
  payload.stream.pipe(res);
}

function httpError(code, status = 400) {
  const err = new Error(code);
  err.status = status;
  return err;
}

function waitForClose(stream) {
  if (!stream || stream.closed) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      stream.off?.("close", finish);
      stream.off?.("error", finish);
      resolve();
    };
    stream.once?.("close", finish);
    stream.once?.("error", finish);
    stream.destroy?.();
    setTimeout(finish, 500);
  });
}

export async function readMultipartFile(req, { tempRoot = tmpdir(), createWriteStreamImpl = createWriteStream, fileSizeLimit = uploadLimitBytes(), fieldValueLimit = 2048 } = {}) {
  const type = req.headers["content-type"] || "";
  if (!/^multipart\/form-data\b/i.test(type) || !/boundary=(?:"[^"]+"|[^;]+)/i.test(type)) throw httpError("malformed_multipart", 400);
  const declaredLength = Number(req.headers["content-length"] || 0);
  if (declaredLength && declaredLength > fileSizeLimit + MULTIPART_OVERHEAD_BYTES) throw httpError("payload_too_large", 413);
  return new Promise((resolve, reject) => {
    let parser;
    try {
      parser = Busboy({
        headers: req.headers,
        limits: { files: 1, fileSize: fileSizeLimit, fields: 5, parts: 6, fieldSize: fieldValueLimit },
      });
    } catch {
      reject(httpError("malformed_multipart", 400));
      return;
    }
    const tempDir = mkdtempSync(join(tempRoot, "signguy-slim-upload-"));
    let upload = null;
    const fields = {};
    let settled = false;
    let activeInput = null;
    let activeOutput = null;
    const cleanup = async () => {
      try {
        req.unpipe?.(parser);
      } catch {
        // Best effort only.
      }
      try {
        activeInput?.unpipe?.(activeOutput);
        activeInput?.resume?.();
        activeInput?.destroy?.();
      } catch {
        // Best effort only.
      }
      await waitForClose(activeOutput);
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Preserve the original upload error.
      }
    };
    const fail = (code, status = 400) => {
      if (settled) return;
      settled = true;
      const err = httpError(code, status);
      cleanup().finally(() => reject(err));
    };
    parser.on("file", (name, stream, info) => {
      if (name !== "file" || upload) {
        stream.resume();
        fail("malformed_multipart", 400);
        return;
      }
      const tempPath = join(tempDir, randomUUID());
      const out = createWriteStreamImpl(tempPath, { flags: "wx" });
      const hash = createHash("sha256");
      activeInput = stream;
      activeOutput = out;
      upload = { filename: info.filename || "attachment", mime_type: info.mimeType || "application/octet-stream", temp_path: tempPath, byte_size: 0, hash, out };
      stream.on("data", (chunk) => {
        upload.byte_size += chunk.length;
        hash.update(chunk);
      });
      stream.on("limit", () => fail("attachment_too_large", 413));
      stream.on("error", () => fail("malformed_multipart", 400));
      out.on("error", () => fail("malformed_multipart", 400));
      stream.pipe(out);
    });
    parser.on("field", (name, value, info = {}) => {
      if (info.valueTruncated || (typeof value === "string" && Buffer.byteLength(value, "utf8") > fieldValueLimit)) {
        fail("annotation_payload_too_large", 413);
        return;
      }
      if (typeof name === "string" && name.length <= 80 && typeof value === "string") {
        fields[name] = value;
      }
    });
    parser.on("filesLimit", () => fail("malformed_multipart", 400));
    parser.on("partsLimit", () => fail("malformed_multipart", 400));
    parser.on("error", () => fail("malformed_multipart", 400));
    req.on("aborted", () => fail("malformed_multipart", 400));
    req.on("error", () => fail("malformed_multipart", 400));
    parser.on("close", () => {
      if (settled) return;
      if (!upload) return fail("attachment_empty", 400);
      const finish = upload.out.writableFinished ? Promise.resolve() : new Promise((resolveFinish) => upload.out.on("finish", resolveFinish));
      finish.then(() => {
        if (settled) return;
        settled = true;
        resolve({
          filename: upload.filename,
          mime_type: upload.mime_type,
          temp_path: upload.temp_path,
          byte_size: upload.byte_size,
          sha256: upload.hash.digest("hex"),
          cleanup_dir: tempDir,
          fields,
        });
      });
    });
    req.pipe(parser);
  });
}

function tokenFrom(req) {
  const auth = req.headers.authorization || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

function notFound() {
  const err = new Error("not_found");
  err.status = 404;
  return err;
}

async function route(service, req, res) {
  const url = new URL(req.url, "http://localhost");
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const method = req.method;

  if (method === "POST" && url.pathname === "/api/auth/register") {
    return send(res, 201, await service.registerTenant(await readJson(req)));
  }
  if (method === "POST" && url.pathname === "/api/auth/login") {
    return send(res, 200, await service.login(await readJson(req)));
  }
  if (method === "POST" && url.pathname === "/api/webhooks/sendgrid/events") {
    return send(res, 202, service.processSendGridEvents(await readJson(req), { signature: req.headers["x-signguy-signature"] || "" }));
  }
  if (method === "POST" && url.pathname === "/api/webhooks/order-intake/email") {
    return send(res, 202, service.receiveEmailIntake(await readJson(req), { signature: req.headers["x-signguy-signature"] || "" }));
  }

  const actor = service.actorForToken(tokenFrom(req));
  if (method === "GET" && url.pathname === "/api/auth/me") return send(res, 200, { user: actor, tenant: service.tenant(actor.tenant_id) });
  if (method === "POST" && url.pathname === "/api/auth/logout") {
    service.logout(tokenFrom(req));
    return send(res, 200, { ok: true });
  }
  if (method === "PATCH" && parts[0] === "settings" && parts[1] === "email") return send(res, 200, service.updateEmailSettings(actor, await readJson(req)));
  if (method === "POST" && parts[0] === "settings" && parts[1] === "intake-address" && parts[2] === "rotate") {
    return send(res, 200, service.rotateIntakeAddress(actor, await readJson(req)));
  }
  if (method === "GET" && parts[0] === "settings" && parts.length === 1) return send(res, 200, service.settings(actor));
  if (method === "PATCH" && parts[0] === "settings" && parts.length === 1) return send(res, 200, service.updateSettings(actor, await readJson(req)));
  if (parts[0] === "backup") {
    if (method === "GET" && parts[1] === "history") return send(res, 200, { items: service.backupHistory(actor) });
    if (method === "POST" && parts[1] === "export") {
      const backup = service.createBackup(actor, await readJson(req));
      return send(res, 200, backup.buffer, {
        "Content-Type": "application/vnd.signguy.backup",
        "Content-Disposition": `attachment; filename="${backup.filename}"`,
        "X-Content-Type-Options": "nosniff",
      });
    }
    if (method === "POST" && parts[1] === "preview") {
      const file = await readMultipartFile(req, { fileSizeLimit: DEFAULT_BACKUP_LIMIT_BYTES });
      return send(res, 200, service.previewBackup(actor, file, file.fields || {}));
    }
    if (method === "POST" && parts[1] === "restore") {
      const file = await readMultipartFile(req, { fileSizeLimit: DEFAULT_BACKUP_LIMIT_BYTES });
      return send(res, 200, service.restoreBackup(actor, file, file.fields || {}));
    }
  }
  if (method === "POST" && parts[0] === "users") return send(res, 201, await service.addUser(actor, await readJson(req)));
  if (method === "PATCH" && parts[0] === "users" && parts.length === 2) return send(res, 200, service.updateUser(actor, parts[1], await readJson(req)));

  if (parts[0] === "employees") {
    if (method === "GET" && parts.length === 1) return send(res, 200, { items: service.listEmployees(actor) });
    if (method === "POST" && parts.length === 1) return send(res, 201, service.createEmployee(actor, await readJson(req)));
    if (method === "PATCH" && parts.length === 2) return send(res, 200, service.updateEmployee(actor, parts[1], await readJson(req)));
    if (method === "GET" && parts[2] === "rates") return send(res, 200, { items: service.employeeRates(actor, parts[1]) });
    if (method === "POST" && parts[2] === "rates") return send(res, 201, { items: service.addEmployeeRate(actor, parts[1], await readJson(req)) });
  }

  if (parts[0] === "time") {
    if (method === "GET" && parts[0] === "time" && parts[1] === "entries") return send(res, 200, service.listTimeEntries(actor, Object.fromEntries(url.searchParams)));
    if (method === "POST" && parts[0] === "time" && parts[1] === "entries") return send(res, 201, service.addTimeEntry(actor, await readJson(req)));
    if (method === "PATCH" && parts[0] === "time" && parts[1] === "entries" && parts.length === 3) return send(res, 200, service.updateTimeEntry(actor, parts[2], await readJson(req)));
    if (method === "POST" && parts[0] === "time" && parts[1] === "entries" && parts[3] === "void") return send(res, 200, service.voidTimeEntry(actor, parts[2], await readJson(req)));
  }

  if (parts[0] === "payroll") {
    if (method === "GET" && parts[1] === "weeks" && parts.length === 2) return send(res, 200, { items: service.listPayWeeks(actor, Object.fromEntries(url.searchParams)) });
    if (method === "GET" && parts[1] === "employees" && parts[3] === "weeks" && parts.length === 5) return send(res, 200, service.paySummary(actor, parts[2], parts[4]));
    if (method === "POST" && parts[1] === "employees" && parts[3] === "weeks" && parts[5] === "close") return send(res, 200, service.closePayWeek(actor, parts[2], parts[4]));
    if (method === "POST" && parts[1] === "employees" && parts[3] === "weeks" && parts[5] === "reopen") return send(res, 200, service.reopenPayWeek(actor, parts[2], parts[4], await readJson(req)));
    if (method === "POST" && parts[1] === "advances") return send(res, 201, service.recordPayAdvance(actor, await readJson(req)));
    if (method === "POST" && parts[1] === "adjustments") return send(res, 201, service.recordPayAdjustment(actor, await readJson(req)));
    if (method === "POST" && parts[1] === "manual-payments") return send(res, 201, service.recordManualPayment(actor, await readJson(req)));
    if (method === "POST" && parts[1] === "ledger" && parts[4] === "void") return send(res, 200, service.voidPayLedger(actor, parts[2], parts[3], await readJson(req)));
  }

  if (parts[0] === "employee-portal") {
    if (method === "GET" && parts[1] === "time-clock") return send(res, 200, service.currentTimeClock(actor));
    if (method === "POST" && parts[1] === "clock-in") return send(res, 200, service.clockIn(actor, await readJson(req)));
    if (method === "POST" && parts[1] === "clock-out") return send(res, 200, service.clockOut(actor, await readJson(req)));
    if (method === "GET" && parts[1] === "my-pay") return send(res, 200, service.myPaySummary(actor, url.searchParams.get("week_start") || null));
    if (method === "GET" && parts[1] === "announcements" && parts.length === 2) return send(res, 200, service.portalAnnouncements(actor));
    if (method === "GET" && parts[1] === "announcements" && parts.length === 3) return send(res, 200, service.portalAnnouncement(actor, parts[2]));
    if (method === "GET" && parts[1] === "message-participants") return send(res, 200, service.messageParticipants(actor));
    if (method === "GET" && parts[1] === "messages" && parts.length === 2) return send(res, 200, service.listMessageConversations(actor));
    if (method === "POST" && parts[1] === "messages" && parts.length === 2) return send(res, 201, service.sendDirectMessage(actor, await readJson(req)));
    if (method === "GET" && parts[1] === "messages" && parts.length === 3) return send(res, 200, service.messageConversation(actor, parts[2]));
  }

  if (parts[0] === "announcements") {
    if (method === "GET" && parts.length === 1) return send(res, 200, service.listAnnouncements(actor));
    if (method === "POST" && parts.length === 1) return send(res, 201, service.createAnnouncement(actor, await readJson(req)));
    if (method === "GET" && parts.length === 2) return send(res, 200, service.announcement(actor, parts[1]));
    if (method === "PATCH" && parts.length === 2) return send(res, 200, service.updateAnnouncement(actor, parts[1], await readJson(req)));
    if (method === "POST" && parts[2] === "archive" && parts.length === 3) return send(res, 200, service.archiveAnnouncement(actor, parts[1]));
  }

  if (parts[0] === "customers") {
    if (method === "GET" && parts.length === 1) {
      return send(res, 200, { items: service.listCustomers(actor, Object.fromEntries(url.searchParams)) });
    }
    if (method === "POST" && parts.length === 1) return send(res, 201, service.createCustomer(actor, await readJson(req)));
    if (method === "GET" && parts.length === 2) return send(res, 200, service.customer(actor, parts[1]));
    if (method === "PATCH" && parts.length === 2) return send(res, 200, service.updateCustomer(actor, parts[1], await readJson(req)));
  }

  if (parts[0] === "estimates") {
    if (method === "GET" && parts.length === 1) return send(res, 200, { items: service.listEstimates(actor) });
    if (method === "POST" && parts.length === 1) return send(res, 201, service.createEstimate(actor, await readJson(req)));
    if (method === "GET" && parts.length === 2) return send(res, 200, service.estimate(actor, parts[1]));
    if (method === "PATCH" && parts.length === 2) return send(res, 200, service.updateEstimate(actor, parts[1], await readJson(req)));
    if (method === "GET" && parts[2] === "bundles") return send(res, 200, { items: service.listCommercialBundles(actor, "estimate", parts[1]) });
    if (method === "PUT" && parts[2] === "bundles") return send(res, 200, service.saveCommercialBundles(actor, "estimate", parts[1], await readJson(req)));
    if (method === "POST" && parts[2] === "duplicate") return send(res, 201, service.duplicateEstimate(actor, parts[1]));
    if (method === "POST" && parts[2] === "convert") return send(res, 201, service.convertEstimate(actor, parts[1]));
    if (method === "POST" && parts[2] === "send-email") return send(res, 202, await service.sendCustomerEmail(actor, "estimate", parts[1], await readJson(req)));
    if (method === "GET" && parts[2] === "pdf") {
      return send(res, 200, service.documentPdf(actor, "estimate", parts[1]), {
        "Content-Disposition": `attachment; filename="estimate-${parts[1]}.pdf"`,
      });
    }
  }

  if (parts[0] === "orders") {
    if (method === "GET" && parts[1] === "intake" && parts.length === 2) return send(res, 200, { items: service.listIntakeItems(actor, Object.fromEntries(url.searchParams)) });
    if (method === "GET" && parts[1] === "intake" && parts.length === 3) return send(res, 200, service.intakeItem(actor, parts[2]));
    if (method === "PATCH" && parts[1] === "intake" && parts.length === 3) return send(res, 200, service.updateIntakeItem(actor, parts[2], await readJson(req)));
    if (method === "POST" && parts[1] === "intake" && parts[3] === "customer") return send(res, 201, service.createCustomerFromIntake(actor, parts[2], await readJson(req)));
    if (method === "POST" && parts[1] === "intake" && parts[3] === "create-draft-order") return send(res, 201, service.createDraftOrderFromIntake(actor, parts[2], await readJson(req)));
    if (method === "POST" && parts[1] === "intake" && parts[3] === "link-order") return send(res, 200, service.linkIntakeToOrder(actor, parts[2], await readJson(req)));
    if (method === "GET" && parts.length === 1) return send(res, 200, { items: service.listOrders(actor) });
    if (method === "POST" && parts.length === 1) return send(res, 201, service.createOrder(actor, await readJson(req)));
    if (method === "GET" && parts[2] === "workspace") return send(res, 200, service.orderWorkspace(actor, parts[1]));
    if (method === "PATCH" && parts[2] === "workspace") return send(res, 200, service.updateOrderWorkspace(actor, parts[1], await readJson(req)));
    if (method === "POST" && parts[2] === "production" && parts[3] === "send") return send(res, 201, service.sendOrderToProduction(actor, parts[1], await readJson(req)));
    if (method === "POST" && parts[2] === "production" && parts[3] === "regroup") return send(res, 200, service.regroupOrderProduction(actor, parts[1], await readJson(req)));
    if (method === "GET" && parts[2] === "attachments" && parts.length === 3) return send(res, 200, { items: service.listOrderAttachments(actor, parts[1]) });
    if (method === "POST" && parts[2] === "attachments" && parts.length === 3) return send(res, 201, service.uploadOrderAttachment(actor, parts[1], await readMultipartFile(req)));
    if (method === "POST" && parts[2] === "attachments" && parts[4] === "annotations") {
      return send(res, 201, service.createAnnotatedAttachment(actor, parts[1], parts[3], await readMultipartFile(req, { fieldValueLimit: ANNOTATION_FIELD_LIMIT_BYTES })));
    }
    if (method === "GET" && parts[2] === "attachments" && parts[4] === "download") return sendStream(res, 200, service.attachmentDownload(actor, parts[1], parts[3]));
    if (method === "GET" && parts[2] === "attachments" && parts[4] === "preview") return sendStream(res, 200, service.attachmentDownload(actor, parts[1], parts[3], { preview: true }));
    if (method === "DELETE" && parts[2] === "attachments" && parts.length === 4) return send(res, 200, service.deleteOrderAttachment(actor, parts[1], parts[3]));
    if (method === "POST" && parts[2] === "email") return send(res, 202, await service.sendCustomerEmail(actor, "order", parts[1], await readJson(req)));
    if (method === "GET" && parts.length === 2) return send(res, 200, service.order(actor, parts[1]));
    if (method === "POST" && parts[2] === "status") {
      return send(res, 200, service.updateOrderStatus(actor, parts[1], (await readJson(req)).status));
    }
    if (method === "POST" && parts[2] === "invoice") return send(res, 201, service.createOrOpenInvoice(actor, parts[1], await readJson(req)));
    if (method === "GET" && parts[2] === "bundles") return send(res, 200, { items: service.listCommercialBundles(actor, "order", parts[1]) });
    if (method === "PUT" && parts[2] === "bundles") return send(res, 200, service.saveCommercialBundles(actor, "order", parts[1], await readJson(req)));
  }

  if (parts[0] === "production") {
    if (method === "GET" && parts[1] === "board") return send(res, 200, service.productionBoard(actor, Object.fromEntries(url.searchParams)));
    if (method === "GET" && parts[1] === "work-orders" && parts.length === 3) return send(res, 200, service.workOrderSummary(actor, parts[2]));
    if (method === "POST" && parts[1] === "work-orders" && parts[3] === "stage") {
      return send(res, 200, service.setWorkOrderStage(actor, parts[2], (await readJson(req)).stage));
    }
    if (method === "POST" && parts[1] === "work-orders" && parts[3] === "completion") {
      const body = await readJson(req);
      if (typeof body.completed !== "boolean") {
        const err = new Error("invalid_completion");
        err.status = 400;
        throw err;
      }
      return send(res, 200, service.setWorkOrderCompletion(actor, parts[2], body.completed));
    }
    if (method === "POST" && parts[1] === "items" && parts[3] === "stage") {
      return send(res, 200, service.setProductionStage(actor, parts[2], (await readJson(req)).stage));
    }
    if (method === "POST" && parts[1] === "items" && parts[3] === "completion") {
      const body = await readJson(req);
      if (typeof body.completed !== "boolean") {
        const err = new Error("invalid_completion");
        err.status = 400;
        throw err;
      }
      return send(res, 200, service.setItemCompletion(actor, parts[2], body.completed));
    }
  }

  if (parts[0] === "calendar") {
    if (method === "GET" && parts.length === 1) return send(res, 200, service.listCalendarEvents(actor, Object.fromEntries(url.searchParams)));
    if (method === "POST" && parts.length === 1) return send(res, 201, service.createCalendarEvent(actor, await readJson(req)));
    if (method === "GET" && parts.length === 2) return send(res, 200, service.calendarEvent(actor, parts[1]));
    if (method === "PATCH" && parts.length === 2) return send(res, 200, service.updateCalendarEvent(actor, parts[1], await readJson(req)));
    if (method === "DELETE" && parts.length === 2) return send(res, 200, service.setCalendarStatus(actor, parts[1], "cancelled"));
    if (method === "POST" && parts[2] === "complete") return send(res, 200, service.setCalendarStatus(actor, parts[1], "complete"));
    if (method === "POST" && parts[2] === "reopen") return send(res, 200, service.setCalendarStatus(actor, parts[1], "scheduled"));
    if (method === "POST" && parts[2] === "cancel") return send(res, 200, service.setCalendarStatus(actor, parts[1], "cancelled"));
  }

  if (parts[0] === "schedule") {
    if (parts[1] === "views") {
      if (method === "GET" && parts.length === 2) return send(res, 200, service.listScheduleViews(actor));
      if (method === "POST" && parts.length === 2) return send(res, 201, service.createScheduleView(actor, await readJson(req)));
      if (method === "GET" && parts.length === 3) return send(res, 200, service.scheduleView(actor, parts[2]));
      if (method === "PATCH" && parts.length === 3) return send(res, 200, service.updateScheduleView(actor, parts[2], await readJson(req)));
    }
    if (parts[1] === "departments") {
      if (method === "GET" && parts.length === 2) return send(res, 200, service.listDepartments(actor));
      if (method === "POST" && parts.length === 2) return send(res, 201, service.createDepartment(actor, await readJson(req)));
      if (method === "GET" && parts.length === 3) return send(res, 200, service.department(actor, parts[2]));
      if (method === "PATCH" && parts.length === 3) return send(res, 200, service.updateDepartment(actor, parts[2], await readJson(req)));
    }
    if (parts[1] === "resources") {
      if (method === "GET" && parts.length === 2) return send(res, 200, service.listResources(actor));
      if (method === "POST" && parts.length === 2) return send(res, 201, service.createResource(actor, await readJson(req)));
      if (method === "GET" && parts.length === 3) return send(res, 200, service.resource(actor, parts[2]));
      if (method === "PATCH" && parts.length === 3) return send(res, 200, service.updateResource(actor, parts[2], await readJson(req)));
    }
  }

  if (method === "GET" && parts[0] === "dashboard") {
    return send(res, 200, service.dashboard(actor));
  }

  if (parts[0] === "invoices") {
    if (method === "GET" && parts.length === 1) return send(res, 200, { items: service.listInvoices(actor) });
    if (method === "GET" && parts.length === 2) return send(res, 200, service.invoice(actor, parts[1]));
    if (method === "GET" && parts[2] === "bundles") return send(res, 200, { items: service.listCommercialBundles(actor, "invoice", parts[1]) });
    if (method === "PUT" && parts[2] === "bundles") return send(res, 200, service.saveCommercialBundles(actor, "invoice", parts[1], await readJson(req)));
    if (method === "POST" && parts[2] === "document-status") {
      return send(res, 200, service.setInvoiceDocumentStatus(actor, parts[1], (await readJson(req)).document_status));
    }
    if (method === "POST" && parts[2] === "payment") {
      return send(res, 200, service.recordInvoicePayment(actor, parts[1], await readJson(req)));
    }
    if (method === "POST" && parts[2] === "send-email") return send(res, 202, await service.sendCustomerEmail(actor, "invoice", parts[1], await readJson(req)));
    if (method === "GET" && parts[2] === "pdf") {
      return send(res, 200, service.documentPdf(actor, "invoice", parts[1]), {
        "Content-Disposition": `attachment; filename="invoice-${parts[1]}.pdf"`,
      });
    }
  }

  if (method === "GET" && parts[0] === "audit" && parts.length === 3) {
    return send(res, 200, { items: service.auditTrail(actor, parts[1], parts[2]) });
  }
  if (parts[0] === "communications") {
    if (method === "GET" && parts.length === 1) return send(res, 200, { items: service.listCommunications(actor, Object.fromEntries(url.searchParams)) });
    if (method === "POST" && parts.length === 1) return send(res, 201, service.createManualCommunication(actor, await readJson(req)));
  }

  throw notFound();
}

export function createSlimServer(db = null) {
  const ownedDb = db ?? openDatabase();
  runMigrations(ownedDb);
  const service = new SlimService(ownedDb);
  return createServer(async (req, res) => {
    try {
      await route(service, req, res);
    } catch (error) {
      const status = error.status && Number.isInteger(error.status) ? error.status : error.name === "ZodError" ? 400 : 500;
      const message = status === 500
        ? "server_error"
        : error.name === "ZodError"
          ? "validation_failed"
          : PUBLIC_ERROR_CODES.has(error.message)
            ? error.message
            : "request_failed";
      send(res, status, { error: message, ...(error.conflicts ? { conflicts: error.conflicts } : {}) });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 4175);
  createSlimServer().listen(port, () => {
    console.log(`SignGuy Slim API listening on http://localhost:${port}`);
  });
}
