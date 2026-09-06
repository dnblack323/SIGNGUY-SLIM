import * as shared from "../shared.js";
import { methodsFromClass } from "../install.js";
import { durablePublishFile, trySyncDirectory } from "../../durableFiles.js";

const {
  ADMIN_ROLES,
  ALLOWED_ATTACHMENT_MIME_TYPES,
  BLOCKED_EXTENSION_RE,
  COMMERCIAL_WRITE_ROLES,
  MIME_EXTENSIONS,
  PREVIEW_ATTACHMENT_MIME_TYPES,
  chmodSync,
  contentDisposition,
  createReadStream,
  dateOnly,
  dirname,
  error,
  existsSync,
  fileExtension,
  fileSha256,
  join,
  lstatSync,
  mapInvoice,
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
  z,
} = shared;

const EXPENSE_CATEGORIES = [
  "Materials",
  "Subcontractor",
  "Equipment",
  "Vehicle",
  "Rent",
  "Utilities",
  "Software",
  "Marketing",
  "Office",
  "Insurance",
  "Payroll",
  "Taxes",
  "Other",
];

const PAYMENT_METHODS = ["cash", "check", "credit_card", "debit_card", "ach", "bank_transfer", "other"];

const expenseSchema = z.object({
  expense_date: z.string().refine(dateOnly, "expense_date_invalid"),
  vendor: z.string().trim().min(1).max(160),
  category: z.string().trim().min(1).max(80),
  description: z.string().trim().max(1000).nullable().optional(),
  amount_cents: z.number().int().positive().safe(),
  payment_method: z.string().trim().min(1).max(80),
});

function mapExpense(row, attachment = null) {
  if (!row) return null;
  return {
    id: row.id,
    portable_id: row.portable_id,
    tenant_id: row.tenant_id,
    expense_date: row.expense_date,
    vendor: row.vendor,
    category: row.category,
    description: row.description,
    amount_cents: row.amount_cents,
    payment_method: row.payment_method,
    archived_at: row.archived_at,
    created_by_user_id: row.created_by_user_id,
    updated_by_user_id: row.updated_by_user_id,
    archived_by_user_id: row.archived_by_user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    attachment: attachment ? mapExpenseAttachment(attachment) : null,
  };
}

function mapExpenseAttachment(row) {
  if (!row) return null;
  return {
    id: row.id,
    portable_id: row.portable_id,
    tenant_id: row.tenant_id,
    expense_id: row.expense_id,
    original_filename: row.original_filename,
    mime_type: row.mime_type,
    byte_size: row.byte_size,
    sha256: row.sha256,
    created_by_user_id: row.created_by_user_id,
    created_at: row.created_at,
    deleted_at: row.deleted_at,
    previewable: PREVIEW_ATTACHMENT_MIME_TYPES.has(row.mime_type),
  };
}

function normalizePaymentMethod(value) {
  const method = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return PAYMENT_METHODS.includes(method) ? method : "other";
}

function selectedExpenseCategory(value) {
  const category = String(value || "").trim();
  return EXPENSE_CATEGORIES.includes(category) ? category : "Other";
}

function periodDate(value) {
  if (!dateOnly(value)) throw error("invalid_sales_tax_period", 400);
  return value;
}

function endOfMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).toISOString().slice(0, 10);
}

function reportPeriod(filters = {}, todayValue) {
  const mode = String(filters.period || filters.mode || "month");
  if (mode === "custom") {
    const from = periodDate(filters.from);
    const to = periodDate(filters.to);
    if (from > to) throw error("invalid_sales_tax_period", 400);
    return { mode, from, to, label: `${from} to ${to}` };
  }
  const reference = dateOnly(filters.reference_date) ? filters.reference_date : todayValue;
  const year = Number(filters.year || reference.slice(0, 4));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw error("invalid_sales_tax_period", 400);
  if (mode === "quarter") {
    const currentQuarter = Math.floor((Number(reference.slice(5, 7)) - 1) / 3) + 1;
    const quarter = Number(filters.quarter || currentQuarter);
    if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) throw error("invalid_sales_tax_period", 400);
    const startMonth = (quarter - 1) * 3;
    return {
      mode,
      from: `${year}-${String(startMonth + 1).padStart(2, "0")}-01`,
      to: endOfMonth(year, startMonth + 2),
      label: `Q${quarter} ${year}`,
    };
  }
  if (mode === "year") return { mode, from: `${year}-01-01`, to: `${year}-12-31`, label: String(year) };
  if (mode === "month") {
    const month = Number(filters.month || reference.slice(5, 7));
    if (!Number.isInteger(month) || month < 1 || month > 12) throw error("invalid_sales_tax_period", 400);
    return {
      mode,
      from: `${year}-${String(month).padStart(2, "0")}-01`,
      to: endOfMonth(year, month - 1),
      label: `${year}-${String(month).padStart(2, "0")}`,
    };
  }
  throw error("invalid_sales_tax_period", 400);
}

function allocateInvoiceSplit(invoice, itemRows) {
  const subtotal = Number(invoice.subtotal_cents || 0);
  const discount = Math.min(Number(invoice.discount_cents || 0), subtotal);
  const netSubtotal = Math.max(0, subtotal - discount);
  if (!itemRows.length || itemRows.reduce((sum, row) => sum + Number(row.line_total_cents || 0), 0) !== subtotal) {
    return { taxable_sales_cents: null, non_taxable_sales_cents: null, unknown_sales_cents: netSubtotal };
  }
  if (invoice.customer_tax_exempt_snapshot) {
    return { taxable_sales_cents: 0, non_taxable_sales_cents: netSubtotal, unknown_sales_cents: 0 };
  }
  const taxableGross = itemRows.filter((row) => row.taxable).reduce((sum, row) => sum + Number(row.line_total_cents || 0), 0);
  const taxableDiscount = subtotal > 0 ? Math.round((discount * taxableGross) / subtotal) : 0;
  const taxable = Math.max(0, taxableGross - taxableDiscount);
  return {
    taxable_sales_cents: taxable,
    non_taxable_sales_cents: Math.max(0, netSubtotal - taxable),
    unknown_sales_cents: 0,
  };
}

class FinanceDomainMethods {
  expenseCategories() {
    return EXPENSE_CATEGORIES;
  }

  paymentMethods() {
    return PAYMENT_METHODS;
  }

  expenseAttachmentRow(actor, expenseId) {
    return this.db
      .prepare("SELECT * FROM expense_attachments WHERE tenant_id = ? AND expense_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1")
      .get(actor.tenant_id, expenseId) || null;
  }

  expenseRow(actor, id, { includeArchived = true } = {}) {
    this.requireRole(actor, COMMERCIAL_WRITE_ROLES);
    const row = this.db
      .prepare(`SELECT * FROM expenses WHERE id = ? AND tenant_id = ? ${includeArchived ? "" : "AND archived_at IS NULL"}`)
      .get(id, actor.tenant_id);
    if (!row) throw error("expense_not_found", 404);
    return row;
  }

  expense(actor, id) {
    const row = this.expenseRow(actor, id);
    return mapExpense(row, this.expenseAttachmentRow(actor, id));
  }

  listExpenses(actor, filters = {}) {
    this.requireRole(actor, COMMERCIAL_WRITE_ROLES);
    const where = ["tenant_id = ?"];
    const values = [actor.tenant_id];
    if (!["true", "1", true].includes(filters.include_archived)) where.push("archived_at IS NULL");
    if (filters.from) {
      if (!dateOnly(filters.from)) throw error("expense_date_invalid", 400);
      where.push("expense_date >= ?");
      values.push(filters.from);
    }
    if (filters.to) {
      if (!dateOnly(filters.to)) throw error("expense_date_invalid", 400);
      where.push("expense_date <= ?");
      values.push(filters.to);
    }
    if (filters.category) {
      where.push("category = ?");
      values.push(String(filters.category));
    }
    if (filters.payment_method) {
      where.push("payment_method = ?");
      values.push(normalizePaymentMethod(filters.payment_method));
    }
    if (filters.search) {
      where.push("(vendor LIKE ? OR description LIKE ?)");
      values.push(`%${String(filters.search).trim()}%`, `%${String(filters.search).trim()}%`);
    }
    const rows = this.db.prepare(`SELECT * FROM expenses WHERE ${where.join(" AND ")} ORDER BY expense_date DESC, created_at DESC, id`).all(...values);
    const attachments = new Map(
      this.db.prepare("SELECT * FROM expense_attachments WHERE tenant_id = ? AND deleted_at IS NULL").all(actor.tenant_id).map((row) => [row.expense_id, row]),
    );
    const items = rows.map((row) => mapExpense(row, attachments.get(row.id)));
    const summaryRows = rows;
    const byCategory = {};
    const byPaymentMethod = {};
    for (const row of summaryRows) {
      byCategory[row.category] = (byCategory[row.category] || 0) + row.amount_cents;
      byPaymentMethod[row.payment_method] = (byPaymentMethod[row.payment_method] || 0) + row.amount_cents;
    }
    return {
      items,
      categories: EXPENSE_CATEGORIES,
      payment_methods: PAYMENT_METHODS,
      summary: {
        total_cents: summaryRows.reduce((sum, row) => sum + row.amount_cents, 0),
        count: summaryRows.length,
        by_category: byCategory,
        by_payment_method: byPaymentMethod,
      },
    };
  }

  createExpense(actor, payload) {
    this.requireRole(actor, COMMERCIAL_WRITE_ROLES);
    const input = expenseSchema.parse({ ...payload, category: selectedExpenseCategory(payload?.category), payment_method: normalizePaymentMethod(payload?.payment_method) });
    const id = randomUUID();
    const timestamp = now();
    return this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO expenses
           (id, portable_id, tenant_id, expense_date, vendor, category, description, amount_cents, payment_method, created_by_user_id, updated_by_user_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, portable("expense"), actor.tenant_id, input.expense_date, input.vendor, input.category, input.description ?? null, input.amount_cents, input.payment_method, actor.id, actor.id, timestamp, timestamp);
      const expense = this.expense(actor, id);
      this.audit(actor, "expense.create", "expense", id, expense.portable_id, `Expense ${input.vendor} created`, { amount_cents: input.amount_cents, category: input.category });
      return expense;
    });
  }

  updateExpense(actor, id, payload) {
    const existing = this.expenseRow(actor, id, { includeArchived: false });
    const input = expenseSchema.partial().parse({
      ...payload,
      ...(payload?.category !== undefined ? { category: selectedExpenseCategory(payload.category) } : {}),
      ...(payload?.payment_method !== undefined ? { payment_method: normalizePaymentMethod(payload.payment_method) } : {}),
    });
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(input)) {
      fields.push(`${key} = ?`);
      values.push(value ?? null);
    }
    if (!fields.length) throw error("no_updates", 400);
    fields.push("updated_by_user_id = ?", "updated_at = ?");
    values.push(actor.id, now(), id, actor.tenant_id);
    this.db.prepare(`UPDATE expenses SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ? AND archived_at IS NULL`).run(...values);
    const updated = this.expense(actor, id);
    this.audit(actor, "expense.update", "expense", id, existing.portable_id, `Expense ${updated.vendor} updated`, input);
    return updated;
  }

  archiveExpense(actor, id) {
    const existing = this.expenseRow(actor, id, { includeArchived: false });
    const timestamp = now();
    this.db.prepare("UPDATE expenses SET archived_at = ?, archived_by_user_id = ?, updated_by_user_id = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND archived_at IS NULL")
      .run(timestamp, actor.id, actor.id, timestamp, id, actor.tenant_id);
    this.audit(actor, "expense.archive", "expense", id, existing.portable_id, `Expense ${existing.vendor} archived`, { archived_at: timestamp });
    return this.expense(actor, id);
  }

  validateExpenseAttachmentInput(filename, mimeType, path) {
    const original = safeFilename(filename);
    const stat = statSync(path);
    if (!stat.size) throw error("attachment_empty", 400);
    if (stat.size > uploadLimitBytes()) throw error("attachment_too_large", 413);
    if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(mimeType)) throw error("attachment_type_not_allowed", 400);
    if (BLOCKED_EXTENSION_RE.test(original)) throw error("attachment_type_not_allowed", 400);
    const extension = fileExtension(original);
    if (!MIME_EXTENSIONS[mimeType]?.has(extension)) throw error("attachment_type_not_allowed", 400);
    verifyAttachmentContent(path, mimeType);
    return original;
  }

  uploadExpenseAttachment(actor, expenseId, file) {
    const expense = this.expenseRow(actor, expenseId, { includeArchived: false });
    if (this.expenseAttachmentRow(actor, expenseId)) throw error("expense_attachment_exists", 409);
    const mimeType = file?.mime_type || file?.mimeType || "application/octet-stream";
    let sourcePath = file?.temp_path || null;
    const createdSource = !sourcePath;
    let fallbackTempDir = null;
    if (!sourcePath) {
      fallbackTempDir = mkdtempSync(join(tmpdir(), "signguy-slim-buffer-upload-"));
      sourcePath = join(fallbackTempDir, randomUUID());
      writeFileSync(sourcePath, Buffer.isBuffer(file?.buffer) ? file.buffer : Buffer.from(file?.buffer || ""), { flag: "wx", mode: 0o600 });
      chmodSync(sourcePath, 0o600);
    }
    let finalPath = null;
    let storageKey = null;
    try {
      const original = this.validateExpenseAttachmentInput(file?.filename, mimeType, sourcePath);
      const stat = statSync(sourcePath);
      const sha256 = fileSha256(sourcePath);
      if (file?.byte_size !== undefined && file.byte_size !== stat.size) throw error("attachment_integrity_mismatch", 409);
      if (file?.sha256 && file.sha256 !== sha256) throw error("attachment_integrity_mismatch", 409);
      const id = randomUUID();
      const timestamp = now();
      const extension = fileExtension(original);
      storageKey = join(actor.tenant_id, "expenses", expenseId, `${randomUUID()}${extension}`).replace(/\\/g, "/");
      finalPath = this.attachmentPath(storageKey);
      return this.transaction(() => {
        this.assertTenantStorageAvailable(actor.tenant_id, stat.size);
        durablePublishFile(sourcePath, finalPath, { mode: 0o600 });
        this.db
          .prepare(
            `INSERT INTO expense_attachments
             (id, portable_id, tenant_id, expense_id, original_filename, storage_key, mime_type, byte_size, sha256, created_by_user_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(id, portable("expense_attachment"), actor.tenant_id, expenseId, original, storageKey, mimeType, stat.size, sha256, actor.id, timestamp);
        this.db.prepare("UPDATE expenses SET updated_by_user_id = ?, updated_at = ? WHERE id = ? AND tenant_id = ?").run(actor.id, timestamp, expenseId, actor.tenant_id);
        this.audit(actor, "expense.attachment_upload", "expense", expenseId, expense.portable_id, `Receipt ${original} uploaded`, { attachment_id: id, sha256 });
        return mapExpenseAttachment(this.db.prepare("SELECT * FROM expense_attachments WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id));
      });
    } catch (err) {
      try {
        if (sourcePath && existsSync(sourcePath)) rmSync(sourcePath, { force: true });
        if (finalPath && existsSync(finalPath) && !this.db.prepare("SELECT id FROM expense_attachments WHERE storage_key = ?").get(storageKey)) {
          rmSync(finalPath, { force: true });
          trySyncDirectory(dirname(finalPath));
        }
      } catch {
        // Preserve original upload failure.
      }
      throw err;
    } finally {
      if (createdSource && sourcePath && existsSync(sourcePath)) rmSync(sourcePath, { force: true });
      if (fallbackTempDir && existsSync(fallbackTempDir)) rmSync(fallbackTempDir, { recursive: true, force: true });
      if (file?.cleanup_dir && existsSync(file.cleanup_dir)) rmSync(file.cleanup_dir, { recursive: true, force: true });
    }
  }

  expenseAttachmentDownload(actor, expenseId, { preview = false } = {}) {
    const expense = this.expenseRow(actor, expenseId);
    const row = this.expenseAttachmentRow(actor, expenseId);
    if (!row) throw error("expense_attachment_not_found", 404);
    if (preview && !PREVIEW_ATTACHMENT_MIME_TYPES.has(row.mime_type)) throw error("attachment_preview_not_allowed", 400);
    const fullPath = this.attachmentPath(row.storage_key);
    if (!existsSync(fullPath)) throw error("attachment_file_missing", 404);
    const stat = lstatSync(fullPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw error("attachment_file_missing", 404);
    if (stat.size !== row.byte_size || fileSha256(fullPath) !== row.sha256) throw error("attachment_integrity_mismatch", 409);
    this.audit(actor, preview ? "expense.attachment_preview" : "expense.attachment_download", "expense", expenseId, expense.portable_id, `${preview ? "Previewed" : "Downloaded"} receipt ${row.original_filename}`, { attachment_id: row.id });
    return {
      stream: createReadStream(fullPath),
      byte_size: row.byte_size,
      mime_type: row.mime_type,
      headers: {
        "Content-Type": row.mime_type,
        "Content-Disposition": contentDisposition(row.original_filename, preview ? "inline" : "attachment"),
        "X-Content-Type-Options": "nosniff",
      },
    };
  }

  deleteExpenseAttachment(actor, expenseId) {
    const expense = this.expenseRow(actor, expenseId, { includeArchived: true });
    const row = this.expenseAttachmentRow(actor, expenseId);
    if (!row) throw error("expense_attachment_not_found", 404);
    const timestamp = now();
    const fullPath = this.attachmentPath(row.storage_key);
    const stagedPath = join(dirname(fullPath), `.${row.id}.${randomUUID()}.delete`);
    if (!existsSync(fullPath)) throw error("attachment_file_missing", 404);
    const stat = lstatSync(fullPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw error("attachment_file_missing", 404);
    renameSync(fullPath, stagedPath);
    trySyncDirectory(dirname(fullPath));
    let committed = false;
    try {
      const result = this.transaction(() => {
        this.db.prepare("UPDATE expense_attachments SET deleted_at = ? WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL").run(timestamp, row.id, actor.tenant_id);
        this.db.prepare("UPDATE expenses SET updated_by_user_id = ?, updated_at = ? WHERE id = ? AND tenant_id = ?").run(actor.id, timestamp, expenseId, actor.tenant_id);
        this.audit(actor, "expense.attachment_remove", "expense", expenseId, expense.portable_id, `Receipt ${row.original_filename} removed`, { attachment_id: row.id });
        return { ok: true, deleted_at: timestamp };
      });
      committed = true;
      rmSync(stagedPath, { force: true });
      trySyncDirectory(dirname(stagedPath));
      return result;
    } catch (err) {
      if (!committed && existsSync(stagedPath) && !existsSync(fullPath)) {
        renameSync(stagedPath, fullPath);
        trySyncDirectory(dirname(fullPath));
      }
      throw err;
    }
  }

  salesTaxReport(actor, filters = {}) {
    this.requireRole(actor, ADMIN_ROLES);
    const period = reportPeriod(filters, new Date().toISOString().slice(0, 10));
    const rows = this.db
      .prepare(
        `SELECT i.*, o.order_number, o.title AS order_title, c.contact_name AS customer_contact_name, c.business_name AS customer_business_name
         FROM invoices i
         LEFT JOIN orders o ON o.id = i.order_id AND o.tenant_id = i.tenant_id
         LEFT JOIN customers c ON c.id = i.customer_id AND c.tenant_id = i.tenant_id
         WHERE i.tenant_id = ? AND i.document_status = 'issued' AND i.document_date >= ? AND i.document_date <= ?
         ORDER BY i.document_date, i.invoice_number`,
      )
      .all(actor.tenant_id, period.from, period.to);
    const documents = rows.map((row) => {
      const itemRows = this.db
        .prepare(
          `SELECT oi.id, COALESCE(alloc.allocated_cents, oi.line_total_cents) AS line_total_cents, oi.taxable
           FROM order_items oi
           LEFT JOIN (
             SELECT cbi.item_id, cbi.allocated_cents
             FROM commercial_bundle_items cbi
             JOIN commercial_bundles cb ON cb.id = cbi.bundle_id AND cb.tenant_id = cbi.tenant_id
             WHERE cbi.tenant_id = ?
               AND cbi.document_type = 'invoice'
               AND cbi.document_id = ?
               AND cbi.active = 1
               AND cb.active = 1
           ) alloc ON alloc.item_id = oi.id
           WHERE oi.tenant_id = ? AND oi.order_id = ?
           ORDER BY oi.position, oi.id`,
        )
        .all(actor.tenant_id, row.id, actor.tenant_id, row.order_id);
      const split = allocateInvoiceSplit(row, itemRows);
      return {
        ...mapInvoice(row),
        taxable_sales_cents: split.taxable_sales_cents,
        non_taxable_sales_cents: split.non_taxable_sales_cents,
        unknown_sales_cents: split.unknown_sales_cents,
      };
    });
    const summary = documents.reduce((out, invoice) => ({
      taxable_sales_cents: out.taxable_sales_cents + (invoice.taxable_sales_cents || 0),
      non_taxable_sales_cents: out.non_taxable_sales_cents + (invoice.non_taxable_sales_cents || 0),
      unknown_sales_cents: out.unknown_sales_cents + (invoice.unknown_sales_cents || 0),
      tax_collected_cents: out.tax_collected_cents + invoice.tax_cents,
      gross_sales_cents: out.gross_sales_cents + invoice.total_cents,
      document_count: out.document_count + 1,
    }), {
      taxable_sales_cents: 0,
      non_taxable_sales_cents: 0,
      unknown_sales_cents: 0,
      tax_collected_cents: 0,
      gross_sales_cents: 0,
      document_count: 0,
    });
    return {
      period,
      summary,
      documents,
      disclaimer: "Sales tax reporting is for internal tracking only. Slim does not file, remit, or provide tax advice.",
    };
  }
}

export const financeMethods = methodsFromClass(FinanceDomainMethods);
