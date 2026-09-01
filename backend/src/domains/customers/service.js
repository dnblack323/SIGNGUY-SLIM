import * as shared from "../shared.js";
import { methodsFromClass } from "../install.js";

const {
  WRITE_ROLES,
  addressSchema,
  bool,
  error,
  mapCustomer,
  now,
  portable,
  randomUUID,
  z,
} = shared;

class CustomerDomainMethods {
  createCustomer(actor, payload) {
    this.requireRole(actor, WRITE_ROLES);
    const input = z
      .object({
        contact_name: z.string().min(1),
        business_name: z.string().nullable().optional(),
        email: z.string().email().nullable().optional(),
        phone: z.string().nullable().optional(),
        billing_address: addressSchema,
        active: z.boolean().default(true),
        tax_exempt: z.boolean().default(false),
        tax_exemption_note: z.string().nullable().optional(),
        internal_notes: z.string().nullable().optional(),
      })
      .parse(payload);
    const id = randomUUID();
    const pid = portable("customer");
    const timestamp = now();
    const number = this.nextNumber(actor.tenant_id, "customer", "C");
    this.db
      .prepare(
        `INSERT INTO customers
         (id, portable_id, tenant_id, customer_number, contact_name, business_name, email, phone,
          billing_line1, billing_line2, billing_city, billing_state, billing_postal_code, billing_country,
          active, tax_exempt, tax_exemption_note, internal_notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        pid,
        actor.tenant_id,
        number,
        input.contact_name,
        input.business_name ?? null,
        input.email ?? null,
        input.phone ?? null,
        input.billing_address.line1,
        input.billing_address.line2 ?? null,
        input.billing_address.city,
        input.billing_address.state,
        input.billing_address.postal_code,
        input.billing_address.country,
        bool(input.active),
        bool(input.tax_exempt),
        input.tax_exemption_note ?? null,
        input.internal_notes ?? null,
        timestamp,
        timestamp,
      );
    this.audit(actor, "customer.create", "customer", id, pid, `Customer ${input.contact_name} created`, {
      customer_number: number,
      tax_exempt: input.tax_exempt,
    });
    return this.customer(actor, id);
  }

  listCustomers(actor, filters = {}) {
    const params = [actor.tenant_id];
    let where = "tenant_id = ?";
    if (filters.status === "active") where += " AND active = 1";
    if (filters.status === "inactive") where += " AND active = 0";
    if (filters.search) {
      where += " AND (contact_name LIKE ? OR business_name LIKE ? OR email LIKE ? OR phone LIKE ?)";
      const term = `%${filters.search}%`;
      params.push(term, term, term, term);
    }
    return this.db.prepare(`SELECT * FROM customers WHERE ${where} ORDER BY customer_number DESC`).all(...params).map(mapCustomer);
  }

  customer(actor, id) {
    const row = this.db.prepare("SELECT * FROM customers WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
    if (!row) throw error("customer_not_found", 404);
    const customer = mapCustomer(row);
    customer.related_estimates = this.db
      .prepare("SELECT id, estimate_number, status, total_cents FROM estimates WHERE customer_id = ? AND tenant_id = ? ORDER BY estimate_number DESC")
      .all(id, actor.tenant_id);
    customer.related_orders = this.db
      .prepare("SELECT id, order_number, status, total_cents FROM orders WHERE customer_id = ? AND tenant_id = ? ORDER BY order_number DESC")
      .all(id, actor.tenant_id);
    return customer;
  }

  updateCustomer(actor, id, payload) {
    this.requireRole(actor, WRITE_ROLES);
    this.customer(actor, id);
    const input = z
      .object({
        contact_name: z.string().min(1).optional(),
        business_name: z.string().nullable().optional(),
        email: z.string().email().nullable().optional(),
        phone: z.string().nullable().optional(),
        billing_address: addressSchema.optional(),
        active: z.boolean().optional(),
        tax_exempt: z.boolean().optional(),
        tax_exemption_note: z.string().nullable().optional(),
        internal_notes: z.string().nullable().optional(),
      })
      .parse(payload);
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(input)) {
      if (key === "billing_address") {
        fields.push("billing_line1 = ?", "billing_line2 = ?", "billing_city = ?", "billing_state = ?", "billing_postal_code = ?", "billing_country = ?");
        values.push(value.line1, value.line2 ?? null, value.city, value.state, value.postal_code, value.country);
      } else {
        fields.push(`${key} = ?`);
        values.push(typeof value === "boolean" ? bool(value) : value ?? null);
      }
    }
    if (!fields.length) throw error("no_updates");
    fields.push("updated_at = ?");
    values.push(now(), id, actor.tenant_id);
    this.db.prepare(`UPDATE customers SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`).run(...values);
    const updated = this.customer(actor, id);
    this.audit(actor, "customer.update", "customer", id, updated.portable_id, "Customer updated", input);
    return updated;
  }

}

export const customerMethods = methodsFromClass(CustomerDomainMethods);
