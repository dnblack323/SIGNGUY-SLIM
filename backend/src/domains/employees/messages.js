import { randomUUID } from "node:crypto";
import {
  directMessageSchema,
  error,
  mapMessage,
  now,
  portable
} from "./shared.js";

export const employeeMessageMethods = {
  messageParticipants(actor) {
    this.activeEmployeeForActor(actor);
    return {
      items: this.db
        .prepare(
          `SELECT e.*, u.display_name, u.email AS user_email
           FROM employees e
           JOIN users u ON u.id = e.user_id AND u.tenant_id = e.tenant_id
           WHERE e.tenant_id = ? AND e.active = 1 AND e.portal_access_enabled = 1 AND u.active = 1 AND u.id <> ?
           ORDER BY e.name, e.employee_number`,
        )
        .all(actor.tenant_id, actor.id)
        .map((row) => ({
          user_id: row.user_id,
          display_name: row.display_name || row.name,
          employee_id: row.id,
          employee_number: row.employee_number,
          role: row.role,
          email: row.user_email || row.email,
        })),
    };
  },

  sendDirectMessage(actor, payload) {
    const senderEmployee = this.activeEmployeeForActor(actor);
    const input = directMessageSchema.parse(payload);
    if (input.sender_user_id && input.sender_user_id !== actor.id) throw error("message_sender_spoof", 403);
    if (input.recipient_user_id === actor.id) throw error("message_recipient_invalid", 400);
    const recipient = this.activeEmployeeForUser(actor, input.recipient_user_id);
    const id = randomUUID();
    const portableId = portable("employee_direct_message");
    const timestamp = now();
    return this.transaction(() => {
      this.db.prepare(
        `INSERT INTO employee_direct_messages
         (id, portable_id, tenant_id, sender_user_id, recipient_user_id, body, sent_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, portableId, actor.tenant_id, actor.id, recipient.user_id, input.body, timestamp, timestamp);
      this.audit(actor, "message.send", "employee_message", id, portableId, `Message sent to ${recipient.display_name || recipient.name}`, {
        sender_employee_id: senderEmployee.id,
        recipient_employee_id: recipient.id,
      });
      return this.messageById(actor, id);
    });
  },

  messageById(actor, id) {
    const row = this.db
      .prepare(
        `SELECT m.*, su.display_name AS sender_name, ru.display_name AS recipient_name
         FROM employee_direct_messages m
         JOIN users su ON su.id = m.sender_user_id AND su.tenant_id = m.tenant_id
         JOIN users ru ON ru.id = m.recipient_user_id AND ru.tenant_id = m.tenant_id
         WHERE m.id = ? AND m.tenant_id = ? AND (m.sender_user_id = ? OR m.recipient_user_id = ?)`,
      )
      .get(id, actor.tenant_id, actor.id, actor.id);
    if (!row) throw error("message_not_found", 404);
    return mapMessage(row, actor.id);
  },

  listMessageConversations(actor) {
    this.activeEmployeeForActor(actor);
    const rows = this.db
      .prepare(
        `SELECT m.*, su.display_name AS sender_name, ru.display_name AS recipient_name
         FROM employee_direct_messages m
         JOIN users su ON su.id = m.sender_user_id AND su.tenant_id = m.tenant_id
         JOIN users ru ON ru.id = m.recipient_user_id AND ru.tenant_id = m.tenant_id
         WHERE m.tenant_id = ? AND (m.sender_user_id = ? OR m.recipient_user_id = ?)
         ORDER BY m.sent_at DESC, m.id DESC`,
      )
      .all(actor.tenant_id, actor.id, actor.id);
    const conversations = new Map();
    for (const row of rows) {
      const otherUserId = row.sender_user_id === actor.id ? row.recipient_user_id : row.sender_user_id;
      const existing = conversations.get(otherUserId) || {
        user_id: otherUserId,
        display_name: row.sender_user_id === actor.id ? row.recipient_name : row.sender_name,
        unread_count: 0,
        last_message: mapMessage(row, actor.id),
      };
      if (row.recipient_user_id === actor.id && !row.recipient_read_at) existing.unread_count += 1;
      conversations.set(otherUserId, existing);
    }
    return { items: [...conversations.values()] };
  },

  historicalMessageParticipant(actor, otherUserId) {
    const row = this.db
      .prepare(
        `SELECT e.*, u.display_name, u.email AS user_email, u.active AS user_active
         FROM employees e
         JOIN users u ON u.id = e.user_id AND u.tenant_id = e.tenant_id
         WHERE e.tenant_id = ? AND e.user_id = ?
         ORDER BY e.created_at DESC LIMIT 1`,
      )
      .get(actor.tenant_id, otherUserId);
    if (!row) throw error("message_not_found", 404);
    return row;
  },

  messageConversation(actor, otherUserId) {
    this.activeEmployeeForActor(actor);
    const other = this.historicalMessageParticipant(actor, otherUserId);
    const readAt = now();
    return this.transaction(() => {
      this.db
        .prepare("UPDATE employee_direct_messages SET recipient_read_at = COALESCE(recipient_read_at, ?) WHERE tenant_id = ? AND sender_user_id = ? AND recipient_user_id = ?")
        .run(readAt, actor.tenant_id, other.user_id, actor.id);
      const messages = this.db
        .prepare(
          `SELECT m.*, su.display_name AS sender_name, ru.display_name AS recipient_name
           FROM employee_direct_messages m
           JOIN users su ON su.id = m.sender_user_id AND su.tenant_id = m.tenant_id
           JOIN users ru ON ru.id = m.recipient_user_id AND ru.tenant_id = m.tenant_id
           WHERE m.tenant_id = ? AND ((m.sender_user_id = ? AND m.recipient_user_id = ?) OR (m.sender_user_id = ? AND m.recipient_user_id = ?))
           ORDER BY m.sent_at ASC, m.id ASC`,
        )
        .all(actor.tenant_id, actor.id, other.user_id, other.user_id, actor.id)
        .map((row) => mapMessage(row, actor.id));
      return {
        participant: {
          user_id: other.user_id,
          display_name: other.display_name || other.name,
          employee_id: other.id,
          employee_number: other.employee_number,
          role: other.role,
        },
        messages,
      };
    });
  }
};
