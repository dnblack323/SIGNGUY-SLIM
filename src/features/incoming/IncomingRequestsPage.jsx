import {
  useEffect,
  useState,
} from "react";
import {
  FileText,
  Save,
  ShoppingBag,
  UserPlus,
} from "lucide-react";
import {
  INTAKE_STATUS_LABELS,
  formatDate,
  Field,
  SelectField,
  useLoad,
  Toolbar,
  TwoColumn,
  AsyncState,
} from "../general/GeneralPages.jsx";

function OrderIntakePage({ api }) {
  const [filters, setFilters] = useState({ status: "all", search: "" });
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState({ status: "reviewing", customer_id: "", assigned_user_id: "", follow_up_at: "", summary: "", internal_notes: "" });
  const [customerForm, setCustomerForm] = useState({ contact_name: "", business_name: "", email: "", phone: "" });
  const [linkOrderId, setLinkOrderId] = useState("");
  const [action, setAction] = useState({ busy: false, error: "", saved: "" });
  const query = `/orders/intake?status=${encodeURIComponent(filters.status)}&search=${encodeURIComponent(filters.search)}`;
  const intake = useLoad(() => api.get(query), [filters.status, filters.search]);
  const customers = useLoad(() => api.get("/customers"), []);
  const settings = useLoad(() => api.get("/settings"), []);
  const orders = useLoad(() => api.get("/orders"), []);
  const selected = (intake.data?.items || []).find((item) => item.id === selectedId) || intake.data?.items?.[0] || null;

  useEffect(() => {
    if (!selected) return;
    setSelectedId(selected.id);
    setDraft({
      status: selected.status,
      customer_id: selected.customer_id || "",
      assigned_user_id: selected.assigned_user_id || "",
      follow_up_at: selected.follow_up_at || "",
      summary: selected.summary || "",
      internal_notes: selected.internal_notes || "",
    });
    setCustomerForm({
      contact_name: selected.source_message?.sender_name || selected.source_message?.sender_email || "",
      business_name: "",
      email: selected.source_message?.sender_email || "",
      phone: "",
    });
  }, [selected?.id]);

  async function refresh() {
    await intake.refresh();
    await orders.refresh();
    await customers.refresh();
  }

  async function save() {
    if (!selected) return;
    setAction({ busy: true, error: "", saved: "" });
    try {
      await api.patch(`/orders/intake/${selected.id}`, { ...draft, customer_id: draft.customer_id || null, assigned_user_id: draft.assigned_user_id || null, follow_up_at: draft.follow_up_at || null, internal_notes: draft.internal_notes || null });
      await refresh();
      setAction({ busy: false, error: "", saved: "Incoming request updated" });
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  async function createCustomer() {
    if (!selected) return;
    setAction({ busy: true, error: "", saved: "" });
    try {
      await api.post(`/orders/intake/${selected.id}/customer`, { ...customerForm, email: customerForm.email || null, phone: customerForm.phone || null });
      await refresh();
      setAction({ busy: false, error: "", saved: "Customer matched to incoming request" });
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  async function createDraftOrder() {
    if (!selected) return;
    setAction({ busy: true, error: "", saved: "" });
    try {
      const result = await api.post(`/orders/intake/${selected.id}/create-draft-order`, { customer_id: draft.customer_id || selected.customer_id || null, title: draft.summary || selected.summary });
      await refresh();
      setAction({ busy: false, error: "", saved: `Draft Order ${result.order.order_number} ready` });
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  async function linkOrder() {
    if (!selected || !linkOrderId) return;
    setAction({ busy: true, error: "", saved: "" });
    try {
      const result = await api.post(`/orders/intake/${selected.id}/link-order`, { order_id: linkOrderId });
      await refresh();
      setAction({ busy: false, error: "", saved: `Linked to ${result.order.order_number}` });
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  return (
    <TwoColumn wide>
      <section className="panel order-intake-list">
        <Toolbar title="Incoming Requests">
          <input placeholder="Search requests" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
          <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
            <option value="all">All</option>
            {Object.entries(INTAKE_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Toolbar>
        <div className="notice">Forward order-related email to the tenant intake address shown in Settings. Slim does not synchronize the shop mailbox.</div>
        {action.error && <div className="error-state">{action.error}</div>}
        {action.saved && <div className="success-state">{action.saved}</div>}
        <AsyncState state={intake} empty="No forwarded order emails">
          <div className="record-list">
            {(intake.data?.items || []).map((item) => (
              <button type="button" className={selected?.id === item.id ? "record-row selectable active" : "record-row selectable"} key={item.id} onClick={() => setSelectedId(item.id)}>
                <div><strong>{item.summary}</strong><span>{item.sender_email || item.source_message?.sender_email || "Email"} / {INTAKE_STATUS_LABELS[item.status]}</span></div>
                <span>{item.received_at ? formatDate(item.received_at) : ""}</span>
              </button>
            ))}
          </div>
        </AsyncState>
      </section>
      <section className="panel intake-detail">
        {!selected ? <div className="empty-state">Select an incoming request</div> : (
          <>
            <Toolbar title={selected.summary}>
              {selected.converted_order_id && <a href={`#/orders/${selected.converted_order_id}`}>Open Draft Order</a>}
              {selected.linked_order_id && <a href={`#/orders/${selected.linked_order_id}`}>Open Linked Order</a>}
            </Toolbar>
            <div className="source-message-card">
              <strong>{selected.source_message?.subject || selected.summary}</strong>
              <span>From {selected.source_message?.sender_name || selected.source_message?.sender_email}</span>
              <span>Received {selected.source_message?.received_at ? new Date(selected.source_message.received_at).toLocaleString() : ""}</span>
              <p>{selected.source_message?.text_body || "No plain text body was provided."}</p>
              <div className="compact-attachment-list">
                {(selected.attachments || []).length === 0 ? <span>No attachments</span> : selected.attachments.map((attachment) => (
                  <article className="compact-attachment" key={attachment.id}>
                    <strong>{attachment.original_filename}</strong>
                    <span>{attachment.mime_type} / {attachment.byte_size} bytes / {attachment.accepted ? "accepted" : attachment.rejection_reason}</span>
                  </article>
                ))}
              </div>
            </div>
            <div className="intake-control-grid">
              <SelectField label="Status" value={draft.status} onChange={(status) => setDraft({ ...draft, status })}>
                {Object.entries(INTAKE_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </SelectField>
              <SelectField label="Customer" value={draft.customer_id} onChange={(customer_id) => setDraft({ ...draft, customer_id })}>
                <option value="">Unmatched</option>
                {(customers.data?.items || []).map((customer) => <option key={customer.id} value={customer.id}>{customer.business_name || customer.contact_name}</option>)}
              </SelectField>
              <SelectField label="Assigned" value={draft.assigned_user_id} onChange={(assigned_user_id) => setDraft({ ...draft, assigned_user_id })}>
                <option value="">Unassigned</option>
                {(settings.data?.users || []).filter((user) => user.active).map((user) => <option key={user.id} value={user.id}>{user.display_name}</option>)}
              </SelectField>
              <Field label="Follow-up" type="date" value={draft.follow_up_at} onChange={(follow_up_at) => setDraft({ ...draft, follow_up_at })} />
              <Field label="Summary" value={draft.summary} onChange={(summary) => setDraft({ ...draft, summary })} />
              <Field label="Internal notes" value={draft.internal_notes} onChange={(internal_notes) => setDraft({ ...draft, internal_notes })} />
            </div>
            <div className="row-actions intake-actions">
              <button type="button" onClick={save} disabled={action.busy}><Save size={14} />Save Intake</button>
              <button type="button" onClick={createDraftOrder} disabled={action.busy || (!draft.customer_id && !selected.customer_id) || selected.converted_order_id || selected.linked_order_id}><ShoppingBag size={14} />Create Draft Order</button>
              <select aria-label="Existing Order" value={linkOrderId} onChange={(event) => setLinkOrderId(event.target.value)}>
                <option value="">Select existing Order</option>
                {(orders.data?.items || []).map((order) => <option value={order.id} key={order.id}>{order.order_number} / {order.customer_summary?.business_name || order.customer_summary?.contact_name}</option>)}
              </select>
              <button type="button" onClick={linkOrder} disabled={action.busy || !linkOrderId || selected.converted_order_id}><FileText size={14} />Link Order</button>
            </div>
            {!draft.customer_id && (
              <form className="inline-form intake-customer-create" onSubmit={(event) => { event.preventDefault(); createCustomer(); }}>
                <input placeholder="Contact name" value={customerForm.contact_name} onChange={(event) => setCustomerForm({ ...customerForm, contact_name: event.target.value })} />
                <input placeholder="Business" value={customerForm.business_name} onChange={(event) => setCustomerForm({ ...customerForm, business_name: event.target.value })} />
                <input placeholder="Email" type="email" value={customerForm.email} onChange={(event) => setCustomerForm({ ...customerForm, email: event.target.value })} />
                <input placeholder="Phone" value={customerForm.phone} onChange={(event) => setCustomerForm({ ...customerForm, phone: event.target.value })} />
                <button disabled={action.busy}><UserPlus size={14} />Create Customer</button>
              </form>
            )}
          </>
        )}
      </section>
    </TwoColumn>
  );
}

export {
  OrderIntakePage,
};
