import * as shared from "../shared.js";
import { methodsFromClass } from "../install.js";
import { durableCopyFile, durableWriteFile, trySyncDirectory } from "../../durableFiles.js";

const {
  ADMIN_ROLES,
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MIME_EXTENSIONS,
  WRITE_ROLES,
  bool,
  createHash,
  emailSendSchema,
  emailSettingsSchema,
  error,
  existsSync,
  fileExtension,
  fileSha256,
  imageDimensions,
  inboundIntakeSchema,
  intakeCustomerSchema,
  intakeUpdateSchema,
  join,
  dirname,
  manualCommunicationSchema,
  mapCommunication,
  mapEmailSettings,
  mapIntakeAddress,
  mapIntakeAttachment,
  mapIntakeItem,
  mapIntakeMessage,
  mapOutboundEmail,
  normalizedEmail,
  now,
  portable,
  randomUUID,
  rmSync,
  safeFilename,
  sanitizeHtmlFragment,
  statSync,
  today,
  uploadLimitBytes,
  verifyAttachmentContent,
  verifySharedSecretSignature,
  z,
} = shared;

function removeDurableFile(path) {
  rmSync(path, { force: true });
  trySyncDirectory(dirname(path));
}

class CommunicationDomainMethods {
  emailSettings(actor) {
    const tenant = this.tenant(actor.tenant_id);
    const row = this.db.prepare("SELECT * FROM tenant_email_settings WHERE tenant_id = ?").get(actor.tenant_id);
    return mapEmailSettings(row, tenant);
  }

  updateEmailSettings(actor, payload) {
    this.requireRole(actor, ADMIN_ROLES);
    const input = emailSettingsSchema.parse(payload);
    const tenant = this.tenant(actor.tenant_id);
    const existing = this.db.prepare("SELECT * FROM tenant_email_settings WHERE tenant_id = ?").get(actor.tenant_id);
    const timestamp = now();
    const next = {
      sender_name: input.sender_name ?? existing?.sender_name ?? tenant.company_name,
      sender_email: input.sender_email === undefined ? existing?.sender_email ?? tenant.contact_email ?? null : input.sender_email,
      sendgrid_verified: input.sendgrid_verified === undefined ? Boolean(existing?.sendgrid_verified) : input.sendgrid_verified,
    };
    if (!next.sender_email) throw error("email_sender_required", 400);
    this.db
      .prepare(
        `INSERT INTO tenant_email_settings (tenant_id, sender_name, sender_email, sendgrid_verified, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id) DO UPDATE SET
           sender_name = excluded.sender_name,
           sender_email = excluded.sender_email,
           sendgrid_verified = excluded.sendgrid_verified,
           updated_at = excluded.updated_at`,
      )
      .run(actor.tenant_id, next.sender_name, normalizedEmail(next.sender_email), bool(next.sendgrid_verified), timestamp, timestamp);
    this.audit(actor, "email_settings.update", "tenant", actor.tenant_id, tenant.portable_id, "SendGrid customer email settings updated", {
      sender_email: normalizedEmail(next.sender_email),
      sendgrid_verified: next.sendgrid_verified,
    });
    return this.emailSettings(actor);
  }

  composeIntakeAddress(slug, token) {
    const domain = normalizedEmail(process.env.SIGNGUY_SLIM_INTAKE_DOMAIN || "intake.signguy-slim.local");
    const safeSlug = String(slug || "shop").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "shop";
    const safeToken = String(token || randomUUID().replace(/-/g, "")).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 32);
    return { token: safeToken, full: `intake-${safeSlug}-${safeToken}@${domain}` };
  }

  ensureIntakeAddress(actor) {
    const existing = this.db
      .prepare("SELECT * FROM tenant_intake_addresses WHERE tenant_id = ? AND active = 1 ORDER BY created_at DESC LIMIT 1")
      .get(actor.tenant_id);
    if (existing) return mapIntakeAddress(existing);
    const tenant = this.tenant(actor.tenant_id);
    const timestamp = now();
    const intakeAddress = this.composeIntakeAddress(tenant.slug, randomUUID().replace(/-/g, ""));
    this.db
      .prepare(
        `INSERT INTO tenant_intake_addresses
         (id, tenant_id, address_token, full_address, active, created_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
      )
      .run(randomUUID(), actor.tenant_id, intakeAddress.token, intakeAddress.full, actor.id, timestamp, timestamp);
    this.audit(actor, "intake_address.create", "tenant", actor.tenant_id, tenant.portable_id, "Incoming request address created");
    return this.ensureIntakeAddress(actor);
  }

  rotateIntakeAddress(actor, payload = {}) {
    this.requireRole(actor, ADMIN_ROLES);
    const reason = z.object({ reason: z.string().trim().min(1).max(500) }).parse(payload).reason;
    const tenant = this.tenant(actor.tenant_id);
    const timestamp = now();
    const intakeAddress = this.composeIntakeAddress(tenant.slug, randomUUID().replace(/-/g, ""));
    this.transaction(() => {
      this.db
        .prepare("UPDATE tenant_intake_addresses SET active = 0, rotated_at = ?, rotation_reason = ?, updated_at = ? WHERE tenant_id = ? AND active = 1")
        .run(timestamp, reason, timestamp, actor.tenant_id);
      this.db
        .prepare(
          `INSERT INTO tenant_intake_addresses
           (id, tenant_id, address_token, full_address, active, created_by_user_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
        )
        .run(randomUUID(), actor.tenant_id, intakeAddress.token, intakeAddress.full, actor.id, timestamp, timestamp);
      this.audit(actor, "intake_address.rotate", "tenant", actor.tenant_id, tenant.portable_id, "Incoming request address rotated", { reason });
    });
    return this.ensureIntakeAddress(actor);
  }

  resolveRelatedCustomer(actor, relatedEntityType, relatedEntityId) {
    if (relatedEntityType === "estimate") {
      const doc = this.estimate(actor, relatedEntityId);
      return { doc, customer: this.customer(actor, doc.customer_id), messageType: "estimate" };
    }
    if (relatedEntityType === "order") {
      const doc = this.order(actor, relatedEntityId);
      return { doc, customer: this.customer(actor, doc.customer_id), messageType: "order" };
    }
    if (relatedEntityType === "invoice") {
      const doc = this.invoice(actor, relatedEntityId);
      return { doc, customer: this.customer(actor, doc.customer_id), messageType: "invoice" };
    }
    throw error("email_related_record_invalid", 400);
  }

  async deliverEmail(payload) {
    if (this.emailTransport) return this.emailTransport(payload);
    const apiKey = process.env.SIGNGUY_SLIM_SENDGRID_API_KEY;
    if (!apiKey) throw error("email_provider_unconfigured", 503);
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (response.status !== 202) {
      const body = await response.text().catch(() => "");
      const err = error("email_provider_rejected", 502);
      err.provider_status = response.status;
      err.provider_body = body.slice(0, 300);
      throw err;
    }
    return { provider_message_id: response.headers.get("x-message-id") || null };
  }

  async sendCustomerEmail(actor, relatedEntityType, relatedEntityId, payload) {
    this.requireRole(actor, WRITE_ROLES);
    const input = emailSendSchema.parse(payload);
    const existing = this.db
      .prepare("SELECT * FROM outbound_email_sends WHERE tenant_id = ? AND idempotency_key = ?")
      .get(actor.tenant_id, input.idempotency_key);
    if (existing) return { send: mapOutboundEmail(existing), idempotent: true };
    const { doc, customer, messageType } = this.resolveRelatedCustomer(actor, relatedEntityType, relatedEntityId);
    const settings = this.emailSettings(actor);
    if (!settings.sender_email) throw error("email_sender_required", 400);
    const toEmail = normalizedEmail(input.to_email || customer.email);
    if (!toEmail) throw error("customer_email_required", 400);
    if (customer.email && normalizedEmail(customer.email) !== toEmail && !input.confirm_unsaved_recipient) {
      throw error("email_changed_recipient_confirmation_required", 409);
    }
    const orderAttachmentIds = relatedEntityType === "order" ? this.authorizedOrderAttachmentIds(actor, relatedEntityId, input.order_attachment_ids) : [];
    const emailId = randomUUID();
    const emailPid = portable("outbound_email");
    const timestamp = now();
    const attachments = [];
    if (input.attach_document && ["estimate", "invoice"].includes(relatedEntityType)) {
      attachments.push({
        content: this.documentPdf(actor, relatedEntityType, relatedEntityId).toString("base64"),
        filename: `${relatedEntityType === "estimate" ? "quote" : relatedEntityType}-${doc[`${relatedEntityType}_number`] || relatedEntityId}.pdf`,
        type: "application/pdf",
        disposition: "attachment",
      });
    }
    const providerPayload = {
      personalizations: [{ to: [{ email: toEmail }], cc: input.cc.map((email) => ({ email: normalizedEmail(email) })) }],
      from: { email: settings.sender_email, name: settings.sender_name || this.tenant(actor.tenant_id).company_name },
      subject: input.subject,
      content: [{ type: "text/plain", value: input.body_text }],
      attachments,
      custom_args: { tenant_id: actor.tenant_id, outbound_email_send_id: emailId, related_entity_type: relatedEntityType, related_entity_id: relatedEntityId },
    };
    try {
      const delivered = await this.deliverEmail(providerPayload);
      this.transaction(() => {
        this.db
          .prepare(
            `INSERT INTO outbound_email_sends
             (id, portable_id, tenant_id, idempotency_key, customer_id, related_entity_type, related_entity_id, message_type,
              sender_user_id, from_email, from_name, to_email, cc_json, subject, body_text, provider_message_id, delivery_state,
              document_attached, order_attachment_ids_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?, ?, ?)`,
          )
          .run(emailId, emailPid, actor.tenant_id, input.idempotency_key, customer.id, relatedEntityType, relatedEntityId, messageType, actor.id, settings.sender_email, settings.sender_name || this.tenant(actor.tenant_id).company_name, toEmail, JSON.stringify(input.cc.map(normalizedEmail)), input.subject, input.body_text, delivered.provider_message_id || emailId, bool(input.attach_document), JSON.stringify(orderAttachmentIds), timestamp, timestamp);
        this.insertCommunication(actor, {
          customer_id: customer.id,
          direction: "outbound",
          channel: "email",
          activity_type: "app_sent_email",
          sender_email: settings.sender_email,
          recipient_emails: [toEmail, ...input.cc.map(normalizedEmail)],
          subject: input.subject,
          body_text: input.body_text,
          summary: `${relatedEntityType[0].toUpperCase() + relatedEntityType.slice(1)} email sent to ${toEmail}`,
          related_entity_type: relatedEntityType,
          related_entity_id: relatedEntityId,
          outbound_email_send_id: emailId,
          delivery_state: "sent",
        });
        if (relatedEntityType === "estimate" && doc.status === "draft") {
          this.db.prepare("UPDATE estimates SET status = 'sent', updated_at = ? WHERE id = ? AND tenant_id = ?").run(timestamp, relatedEntityId, actor.tenant_id);
        }
        if (relatedEntityType === "invoice" && doc.document_status === "draft") {
          this.db.prepare("UPDATE invoices SET document_status = 'issued', updated_at = ? WHERE id = ? AND tenant_id = ?").run(timestamp, relatedEntityId, actor.tenant_id);
        }
        this.audit(actor, "email.send", relatedEntityType, relatedEntityId, doc.portable_id, `${relatedEntityType} email accepted by SendGrid`, { outbound_email_send_id: emailId, to_email: toEmail, delivery_state: "sent" });
      });
      return { send: mapOutboundEmail(this.db.prepare("SELECT * FROM outbound_email_sends WHERE id = ? AND tenant_id = ?").get(emailId, actor.tenant_id)), idempotent: false };
    } catch (err) {
      this.transaction(() => {
        this.db
          .prepare(
            `INSERT INTO outbound_email_sends
             (id, portable_id, tenant_id, idempotency_key, customer_id, related_entity_type, related_entity_id, message_type,
              sender_user_id, from_email, from_name, to_email, cc_json, subject, body_text, delivery_state, failure_reason,
              document_attached, order_attachment_ids_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'failed', ?, ?, ?, ?, ?)`,
          )
          .run(emailId, emailPid, actor.tenant_id, input.idempotency_key, customer.id, relatedEntityType, relatedEntityId, messageType, actor.id, settings.sender_email, settings.sender_name || this.tenant(actor.tenant_id).company_name, toEmail, JSON.stringify(input.cc.map(normalizedEmail)), input.subject, input.body_text, err.message, bool(input.attach_document), JSON.stringify(orderAttachmentIds), timestamp, timestamp);
        this.audit(actor, "email.failed", relatedEntityType, relatedEntityId, doc.portable_id, `${relatedEntityType} email failed before provider acceptance`, { outbound_email_send_id: emailId, error: err.message });
      });
      throw err;
    }
  }

  authorizedOrderAttachmentIds(actor, orderId, ids = []) {
    return ids.map((id) => this.attachmentRecord(actor, orderId, id).id);
  }

  insertCommunication(actor, entry) {
    const id = randomUUID();
    const timestamp = now();
    this.db
      .prepare(
        `INSERT INTO customer_communications
         (id, portable_id, tenant_id, customer_id, direction, channel, activity_type, author_user_id, sender_email,
          recipient_emails_json, subject, body_text, summary, related_entity_type, related_entity_id,
          outbound_email_send_id, intake_item_id, delivery_state, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, portable("communication"), actor.tenant_id, entry.customer_id, entry.direction, entry.channel, entry.activity_type, actor.id, entry.sender_email ?? null, JSON.stringify(entry.recipient_emails || []), entry.subject ?? null, entry.body_text ?? null, entry.summary, entry.related_entity_type ?? "customer", entry.related_entity_id ?? entry.customer_id, entry.outbound_email_send_id ?? null, entry.intake_item_id ?? null, entry.delivery_state ?? null, timestamp);
    return mapCommunication(this.db.prepare("SELECT * FROM customer_communications WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id));
  }

  createManualCommunication(actor, payload) {
    this.requireRole(actor, WRITE_ROLES);
    const input = manualCommunicationSchema.parse(payload);
    this.customer(actor, input.customer_id);
    if (input.related_entity_type && input.related_entity_type !== "customer" && input.related_entity_id) {
      this.resolveCommunicationLink(actor, input.related_entity_type, input.related_entity_id, input.customer_id);
    }
    const communication = this.insertCommunication(actor, {
      ...input,
      activity_type: "manual_note",
      sender_email: input.direction === "outbound" ? actor.email : null,
      recipient_emails: [],
      summary: input.subject || `${input.channel.replace("_", " ")} communication note`,
      related_entity_type: input.related_entity_type || "customer",
      related_entity_id: input.related_entity_id || input.customer_id,
    });
    this.audit(actor, "communication_note.create", "customer", input.customer_id, this.customer(actor, input.customer_id).portable_id, "Customer communication note added", {
      communication_id: communication.id,
      channel: input.channel,
      direction: input.direction,
    });
    return communication;
  }

  resolveCommunicationLink(actor, type, id, customerId) {
    if (type === "estimate" && this.estimate(actor, id).customer_id !== customerId) throw error("communication_link_invalid", 400);
    if (type === "order" && this.order(actor, id).customer_id !== customerId) throw error("communication_link_invalid", 400);
    if (type === "invoice" && this.invoice(actor, id).customer_id !== customerId) throw error("communication_link_invalid", 400);
    if (type === "order_intake") this.intakeItem(actor, id);
  }

  listCommunications(actor, filters = {}) {
    const params = [actor.tenant_id];
    const where = ["tenant_id = ?"];
    if (filters.customer_id) {
      this.customer(actor, filters.customer_id);
      where.push("customer_id = ?");
      params.push(filters.customer_id);
    }
    if (filters.related_entity_type && filters.related_entity_id) {
      where.push("related_entity_type = ? AND related_entity_id = ?");
      params.push(filters.related_entity_type, filters.related_entity_id);
    }
    return this.db
      .prepare(`SELECT * FROM customer_communications WHERE ${where.join(" AND ")} ORDER BY created_at DESC`)
      .all(...params)
      .map(mapCommunication);
  }

  verifyWebhookSignature(kind, payload, signature) {
    const production = process.env.NODE_ENV === "production";
    if (kind === "sendgrid_events") {
      return verifySharedSecretSignature({
        secret: process.env.SIGNGUY_SLIM_SENDGRID_WEBHOOK_SECRET,
        payload,
        signature,
        required: production,
        errorCode: "email_webhook_signature_invalid",
      });
    }
    return verifySharedSecretSignature({
      secret: process.env.SIGNGUY_SLIM_INTAKE_WEBHOOK_SECRET,
      payload,
      signature,
      required: production,
      errorCode: "intake_webhook_signature_invalid",
    });
  }

  processSendGridEvents(payload, { signature = "" } = {}) {
    const raw = JSON.stringify(payload ?? []);
    this.verifyWebhookSignature("sendgrid_events", raw, signature);
    const events = Array.isArray(payload) ? payload : [payload];
    const results = [];
    for (const eventPayload of events) {
      const providerId = String(eventPayload.sg_event_id || eventPayload.event_id || `${eventPayload.sg_message_id || eventPayload.outbound_email_send_id}-${eventPayload.event}-${eventPayload.timestamp}`);
      const send = this.db
        .prepare(
          `SELECT * FROM outbound_email_sends
           WHERE id = ? OR provider_message_id = ?
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(eventPayload.outbound_email_send_id || eventPayload.outbound_email_send_id === 0 ? String(eventPayload.outbound_email_send_id) : null, eventPayload.sg_message_id || eventPayload.provider_message_id || null);
      if (!send) {
        results.push({ provider_event_id: providerId, status: "unmatched" });
        continue;
      }
      const existing = this.db.prepare("SELECT id FROM sendgrid_events WHERE tenant_id = ? AND provider_event_id = ?").get(send.tenant_id, providerId);
      if (existing) {
        results.push({ provider_event_id: providerId, status: "duplicate" });
        continue;
      }
      const eventType = String(eventPayload.event || "processed").replace(/-/g, "_");
      const state = this.deliveryStateForEvent(eventType);
      const timestamp = now();
      const occurred = eventPayload.timestamp ? new Date(Number(eventPayload.timestamp) * 1000).toISOString() : timestamp;
      this.transaction(() => {
        this.db
          .prepare(
            `INSERT INTO sendgrid_events
             (id, tenant_id, outbound_email_send_id, provider_event_id, event_type, occurred_at, payload_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(randomUUID(), send.tenant_id, send.id, providerId, eventType, occurred, JSON.stringify({ event: eventType, email: eventPayload.email || null, reason: eventPayload.reason || eventPayload.response || null }), timestamp);
        if (state) {
          this.db
            .prepare("UPDATE outbound_email_sends SET delivery_state = ?, failure_reason = COALESCE(?, failure_reason), updated_at = ? WHERE id = ? AND tenant_id = ?")
            .run(state, eventPayload.reason || eventPayload.response || null, timestamp, send.id, send.tenant_id);
          this.db
            .prepare("UPDATE customer_communications SET delivery_state = ? WHERE outbound_email_send_id = ? AND tenant_id = ?")
            .run(state, send.id, send.tenant_id);
        }
        this.auditSystem(send.tenant_id, "email.delivery_event", send.related_entity_type, send.related_entity_id, send.portable_id, `SendGrid ${eventType} event recorded`, { outbound_email_send_id: send.id, delivery_state: state || send.delivery_state });
      });
      results.push({ provider_event_id: providerId, status: "recorded", delivery_state: state || send.delivery_state });
    }
    return { processed: results };
  }

  deliveryStateForEvent(eventType) {
    const normalized = String(eventType || "").replace(/-/g, "_");
    if (normalized === "delivered") return "delivered";
    if (normalized === "deferred") return "deferred";
    if (normalized === "bounce" || normalized === "bounced") return "bounced";
    if (normalized === "dropped") return "dropped";
    if (normalized === "blocked") return "blocked";
    if (normalized === "spamreport" || normalized === "spam_report") return "spam_report";
    if (normalized === "open" || normalized === "opened") return "opened";
    if (normalized === "click" || normalized === "clicked") return "clicked";
    return null;
  }

  receiveEmailIntake(payload, { signature = "" } = {}) {
    const raw = JSON.stringify(payload ?? {});
    this.verifyWebhookSignature("intake_email", raw, signature);
    const input = inboundIntakeSchema.parse(payload);
    const address = this.db
      .prepare("SELECT * FROM tenant_intake_addresses WHERE full_address = ? AND active = 1")
      .get(normalizedEmail(input.intake_address));
    if (!address) throw error("intake_address_not_found", 404);
    const existing = this.db
      .prepare("SELECT oi.id FROM order_intake_items oi JOIN intake_source_messages ism ON ism.id = oi.source_message_id AND ism.tenant_id = oi.tenant_id WHERE oi.tenant_id = ? AND ism.provider_message_id = ?")
      .get(address.tenant_id, input.provider_message_id);
    if (existing) return { item: this.intakeItemByTenant(address.tenant_id, existing.id), idempotent: true };
    const sourceId = randomUUID();
    const itemId = randomUUID();
    const timestamp = now();
    const receivedAt = input.received_at ? new Date(input.received_at).toISOString() : timestamp;
    const payloadHash = createHash("sha256").update(raw).digest("hex");
    const storedPaths = [];
    const attachments = input.attachments.map((attachment) => {
      const extension = fileExtension(attachment.original_filename);
      let accepted = ALLOWED_ATTACHMENT_MIME_TYPES.has(attachment.mime_type) && MIME_EXTENSIONS[attachment.mime_type]?.has(extension) && attachment.byte_size <= uploadLimitBytes();
      let rejectionReason = accepted ? null : "unsupported_or_too_large";
      let storageKey = null;
      let sha256 = attachment.sha256 ?? null;
      if (accepted && attachment.content_base64) {
        try {
          const bytes = Buffer.from(attachment.content_base64, "base64");
          if (bytes.length !== attachment.byte_size) throw error("attachment_integrity_mismatch", 409);
          const actualSha = createHash("sha256").update(bytes).digest("hex");
          if (sha256 && sha256.toLowerCase() !== actualSha) throw error("attachment_integrity_mismatch", 409);
          sha256 = actualSha;
          storageKey = join(address.tenant_id, "intake", sourceId, `${randomUUID()}${extension}`).replace(/\\/g, "/");
          const path = this.attachmentPath(storageKey);
          durableWriteFile(path, bytes, { flag: "wx", mode: 0o600 });
          verifyAttachmentContent(path, attachment.mime_type);
          storedPaths.push(path);
        } catch {
          if (storageKey) removeDurableFile(this.attachmentPath(storageKey));
          accepted = false;
          rejectionReason = "content_validation_failed";
          storageKey = null;
        }
      }
      return { ...attachment, sha256, storage_key: storageKey, accepted, rejection_reason: rejectionReason };
    });
    try {
      this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO intake_source_messages
           (id, portable_id, tenant_id, provider_message_id, intake_address, sender_name, sender_email, recipients_json,
            subject, sent_at, received_at, text_body, html_body, sanitized_html, payload_hash, receipt_status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?)`,
        )
        .run(sourceId, portable("intake_source_message"), address.tenant_id, input.provider_message_id, normalizedEmail(input.intake_address), input.sender_name ?? null, normalizedEmail(input.sender_email), JSON.stringify(input.recipients.map(normalizedEmail)), input.subject || "(no subject)", input.sent_at ? new Date(input.sent_at).toISOString() : null, receivedAt, input.text_body ?? null, input.html_body ?? null, sanitizeHtmlFragment(input.html_body ?? ""), payloadHash, timestamp);
      this.db
        .prepare(
          `INSERT INTO order_intake_items
           (id, portable_id, tenant_id, source_message_id, status, summary, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'new', ?, ?, ?)`,
        )
        .run(itemId, portable("order_intake_item"), address.tenant_id, sourceId, input.subject || "Forwarded order email", timestamp, timestamp);
      for (const attachment of attachments) {
        this.db
          .prepare(
            `INSERT INTO intake_attachments
             (id, tenant_id, source_message_id, original_filename, storage_key, mime_type, byte_size, sha256, accepted, rejection_reason, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(randomUUID(), address.tenant_id, sourceId, safeFilename(attachment.original_filename), attachment.storage_key, attachment.mime_type, attachment.byte_size, attachment.sha256 ?? null, bool(attachment.accepted), attachment.rejection_reason, timestamp);
      }
      this.auditSystem(address.tenant_id, "intake.email_received", "order_intake", itemId, itemId, "Forwarded email received into Incoming Requests", { provider_message_id: input.provider_message_id, attachment_count: attachments.length });
      });
    } catch (err) {
      for (const path of storedPaths) removeDurableFile(path);
      throw err;
    }
    return { item: this.intakeItemByTenant(address.tenant_id, itemId), idempotent: false };
  }

  intakeRows(actor, filters = {}) {
    const params = [actor.tenant_id];
    const where = ["oi.tenant_id = ?"];
    if (filters.status && filters.status !== "all") {
      where.push("oi.status = ?");
      params.push(filters.status);
    }
    if (filters.assigned_user_id) {
      where.push("oi.assigned_user_id = ?");
      params.push(filters.assigned_user_id);
    }
    if (filters.customer_id) {
      where.push("oi.customer_id = ?");
      params.push(filters.customer_id);
    }
    if (filters.search) {
      where.push("(oi.summary LIKE ? OR ism.sender_email LIKE ? OR ism.subject LIKE ?)");
      const term = `%${filters.search}%`;
      params.push(term, term, term);
    }
    return this.db
      .prepare(
        `SELECT oi.*, ism.sender_email, ism.sender_name, ism.subject, ism.received_at,
                c.contact_name AS customer_contact_name, c.business_name AS customer_business_name, c.email AS customer_email,
                u.display_name AS assignee_name,
                co.order_number AS converted_order_number, lo.order_number AS linked_order_number
         FROM order_intake_items oi
         JOIN intake_source_messages ism ON ism.id = oi.source_message_id AND ism.tenant_id = oi.tenant_id
         LEFT JOIN customers c ON c.id = oi.customer_id AND c.tenant_id = oi.tenant_id
         LEFT JOIN users u ON u.id = oi.assigned_user_id AND u.tenant_id = oi.tenant_id
         LEFT JOIN orders co ON co.id = oi.converted_order_id AND co.tenant_id = oi.tenant_id
         LEFT JOIN orders lo ON lo.id = oi.linked_order_id AND lo.tenant_id = oi.tenant_id
         WHERE ${where.join(" AND ")}
         ORDER BY ism.received_at DESC`,
      )
      .all(...params);
  }

  listIntakeItems(actor, filters = {}) {
    return this.intakeRows(actor, filters).map((row) => mapIntakeItem(row));
  }

  intakeItem(actor, id) {
    return this.intakeItemByTenant(actor.tenant_id, id);
  }

  intakeItemByTenant(tenantId, id) {
    const row = this.db
      .prepare(
        `SELECT oi.*,
                c.contact_name AS customer_contact_name, c.business_name AS customer_business_name, c.email AS customer_email,
                u.display_name AS assignee_name,
                co.order_number AS converted_order_number, lo.order_number AS linked_order_number
         FROM order_intake_items oi
         LEFT JOIN customers c ON c.id = oi.customer_id AND c.tenant_id = oi.tenant_id
         LEFT JOIN users u ON u.id = oi.assigned_user_id AND u.tenant_id = oi.tenant_id
         LEFT JOIN orders co ON co.id = oi.converted_order_id AND co.tenant_id = oi.tenant_id
         LEFT JOIN orders lo ON lo.id = oi.linked_order_id AND lo.tenant_id = oi.tenant_id
         WHERE oi.id = ? AND oi.tenant_id = ?`,
      )
      .get(id, tenantId);
    if (!row) throw error("intake_item_not_found", 404);
    const source = mapIntakeMessage(this.db.prepare("SELECT * FROM intake_source_messages WHERE id = ? AND tenant_id = ?").get(row.source_message_id, tenantId));
    const attachments = this.db.prepare("SELECT * FROM intake_attachments WHERE source_message_id = ? AND tenant_id = ? ORDER BY created_at").all(row.source_message_id, tenantId).map(mapIntakeAttachment);
    return mapIntakeItem(row, source, attachments);
  }

  updateIntakeItem(actor, id, payload) {
    this.requireRole(actor, WRITE_ROLES);
    const input = intakeUpdateSchema.parse(payload);
    const existing = this.intakeItem(actor, id);
    if (!Object.keys(input).length) throw error("no_updates");
    if (input.customer_id) this.customer(actor, input.customer_id);
    if (input.assigned_user_id) {
      const user = this.db.prepare("SELECT id FROM users WHERE id = ? AND tenant_id = ? AND active = 1").get(input.assigned_user_id, actor.tenant_id);
      if (!user) throw error("user_not_found", 404);
    }
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(input)) {
      fields.push(`${key} = ?`);
      values.push(value ?? null);
    }
    fields.push("updated_at = ?");
    values.push(now(), id, actor.tenant_id);
    this.db.prepare(`UPDATE order_intake_items SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`).run(...values);
    this.audit(actor, "intake.update", "order_intake", id, existing.portable_id, "Incoming request updated", input);
    return this.intakeItem(actor, id);
  }

  createCustomerFromIntake(actor, id, payload) {
    this.requireRole(actor, WRITE_ROLES);
    const item = this.intakeItem(actor, id);
    const input = intakeCustomerSchema.parse(payload);
    const source = item.source_message;
    const customer = this.createCustomer(actor, {
      contact_name: input.contact_name,
      business_name: input.business_name ?? null,
      email: input.email ?? source.sender_email,
      phone: input.phone ?? null,
      billing_address: input.billing_address ?? { line1: "Address pending", line2: null, city: "Pending", state: "NA", postal_code: "00000", country: "US" },
      active: true,
      tax_exempt: false,
      internal_notes: `Created from incoming request ${item.summary}`,
    });
    return this.updateIntakeItem(actor, id, { customer_id: customer.id, status: "reviewing" });
  }

  createDraftOrderFromIntake(actor, id, payload = {}) {
    this.requireRole(actor, WRITE_ROLES);
    return this.transaction(() => {
      const item = this.intakeItem(actor, id);
      if (item.converted_order_id) return { order: this.order(actor, item.converted_order_id), item, idempotent: true };
      if (item.linked_order_id) throw error("intake_already_linked", 409);
      const customerId = payload.customer_id || item.customer_id;
      if (!customerId) throw error("intake_customer_required", 400);
      this.customer(actor, customerId);
      const source = item.source_message;
      const order = this.createOrderInternal(actor, {
        customer_id: customerId,
        title: payload.title || source.subject || item.summary,
        document_date: today(),
        due_date: payload.due_date ?? item.follow_up_at ?? null,
        status: "draft",
        discount_cents: 0,
        internal_notes: `Draft created from incoming request ${item.summary}. Original forwarded email preserved on incoming request ${item.id}.`,
        items: [{
          title: "Intake Review",
          description: source.text_body?.slice(0, 500) || source.subject || "Review forwarded email for order details.",
          quantity_decimal: "1",
          unit_price_cents: 0,
          line_total_cents: 0,
          taxable: false,
          production_required: false,
        }],
      });
      const timestamp = now();
      this.db
        .prepare("UPDATE order_intake_items SET converted_order_id = ?, converted_by_user_id = ?, converted_at = ?, status = 'converted_to_order', updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(order.id, actor.id, timestamp, timestamp, id, actor.tenant_id);
      this.copyIntakeAttachmentsToOrder(actor, item, order.id);
      this.audit(actor, "intake.convert_to_order", "order_intake", id, item.portable_id, `Incoming request converted to ${order.order_number}`, { order_id: order.id });
      return { order, item: this.intakeItem(actor, id), idempotent: false };
    });
  }

  linkIntakeToOrder(actor, id, payload = {}) {
    this.requireRole(actor, WRITE_ROLES);
    const orderId = z.object({ order_id: z.string().min(1) }).parse(payload).order_id;
    return this.transaction(() => {
      const item = this.intakeItem(actor, id);
      if (item.converted_order_id) throw error("intake_already_converted", 409);
      const order = this.order(actor, orderId);
      const timestamp = now();
      this.db
        .prepare("UPDATE order_intake_items SET linked_order_id = ?, customer_id = COALESCE(customer_id, ?), converted_by_user_id = ?, converted_at = ?, status = 'attached_to_existing_order', updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(order.id, order.customer_id, actor.id, timestamp, timestamp, id, actor.tenant_id);
      this.copyIntakeAttachmentsToOrder(actor, item, order.id);
      this.audit(actor, "intake.link_order", "order_intake", id, item.portable_id, `Incoming request linked to ${order.order_number}`, { order_id: order.id });
      return { order, item: this.intakeItem(actor, id) };
    });
  }

  copyIntakeAttachmentsToOrder(actor, intakeItem, orderId) {
    const order = this.order(actor, orderId);
    const rows = this.db
      .prepare("SELECT * FROM intake_attachments WHERE tenant_id = ? AND source_message_id = ? AND accepted = 1 AND storage_key IS NOT NULL AND order_attachment_id IS NULL")
      .all(actor.tenant_id, intakeItem.source_message_id);
    const copiedPaths = [];
    try {
      for (const row of rows) {
        const sourcePath = this.attachmentPath(row.storage_key);
        if (!existsSync(sourcePath)) throw error("attachment_file_missing", 404);
        const stat = statSync(sourcePath);
        if (!stat.isFile() || stat.size !== row.byte_size) throw error("attachment_integrity_mismatch", 409);
        const sha256 = fileSha256(sourcePath);
        if (row.sha256 && row.sha256 !== sha256) throw error("attachment_integrity_mismatch", 409);
        const storageKey = join(actor.tenant_id, orderId, `${randomUUID()}${fileExtension(row.original_filename)}`).replace(/\\/g, "/");
        const targetPath = this.attachmentPath(storageKey);
        durableCopyFile(sourcePath, targetPath, { mode: 0o600 });
        verifyAttachmentContent(targetPath, row.mime_type);
        const dimensions = imageDimensions(targetPath, row.mime_type);
        copiedPaths.push(targetPath);
        const id = randomUUID();
        const timestamp = now();
        this.db
          .prepare(
            `INSERT INTO order_attachments
             (id, portable_id, tenant_id, order_id, original_filename, storage_key, mime_type, byte_size, sha256, created_by_user_id, created_at, source_type, image_width, image_height)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'intake', ?, ?)`,
          )
          .run(id, portable("order_attachment"), actor.tenant_id, orderId, row.original_filename, storageKey, row.mime_type, row.byte_size, sha256, actor.id, timestamp, dimensions.width, dimensions.height);
        this.db.prepare("UPDATE intake_attachments SET order_attachment_id = ? WHERE id = ? AND tenant_id = ?").run(id, row.id, actor.tenant_id);
        this.audit(actor, "intake.attachment_carried", "order", orderId, order.portable_id, `Intake attachment ${row.original_filename} carried into Order`, { intake_item_id: intakeItem.id, attachment_id: id });
      }
      return rows.length;
    } catch (err) {
      for (const path of copiedPaths) removeDurableFile(path);
      throw err;
    }
  }

}

export const communicationMethods = methodsFromClass(CommunicationDomainMethods);
