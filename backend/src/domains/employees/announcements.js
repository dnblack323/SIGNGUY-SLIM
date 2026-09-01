import { randomUUID } from "node:crypto";
import {
  ADMIN_ROLES,
  announcementSchema,
  announcementUpdateSchema,
  error,
  mapAnnouncement,
  mapEmployee,
  normalizeTimedDateTime,
  now,
  portable
} from "./shared.js";

export const employeeAnnouncementMethods = {
  normalizeAnnouncementInput(actor, input, existing = null) {
    const timezone = this.tenantTimezone(actor);
    const publishAt = input.publish_at !== undefined
      ? normalizeTimedDateTime(input.publish_at, timezone)
      : existing?.publish_at || now();
    const expiresAt = input.expires_at === null || input.expires_at === ""
      ? null
      : input.expires_at !== undefined
        ? normalizeTimedDateTime(input.expires_at, timezone)
        : existing?.expires_at || null;
    if (expiresAt && new Date(expiresAt) <= new Date(publishAt)) throw error("announcement_date_invalid", 400);
    return { ...input, publish_at: publishAt, expires_at: expiresAt };
  },

  announcementRow(actor, announcementId) {
    const row = this.db
      .prepare(
        `SELECT a.*, u.display_name AS author_name
         FROM employee_announcements a
         JOIN users u ON u.id = a.author_user_id AND u.tenant_id = a.tenant_id
         WHERE a.id = ? AND a.tenant_id = ?`,
      )
      .get(announcementId, actor.tenant_id);
    if (!row) throw error("announcement_not_found", 404);
    return row;
  },

  announcement(actor, announcementId) {
    this.requireRole(actor, ADMIN_ROLES);
    return mapAnnouncement(this.announcementRow(actor, announcementId));
  },

  listAnnouncements(actor) {
    this.requireRole(actor, ADMIN_ROLES);
    return {
      items: this.db
        .prepare(
          `SELECT a.*, u.display_name AS author_name
           FROM employee_announcements a
           JOIN users u ON u.id = a.author_user_id AND u.tenant_id = a.tenant_id
           WHERE a.tenant_id = ?
           ORDER BY a.archived_at IS NOT NULL, a.publish_at DESC, a.created_at DESC`,
        )
        .all(actor.tenant_id)
        .map(mapAnnouncement),
    };
  },

  createAnnouncement(actor, payload) {
    this.requireRole(actor, ADMIN_ROLES);
    const input = this.normalizeAnnouncementInput(actor, announcementSchema.parse(payload));
    const id = randomUUID();
    const timestamp = now();
    return this.transaction(() => {
      this.db.prepare(
        `INSERT INTO employee_announcements
         (id, portable_id, tenant_id, author_user_id, title, body, publish_at, expires_at, audience_role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, portable("employee_announcement"), actor.tenant_id, actor.id, input.title, input.body, input.publish_at, input.expires_at, input.audience_role, timestamp, timestamp);
      const announcement = this.announcementRow(actor, id);
      this.audit(actor, "announcement.create", "employee_announcement", id, announcement.portable_id, `Announcement ${announcement.title} created`, {
        audience_role: announcement.audience_role,
        publish_at: announcement.publish_at,
        expires_at: announcement.expires_at,
      });
      return mapAnnouncement(announcement);
    });
  },

  updateAnnouncement(actor, announcementId, payload) {
    this.requireRole(actor, ADMIN_ROLES);
    const existing = this.announcementRow(actor, announcementId);
    if (existing.archived_at) throw error("announcement_archived", 409);
    const input = announcementUpdateSchema.parse(payload);
    if (!Object.keys(input).length) throw error("no_updates");
    const normalized = this.normalizeAnnouncementInput(actor, input, existing);
    const fields = [];
    const values = [];
    for (const key of ["title", "body", "publish_at", "expires_at", "audience_role"]) {
      if (Object.prototype.hasOwnProperty.call(normalized, key)) {
        fields.push(`${key} = ?`);
        values.push(normalized[key]);
      }
    }
    fields.push("updated_at = ?");
    values.push(now(), announcementId, actor.tenant_id);
    return this.transaction(() => {
      this.db.prepare(`UPDATE employee_announcements SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`).run(...values);
      const updated = this.announcementRow(actor, announcementId);
      this.audit(actor, "announcement.update", "employee_announcement", announcementId, updated.portable_id, `Announcement ${updated.title} updated`, {
        before: {
          title: existing.title,
          body: existing.body,
          publish_at: existing.publish_at,
          expires_at: existing.expires_at,
          audience_role: existing.audience_role,
        },
        after: normalized,
      });
      return mapAnnouncement(updated);
    });
  },

  archiveAnnouncement(actor, announcementId) {
    this.requireRole(actor, ADMIN_ROLES);
    const existing = this.announcementRow(actor, announcementId);
    if (existing.archived_at) return mapAnnouncement(existing);
    return this.transaction(() => {
      this.db
        .prepare("UPDATE employee_announcements SET archived_at = ?, archived_by_user_id = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(now(), actor.id, now(), announcementId, actor.tenant_id);
      const archived = this.announcementRow(actor, announcementId);
      this.audit(actor, "announcement.archive", "employee_announcement", announcementId, archived.portable_id, `Announcement ${archived.title} archived`);
      return mapAnnouncement(archived);
    });
  },

  visibleAnnouncementRows(actor, employee, announcementId = null) {
    const timestamp = now();
    const params = [employee.id, actor.tenant_id, timestamp, timestamp, employee.role];
    let where = "a.tenant_id = ? AND a.archived_at IS NULL AND a.publish_at <= ? AND (a.expires_at IS NULL OR a.expires_at > ?) AND a.audience_role IN ('all', ?)";
    if (announcementId) {
      where += " AND a.id = ?";
      params.push(announcementId);
    }
    return this.db
      .prepare(
        `SELECT a.*, u.display_name AS author_name, r.read_at
         FROM employee_announcements a
         JOIN users u ON u.id = a.author_user_id AND u.tenant_id = a.tenant_id
         LEFT JOIN employee_announcement_reads r ON r.tenant_id = a.tenant_id AND r.announcement_id = a.id AND r.employee_id = ?
         WHERE ${where}
         ORDER BY a.publish_at DESC, a.created_at DESC`,
      )
      .all(...params);
  },

  portalAnnouncements(actor) {
    const employee = this.activeEmployeeForActor(actor);
    return { employee: mapEmployee(employee), items: this.visibleAnnouncementRows(actor, employee).map(mapAnnouncement) };
  },

  portalAnnouncement(actor, announcementId) {
    const employee = this.activeEmployeeForActor(actor);
    return this.transaction(() => {
      const row = this.visibleAnnouncementRows(actor, employee, announcementId)[0];
      if (!row) throw error("announcement_not_found", 404);
      if (!row.read_at) {
        this.db
          .prepare(
            `INSERT INTO employee_announcement_reads (id, tenant_id, announcement_id, employee_id, user_id, read_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(tenant_id, announcement_id, employee_id) DO UPDATE SET read_at = COALESCE(employee_announcement_reads.read_at, excluded.read_at)`,
          )
          .run(randomUUID(), actor.tenant_id, announcementId, employee.id, actor.id, now());
      }
      const updated = this.visibleAnnouncementRows(actor, employee, announcementId)[0];
      return mapAnnouncement(updated);
    });
  }
};
