import { useState } from "react";
import {
  Save,
} from "lucide-react";
import { CommunicationPanel } from "../orders/OrderWorkspace.jsx";
import {
  blankAddress,
  Field,
  AddressFields,
  useLoad,
  Toolbar,
  TwoColumn,
  AsyncState,
  RecordList,
} from "../general/GeneralPages.jsx";

function CustomersPage({ api }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const [form, setForm] = useState({ contact_name: "", business_name: "", email: "", phone: "", billing_address: blankAddress, active: true, tax_exempt: false, tax_exemption_note: "", internal_notes: "" });
  const [editingId, setEditingId] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [action, setAction] = useState({ busy: false, error: "" });
  const state = useLoad(() => api.get(`/customers?search=${encodeURIComponent(search)}&status=${status}`), [search, status]);
  async function save(event) {
    event.preventDefault();
    setAction({ busy: true, error: "" });
    try {
      const payload = { ...form, email: form.email || null, phone: form.phone || null, tax_exemption_note: form.tax_exemption_note || null, internal_notes: form.internal_notes || null };
      if (editingId) await api.patch(`/customers/${editingId}`, payload);
      else await api.post("/customers", payload);
      setEditingId("");
      setSelectedCustomer(null);
      setForm({ contact_name: "", business_name: "", email: "", phone: "", billing_address: blankAddress, active: true, tax_exempt: false, tax_exemption_note: "", internal_notes: "" });
      state.refresh();
    } catch (err) {
      setAction({ busy: false, error: err.message, conflicts: err.conflicts || [] });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  async function edit(id) {
    setAction({ busy: true, error: "" });
    try {
      const customer = await api.get(`/customers/${id}`);
      setSelectedCustomer(customer);
      setEditingId(id);
      setForm({
        contact_name: customer.contact_name,
        business_name: customer.business_name || "",
        email: customer.email || "",
        phone: customer.phone || "",
        billing_address: customer.billing_address,
        active: customer.active,
        tax_exempt: customer.tax_exempt,
        tax_exemption_note: customer.tax_exemption_note || "",
        internal_notes: customer.internal_notes || "",
      });
    } catch (err) {
      setAction({ busy: false, error: err.message, conflicts: err.conflicts || [] });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  return (
    <TwoColumn>
      <section className="panel">
        <Toolbar title="Customers">
          <input placeholder="Search" value={search} onChange={(event) => setSearch(event.target.value)} />
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </select>
        </Toolbar>
        {action.error && <div className="error-state">{action.error}</div>}
        <AsyncState state={state} empty="No customers found">
          <RecordList items={state.data?.items || []} primary="contact_name" secondary={(item) => item.business_name || item.customer_number} amount={(item) => item.tax_exempt ? "Tax exempt" : "Taxable"} actions={(item) => (
            <button onClick={() => edit(item.id)}><Save size={14} />Edit</button>
          )} />
        </AsyncState>
      </section>
      <form className="panel form-grid" onSubmit={save}>
        <Toolbar title={editingId ? "Edit Customer" : "Customer"}>
          {editingId && <button type="button" onClick={() => { setEditingId(""); setSelectedCustomer(null); setForm({ contact_name: "", business_name: "", email: "", phone: "", billing_address: blankAddress, active: true, tax_exempt: false, tax_exemption_note: "", internal_notes: "" }); }}>New</button>}
        </Toolbar>
        <Field label="Contact name" value={form.contact_name} onChange={(contact_name) => setForm({ ...form, contact_name })} />
        <Field label="Business name" value={form.business_name} onChange={(business_name) => setForm({ ...form, business_name })} />
        <Field label="Email" type="email" value={form.email} onChange={(email) => setForm({ ...form, email })} />
        {form.email && <a className="inline-link" href={`mailto:${form.email}`}>{form.email}</a>}
        <Field label="Phone" value={form.phone} onChange={(phone) => setForm({ ...form, phone })} />
        {form.phone && <a className="inline-link" href={`tel:${form.phone}`}>{form.phone}</a>}
        <AddressFields address={form.billing_address} setAddress={(billing_address) => setForm({ ...form, billing_address })} />
        <label className="check-row"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} />Active</label>
        <label className="check-row"><input type="checkbox" checked={form.tax_exempt} onChange={(event) => setForm({ ...form, tax_exempt: event.target.checked })} />Tax exempt</label>
        <Field label="Tax note" value={form.tax_exemption_note} onChange={(tax_exemption_note) => setForm({ ...form, tax_exemption_note })} />
        <Field label="Internal notes" value={form.internal_notes} onChange={(internal_notes) => setForm({ ...form, internal_notes })} />
        {selectedCustomer && <RelatedRecords customer={selectedCustomer} />}
        {selectedCustomer && <CommunicationPanel api={api} customerId={selectedCustomer.id} savedCustomerEmail={selectedCustomer.email || ""} />}
        <button className="primary-button" disabled={action.busy}><Save size={16} />{editingId ? "Update Customer" : "Save Customer"}</button>
      </form>
    </TwoColumn>
  );
}

function RelatedRecords({ customer }) {
  return (
    <section className="related-records">
      <h3>Related Quotes</h3>
      {(customer.related_estimates || []).map((item) => <span key={item.id}>{item.estimate_number} {item.status}</span>)}
      <h3>Related Orders</h3>
      {(customer.related_orders || []).map((item) => <span key={item.id}>{item.order_number} {item.status}</span>)}
    </section>
  );
}

export {
  CustomersPage,
  RelatedRecords,
};
