import { useState } from "react";
import {
  Copy,
  Download,
  Save,
  ShoppingBag,
} from "lucide-react";
import { money } from "../../api.js";
import {
  BundleEditor,
  EmailAction,
} from "../orders/OrderWorkspace.jsx";
import {
  newQuickItem,
  useLoad,
  Toolbar,
  TwoColumn,
  AsyncState,
  RecordList,
  DocumentForm,
  documentPayload,
} from "../general/GeneralPages.jsx";

function EstimatesPage({ api }) {
  const customers = useLoad(() => api.get("/customers"), []);
  const settings = useLoad(() => api.get("/settings"), []);
  const estimates = useLoad(() => api.get("/estimates"), []);
  const [form, setForm] = useState({ customer_id: "", document_date: new Date().toISOString().slice(0, 10), expires_at: "", follow_up_at: "", status: "draft", discount: "0.00", internal_notes: "", items: [newQuickItem()] });
  const [editingId, setEditingId] = useState("");
  const [editingEstimate, setEditingEstimate] = useState(null);
  const [action, setAction] = useState({ busy: false, error: "" });
  async function save(event) {
    event.preventDefault();
    setAction({ busy: true, error: "" });
    try {
      if (editingId) await api.patch(`/estimates/${editingId}`, documentPayload(form));
      else await api.post("/estimates", documentPayload(form));
      setEditingId("");
      setEditingEstimate(null);
      estimates.refresh();
    } catch (err) {
      setAction({ busy: false, error: err.message, conflicts: err.conflicts || [] });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  async function edit(id) {
    setAction({ busy: true, error: "" });
    try {
      const estimate = await api.get(`/estimates/${id}`);
      setEditingId(id);
      setEditingEstimate(estimate);
      setForm({
        customer_id: estimate.customer_id,
        document_date: estimate.document_date,
        expires_at: estimate.expires_at || "",
        follow_up_at: estimate.follow_up_at || "",
        status: estimate.status,
        discount: String((estimate.discount_cents || 0) / 100),
        internal_notes: estimate.internal_notes || "",
        items: estimate.items.map((entry) => newQuickItem({
          id: entry.id,
          title: entry.title || entry.description,
          description: entry.description,
          quantity_decimal: entry.quantity_decimal,
          unit_price: String(entry.unit_price_cents / 100),
          taxable: entry.taxable,
          production_required: entry.production_required,
          due_date: entry.due_date || "",
          assigned_user_id: entry.assigned_user_id || "",
          internal_note: entry.internal_note || "",
        })),
      });
    } catch (err) {
      setAction({ busy: false, error: err.message, conflicts: err.conflicts || [] });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  async function convert(id) {
    setAction({ busy: true, error: "" });
    try {
      await api.post(`/estimates/${id}/convert`, {});
      estimates.refresh();
    } catch (err) {
      setAction({ busy: false, error: err.message });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  async function duplicate(id) {
    setAction({ busy: true, error: "" });
    try {
      await api.post(`/estimates/${id}/duplicate`, {});
      estimates.refresh();
    } catch (err) {
      setAction({ busy: false, error: err.message });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  async function downloadEstimate(id, number) {
    setAction({ busy: true, error: "" });
    try {
      await api.download(`/estimates/${id}/pdf`, `quote-${number}.pdf`);
    } catch (err) {
      setAction({ busy: false, error: err.message });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  return (
    <TwoColumn wide>
      <section className="panel">
        <Toolbar title="Quotes" />
        {action.error && <div className="error-state">{action.error}</div>}
        <AsyncState state={estimates} empty="No quotes found">
          <RecordList items={estimates.data?.items || []} primary="estimate_number" secondary={(item) => item.status} amount={(item) => money(item.total_cents)} actions={(item) => (
            <>
              <button disabled={action.busy} onClick={() => duplicate(item.id)}><Copy size={14} />Duplicate</button>
              <button disabled={action.busy} onClick={() => edit(item.id)}><Save size={14} />Edit</button>
              <button disabled={action.busy} onClick={() => convert(item.id)}><ShoppingBag size={14} />Convert</button>
              <EmailAction api={api} endpoint={`/estimates/${item.id}/send-email`} title={`Send ${item.estimate_number}`} defaultSubject={`Quote ${item.estimate_number}`} defaultBody="Please review the attached quote.">Email</EmailAction>
              <button disabled={action.busy} onClick={() => downloadEstimate(item.id, item.estimate_number)}><Download size={14} />PDF</button>
            </>
          )} />
        </AsyncState>
      </section>
      <div className="form-stack">
        <DocumentForm title={editingId ? "Edit Quote" : "Quote"} form={form} setForm={setForm} customers={customers.data?.items || []} users={settings.data?.users || []} onSubmit={save} submitLabel={editingId ? "Update Quote" : "Save Quote"} disabled={action.busy} includeEstimateStatus customerLocked={Boolean(editingId)} customerLockMessage="Quote customer is locked after creation." onNew={editingId ? () => { setEditingId(""); setEditingEstimate(null); setForm({ customer_id: "", document_date: new Date().toISOString().slice(0, 10), expires_at: "", follow_up_at: "", status: "draft", discount: "0.00", internal_notes: "", items: [newQuickItem()] }); } : null} />
        {editingId && editingEstimate && <BundleEditor api={api} documentType="estimate" documentId={editingId} items={editingEstimate.items || []} bundles={editingEstimate.bundles || []} locked={Boolean(editingEstimate.converted_order_id)} onSaved={async () => setEditingEstimate(await api.get(`/estimates/${editingId}`))} />}
      </div>
    </TwoColumn>
  );
}

export {
  EstimatesPage,
};
