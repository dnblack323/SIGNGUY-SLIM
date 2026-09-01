import {
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CalendarDays,
  Camera,
  CheckCircle2,
  Copy,
  Download,
  Eraser,
  FileText,
  Mail,
  MessageSquare,
  MousePointer2,
  PenLine,
  Plus,
  RotateCcw,
  Save,
  Square,
  SwitchCamera,
  Trash2,
  Type,
  Undo2,
  Redo2,
  Upload,
  UserPlus,
} from "lucide-react";
import {
  cents,
  money,
} from "../../api.js";
import {
  productionSetupPreview,
  progressParts,
  PRODUCTION_STAGES,
  STAGE_LABELS,
} from "../production/productionState.js";
import {
  blankAddress,
  ANNOTATION_COLORS,
  ANNOTATION_WIDTHS,
  isImageAttachment,
  safeAttachmentStem,
  timestampSlug,
  normalizePointer,
  pointToCanvas,
  drawAnnotationOperation,
  dateOnly,
  addDays,
  formatDate,
  clientSideId,
  newQuickItem,
  Field,
  AddressFields,
  SelectField,
  formatProgress,
  itemFromApi,
  useLoad,
  Toolbar,
  AsyncState,
  documentPayload,
} from "../general/GeneralPages.jsx";

function draftLineTotalCents(item) {
  return Math.round(cents(item.unit_price) * Number(item.quantity_decimal || 0));
}

function draftSubtotalCents(items) {
  return items.reduce((total, item) => total + draftLineTotalCents(item), 0);
}

function CustomerSummary({ customer, compact = false }) {
  if (!customer) return <div className="empty-state">Select a customer to show order customer information.</div>;
  const address = customer.billing_address || blankAddress;
  return (
    <section className={compact ? "customer-summary compact" : "workspace-section customer-summary"}>
      {!compact && <h3>Customer Summary</h3>}
      <span>{customer.contact_name}</span>
      <span>{customer.business_name || "No business name"}</span>
      <span>{customer.tax_exempt ? "Tax exempt" : "Taxable"}</span>
      {customer.email ? <a href={`mailto:${customer.email}`}>{customer.email}</a> : <span>No email</span>}
      {customer.phone ? <a href={`tel:${customer.phone}`}>{customer.phone}</a> : <span>No phone</span>}
      <span>{address.line1 ? `${address.line1}, ${address.city}, ${address.state} ${address.postal_code}` : "No billing address"}</span>
    </section>
  );
}

function EmailComposerModal({ api, endpoint, title, defaultSubject, defaultBody, defaultTo = "", savedCustomerEmail = "", onClose, onSent }) {
  const [form, setForm] = useState({ to_email: defaultTo || savedCustomerEmail || "", cc: "", subject: defaultSubject || "", body_text: defaultBody || "", attach_document: true });
  const [action, setAction] = useState({ busy: false, error: "", saved: "" });
  async function send(event) {
    event.preventDefault();
    setAction({ busy: true, error: "", saved: "" });
    try {
      const to = form.to_email.trim();
      const saved = savedCustomerEmail.trim().toLowerCase();
      await api.post(endpoint, {
        idempotency_key: `${Date.now()}-${clientSideId()}`,
        to_email: to || undefined,
        cc: form.cc.split(",").map((email) => email.trim()).filter(Boolean),
        subject: form.subject,
        body_text: form.body_text,
        attach_document: form.attach_document,
        confirm_unsaved_recipient: Boolean(saved && to && saved !== to.toLowerCase()),
      });
      setAction({ busy: false, error: "", saved: "Email accepted by SendGrid" });
      onSent?.();
      window.setTimeout(onClose, 350);
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }
  return (
    <div className="modal-scrim">
      <form className="modal-card email-composer" onSubmit={send} role="dialog" aria-modal="true" aria-label={title}>
        <Toolbar title={title}><button type="button" onClick={onClose}>Close</button></Toolbar>
        {action.error && <div className="error-state">{action.error}</div>}
        {action.saved && <div className="success-state">{action.saved}</div>}
        <Field label="To" type="email" value={form.to_email} onChange={(to_email) => setForm({ ...form, to_email })} />
        <Field label="CC" value={form.cc} onChange={(cc) => setForm({ ...form, cc })} />
        <Field label="Subject" value={form.subject} onChange={(subject) => setForm({ ...form, subject })} />
        <label className="text-area-field"><span>Message</span><textarea value={form.body_text} onChange={(event) => setForm({ ...form, body_text: event.target.value })} /></label>
        <label className="check-row"><input type="checkbox" checked={form.attach_document} onChange={(event) => setForm({ ...form, attach_document: event.target.checked })} />Attach document when available</label>
        <button className="primary-button" disabled={action.busy}><Mail size={16} />Send</button>
      </form>
    </div>
  );
}

function EmailAction({ api, endpoint, title, defaultSubject, defaultBody, children }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}><Mail size={14} />{children || "Email"}</button>
      {open && <EmailComposerModal api={api} endpoint={endpoint} title={title} defaultSubject={defaultSubject} defaultBody={defaultBody} onClose={() => setOpen(false)} />}
    </>
  );
}

function CommunicationPanel({ api, customerId, relatedEntityType = "customer", relatedEntityId = "", savedCustomerEmail = "", onEmail }) {
  const query = relatedEntityId
    ? `/communications?customer_id=${encodeURIComponent(customerId)}&related_entity_type=${encodeURIComponent(relatedEntityType)}&related_entity_id=${encodeURIComponent(relatedEntityId)}`
    : `/communications?customer_id=${encodeURIComponent(customerId)}`;
  const state = useLoad(() => customerId ? api.get(query) : Promise.resolve({ items: [] }), [customerId, relatedEntityType, relatedEntityId]);
  const [form, setForm] = useState({ channel: "phone", direction: "inbound", subject: "", body_text: "" });
  const [action, setAction] = useState({ busy: false, error: "", saved: "" });
  async function save(event) {
    event.preventDefault();
    if (!customerId) return;
    setAction({ busy: true, error: "", saved: "" });
    try {
      await api.post("/communications", {
        customer_id: customerId,
        ...form,
        subject: form.subject || null,
        related_entity_type: relatedEntityType,
        related_entity_id: relatedEntityId || customerId,
      });
      setForm({ channel: "phone", direction: "inbound", subject: "", body_text: "" });
      state.refresh();
      setAction({ busy: false, error: "", saved: "Communication note added" });
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }
  return (
    <section className="workspace-card communication-panel" data-region="communications">
      <Toolbar title="Communication Activity">
        {onEmail && <button type="button" onClick={onEmail}><Mail size={14} />Email Customer</button>}
      </Toolbar>
      {savedCustomerEmail && <span className="muted-copy">Customer email: {savedCustomerEmail}</span>}
      {action.error && <div className="error-state">{action.error}</div>}
      {action.saved && <div className="success-state">{action.saved}</div>}
      <form className="compact-note-form" onSubmit={save}>
        <select aria-label="Communication channel" value={form.channel} onChange={(event) => setForm({ ...form, channel: event.target.value })}>
          <option value="phone">Phone</option>
          <option value="walk_in">Walk-in</option>
          <option value="email">External email</option>
          <option value="manual">Manual</option>
        </select>
        <select aria-label="Direction" value={form.direction} onChange={(event) => setForm({ ...form, direction: event.target.value })}>
          <option value="inbound">Inbound</option>
          <option value="outbound">Outbound</option>
          <option value="internal">Internal</option>
        </select>
        <input placeholder="Summary" value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} />
        <textarea placeholder="Note" value={form.body_text} onChange={(event) => setForm({ ...form, body_text: event.target.value })} />
        <button disabled={action.busy}><MessageSquare size={14} />Add Note</button>
      </form>
      <AsyncState state={state} empty="No communication activity">
        <div className="timeline-list">
          {(state.data?.items || []).map((entry) => (
            <article className="timeline-entry" key={entry.id}>
              <strong>{entry.summary}</strong>
              <span>{entry.channel.replace("_", " ")} / {entry.direction}{entry.delivery_state ? ` / ${entry.delivery_state}` : ""}</span>
              {entry.subject && <span>{entry.subject}</span>}
              <small>{new Date(entry.created_at).toLocaleString()}</small>
            </article>
          ))}
        </div>
      </AsyncState>
    </section>
  );
}

function saveStateText(action, dirty, fallback = "Saved") {
  if (action.busy) return "Saving";
  if (action.error) return "Save Failed";
  if (action.saved) return action.saved;
  return dirty ? "Unsaved" : fallback;
}

function OrderWorkspaceShell({ label, title, status, customerName, dueDate, total, progress, saveState, children, formRef, onSubmit }) {
  return (
    <div className="workspace-overlay" aria-label="Order Workspace backdrop">
      <form className="order-workspace command-center" role="dialog" aria-modal="true" aria-label={label} tabIndex="-1" ref={formRef} onSubmit={onSubmit}>
        <header className="workspace-header compact-workspace-header" data-region="workspace-header">
          <div>
            <h2>{title}</h2>
          </div>
          <span className="status-chip">{status}</span>
          <span><strong>Customer</strong>{customerName || "Not selected"}</span>
          <span><strong>Due</strong>{dueDate || "None"}</span>
          <span><strong>Total</strong>{total}</span>
          <span><strong>Production</strong>{formatProgress(progress)}</span>
          <span><strong>Save</strong>{saveState}</span>
        </header>
        {children}
      </form>
    </div>
  );
}

function OrderSummaryCard({ order, form, invoice = null, progress }) {
  const liveSubtotal = draftSubtotalCents(form.items || []);
  const discount = cents(form.discount || "0");
  const summaryProgress = progressParts(progress, form.items || []);
  return (
    <section className="workspace-card order-summary-region" data-region="order-summary">
      <h3>Order Summary</h3>
      <div className="summary-lines">
        <span>Subtotal <strong>{order ? money(order.subtotal_cents) : money(liveSubtotal)}</strong></span>
        <span>Discount <strong>{order ? money(order.discount_cents) : money(discount)}</strong></span>
        <span>Tax <strong>{order ? money(order.tax_cents) : "On save"}</strong></span>
        <span className="grand-total">Total <strong>{order ? money(order.total_cents) : "On save"}</strong></span>
        <span>Invoice <strong>{invoice?.document_status || "No invoice"}</strong></span>
        <span>Payment <strong>{invoice?.payment_status || "No payment"}</strong></span>
        <span>Production <strong>{formatProgress(summaryProgress)}</strong></span>
        <span>Items <strong>{summaryProgress.completed}/{summaryProgress.total} complete</strong></span>
      </div>
    </section>
  );
}

function CameraCaptureOverlay({ orderNumber, busy, onUsePhoto, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState("");
  const [devices, setDevices] = useState([]);
  const [deviceIndex, setDeviceIndex] = useState(0);
  const [captured, setCaptured] = useState(null);
  const [starting, setStarting] = useState(false);

  function stopCamera() {
    streamRef.current?.getTracks?.().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  async function startCamera(index = deviceIndex) {
    stopCamera();
    setCaptured((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return null;
    });
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera capture is not supported in this browser. Use file upload instead.");
      return;
    }
    if (window.isSecureContext === false && !["localhost", "127.0.0.1"].includes(window.location.hostname)) {
      setError("Camera capture requires a secure browser context. Use file upload instead.");
      return;
    }
    setStarting(true);
    setError("");
    try {
      const selected = devices[index];
      const stream = await navigator.mediaDevices.getUserMedia({
        video: selected?.deviceId ? { deviceId: { exact: selected.deviceId } } : { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play?.();
      }
      const available = await navigator.mediaDevices.enumerateDevices?.().catch(() => []);
      const cameras = (available || []).filter((device) => device.kind === "videoinput");
      if (cameras.length) setDevices(cameras);
    } catch (err) {
      const code = err?.name || err?.message || "camera_error";
      if (code === "NotAllowedError" || code === "PermissionDeniedError") setError("Camera permission was denied. File upload remains available.");
      else if (code === "NotFoundError" || code === "DevicesNotFoundError") setError("No camera was found on this device. Use file upload instead.");
      else if (code === "NotReadableError" || code === "TrackStartError") setError("The camera is already in use or unavailable. Use file upload instead.");
      else setError("Camera capture failed. Use file upload instead.");
    } finally {
      setStarting(false);
    }
  }

  useEffect(() => {
    startCamera(0);
    return () => {
      stopCamera();
      setCaptured((current) => {
        if (current?.url) URL.revokeObjectURL(current.url);
        return null;
      });
    };
  }, []);

  async function switchCamera() {
    if (devices.length < 2) return;
    const next = (deviceIndex + 1) % devices.length;
    setDeviceIndex(next);
    await startCamera(next);
  }

  function capturePhoto() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return setError("Camera capture failed. Use file upload instead.");
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return setError("Camera capture failed. Use file upload instead.");
    ctx.drawImage(video, 0, 0, width, height);
    canvas.toBlob((blob) => {
      if (!blob) {
        setError("Camera capture failed. Use file upload instead.");
        return;
      }
      stopCamera();
      const url = URL.createObjectURL(blob);
      setCaptured({ blob, url, filename: `${orderNumber || "order"}-capture-${timestampSlug()}.jpg` });
    }, "image/jpeg", 0.95);
    return undefined;
  }

  function close() {
    stopCamera();
    setCaptured((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return null;
    });
    onClose();
  }

  async function usePhoto() {
    if (!captured) return;
    await onUsePhoto(captured.blob, captured.filename);
    if (captured.url) URL.revokeObjectURL(captured.url);
  }

  return (
    <div className="media-workspace-overlay" role="dialog" aria-modal="true" aria-label="Capture Photo">
      <div className="media-workspace camera-workspace">
        <Toolbar title="Capture Photo">
          {devices.length > 1 && <button type="button" onClick={switchCamera} disabled={starting || busy} title="Switch camera"><SwitchCamera size={16} />Switch</button>}
          <button type="button" onClick={close} disabled={busy}>Cancel</button>
        </Toolbar>
        {error && <div className="error-state">{error}</div>}
        {!captured ? (
          <div className="camera-panel">
            <video ref={videoRef} autoPlay playsInline muted aria-label="Camera preview" />
            <canvas ref={canvasRef} hidden />
            <div className="media-actions">
              <button type="button" className="primary-button" onClick={capturePhoto} disabled={starting || busy || Boolean(error)}><Camera size={16} />Capture</button>
              <button type="button" onClick={close} disabled={busy}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="camera-panel">
            <img src={captured.url} alt="Captured preview" />
            <div className="media-actions">
              <button type="button" onClick={() => startCamera(deviceIndex)} disabled={busy}><RotateCcw size={16} />Retake</button>
              <button type="button" className="primary-button" onClick={usePhoto} disabled={busy}><CheckCircle2 size={16} />Use Photo</button>
              <button type="button" onClick={close} disabled={busy}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AnnotationWorkspace({ attachment, imageUrl, busy, onSave, onClose }) {
  const canvasRef = useRef(null);
  const imageRef = useRef(null);
  const drawingRef = useRef(null);
  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState(ANNOTATION_COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [text, setText] = useState("Label");
  const [operations, setOperations] = useState([]);
  const [redo, setRedo] = useState([]);
  const [draft, setDraft] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");

  const unsaved = operations.length > 0;

  function redraw(nextOps = operations, nextDraft = draft) {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image?.naturalWidth) return;
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    nextOps.forEach((op) => drawAnnotationOperation(ctx, canvas, op));
    if (nextDraft) drawAnnotationOperation(ctx, canvas, nextDraft);
    if (selectedId) {
      const selected = nextOps.find((op) => op.id === selectedId);
      if (selected) {
        ctx.save();
        ctx.strokeStyle = "#111827";
        ctx.setLineDash([6, 4]);
        const points = annotationPoints(selected).map((point) => pointToCanvas(point, canvas));
        const xs = points.map((point) => point.x);
        const ys = points.map((point) => point.y);
        ctx.strokeRect(Math.min(...xs) - 8, Math.min(...ys) - 8, Math.max(...xs) - Math.min(...xs) + 16, Math.max(...ys) - Math.min(...ys) + 16);
        ctx.restore();
      }
    }
  }

  useEffect(() => {
    redraw();
  }, [operations, draft, selectedId]);

  useEffect(() => {
    const beforeUnload = (event) => {
      if (!unsaved) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [unsaved]);

  function commit(op) {
    setOperations((current) => [...current, op]);
    setRedo([]);
    setDraft(null);
    setSelectedId("");
  }

  function startDraw(event) {
    if (busy) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const point = normalizePointer(event, canvas);
    if (tool === "select") {
      const hit = [...operations].reverse().find((op) => annotationHit(op, point));
      setSelectedId(hit?.id || "");
      return;
    }
    if (tool === "text") {
      commit({ id: clientSideId(), type: "text", color, stroke_width: strokeWidth, point, text: text || "Label" });
      return;
    }
    const next = tool === "pen"
      ? { id: clientSideId(), type: "pen", color, stroke_width: strokeWidth, points: [point] }
      : { id: clientSideId(), type: tool, color, stroke_width: strokeWidth, start: point, end: point };
    drawingRef.current = next;
    setDraft(next);
    canvas.setPointerCapture?.(event.pointerId);
  }

  function moveDraw(event) {
    const current = drawingRef.current;
    const canvas = canvasRef.current;
    if (!current || !canvas) return;
    const point = normalizePointer(event, canvas);
    const next = current.type === "pen" ? { ...current, points: [...current.points, point] } : { ...current, end: point };
    drawingRef.current = next;
    setDraft(next);
  }

  function endDraw(event) {
    const current = drawingRef.current;
    if (!current) return;
    drawingRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (current.type === "pen" && current.points.length < 2) {
      setDraft(null);
      return;
    }
    commit(current);
  }

  function undo() {
    setOperations((current) => {
      if (!current.length) return current;
      const next = current.slice(0, -1);
      setRedo((redoOps) => [current.at(-1), ...redoOps]);
      return next;
    });
    setSelectedId("");
  }

  function redoOne() {
    setRedo((current) => {
      if (!current.length) return current;
      const [first, ...rest] = current;
      setOperations((ops) => [...ops, first]);
      return rest;
    });
  }

  function clearAll() {
    if (!operations.length || !window.confirm("Clear all annotations?")) return;
    setRedo([...operations, ...redo]);
    setOperations([]);
    setSelectedId("");
  }

  function deleteSelected() {
    if (!selectedId) return;
    setOperations((current) => {
      const selected = current.find((op) => op.id === selectedId);
      if (selected) setRedo((redoOps) => [selected, ...redoOps]);
      return current.filter((op) => op.id !== selectedId);
    });
    setSelectedId("");
  }

  function cancel() {
    if (unsaved && !window.confirm("Discard unsaved annotation work?")) return;
    onClose();
  }

  async function save() {
    if (!operations.length) {
      setError("Add an annotation before saving.");
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob(async (blob) => {
      if (!blob) {
        setError("Could not render annotated image.");
        return;
      }
      const filename = `${safeAttachmentStem(attachment.original_filename)}-annotated-${timestampSlug()}.png`;
      try {
        await onSave(new File([blob], filename, { type: "image/png" }), operations);
      } catch (err) {
        setError(err.message);
      }
    }, "image/png");
  }

  return (
    <div className="media-workspace-overlay" role="dialog" aria-modal="true" aria-label={`Annotate ${attachment.original_filename}`}>
      <div className="media-workspace annotation-workspace">
        <Toolbar title={`Annotate ${attachment.original_filename}`}>
          <button type="button" onClick={cancel} disabled={busy}>Cancel</button>
          <button type="button" className="primary-button" onClick={save} disabled={busy || !operations.length}><Save size={16} />Save Annotated Copy</button>
        </Toolbar>
        {error && <div className="error-state">{error}</div>}
        <div className="annotation-toolbar" aria-label="Annotation tools">
          {[
            ["select", MousePointer2, "Select"],
            ["pen", PenLine, "Pen"],
            ["arrow", ArrowRight, "Arrow"],
            ["rectangle", Square, "Rectangle"],
            ["text", Type, "Text"],
          ].map(([value, Icon, label]) => (
            <button key={value} type="button" className={tool === value ? "active" : ""} onClick={() => setTool(value)} title={label} aria-pressed={tool === value}><Icon size={16} />{label}</button>
          ))}
          <label>Color<select className="visually-hidden" aria-label="Annotation color" value={color} onChange={(event) => setColor(event.target.value)}>{ANNOTATION_COLORS.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
          <div className="annotation-swatches">{ANNOTATION_COLORS.map((entry) => <button key={entry} type="button" className={color === entry ? "active swatch" : "swatch"} style={{ "--swatch": entry }} title={entry} aria-label={`Use ${entry}`} onClick={() => setColor(entry)} />)}</div>
          <label>Stroke<select aria-label="Stroke width" value={strokeWidth} onChange={(event) => setStrokeWidth(Number(event.target.value))}>{ANNOTATION_WIDTHS.map((width) => <option key={width} value={width}>{width}px</option>)}</select></label>
          <label>Text<input aria-label="Text label" value={text} onChange={(event) => setText(event.target.value)} maxLength={160} /></label>
          <button type="button" onClick={undo} disabled={!operations.length} title="Undo"><Undo2 size={16} />Undo</button>
          <button type="button" onClick={redoOne} disabled={!redo.length} title="Redo"><Redo2 size={16} />Redo</button>
          <button type="button" onClick={deleteSelected} disabled={!selectedId} title="Delete selected"><Trash2 size={16} />Delete</button>
          <button type="button" onClick={clearAll} disabled={!operations.length} title="Clear all"><Eraser size={16} />Clear</button>
        </div>
        <div className="annotation-canvas-wrap">
          <img ref={imageRef} src={imageUrl} alt="" onLoad={() => redraw()} />
          <canvas
            ref={canvasRef}
            aria-label="Annotation canvas"
            onPointerDown={startDraw}
            onPointerMove={moveDraw}
            onPointerUp={endDraw}
            onPointerCancel={endDraw}
          />
        </div>
      </div>
    </div>
  );
}

function annotationPoints(op) {
  if (op.type === "pen") return op.points;
  if (op.type === "text") return [op.point];
  return [op.start, op.end];
}

function annotationHit(op, point) {
  const points = annotationPoints(op);
  const minX = Math.min(...points.map((entry) => entry.x)) - 0.03;
  const maxX = Math.max(...points.map((entry) => entry.x)) + 0.03;
  const minY = Math.min(...points.map((entry) => entry.y)) - 0.03;
  const maxY = Math.max(...points.map((entry) => entry.y)) + 0.03;
  return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
}

function OperationalStatusRail({ order, form, attachments = [], preview = null, onUpload, onCapture, onAnnotate, onOpenOriginal, onPreview, onDownload, onDelete, onClosePreview }) {
  const progress = progressParts(order?.production_progress, form.items || []);
  const stageSummary = PRODUCTION_STAGES
    .map((stage) => ({ stage, count: (form.items || []).filter((item) => item.production_required && (item.production_stage || "not_started") === stage).length }))
    .filter((entry) => entry.count);
  const assigned = (form.items || []).filter((item) => item.assigned_user_id).length;
  return (
    <aside className="operational-status-region" data-region="operational-status">
      <section className="workspace-card mini-status-card">
        <h3>Production</h3>
        <span>Required <strong>{progress.total}</strong></span>
        <span>Completed <strong>{progress.completed}</strong></span>
        <span>Assigned <strong>{assigned}</strong></span>
        <span>Stages <strong>{stageSummary.length ? stageSummary.map((entry) => `${STAGE_LABELS[entry.stage]} ${entry.count}`).join(", ") : "None"}</strong></span>
      </section>
      <section className="workspace-card mini-status-card">
        <h3>Artwork & Files</h3>
        <span>Attachments <strong>{attachments.length}</strong></span>
        <div className="row-actions attachment-primary-actions">
          <button type="button" onClick={onUpload}><Upload size={14} />Upload File</button>
          <button type="button" onClick={onCapture}><Camera size={14} />Capture Photo</button>
        </div>
        <div className="compact-attachment-list">
          {attachments.length === 0 ? <span>No attachments</span> : attachments.map((attachment) => (
            <article className="compact-attachment" key={attachment.id}>
              <strong>{attachment.original_filename}</strong>
              <span className={attachment.source_type === "annotation_derivative" ? "attachment-kind annotated" : "attachment-kind"}>{attachment.source_type === "annotation_derivative" ? "Annotated" : "Original"}{attachment.source_type === "device_capture" ? " / Captured" : ""}</span>
              <span>{attachment.mime_type} / {attachment.byte_size} bytes</span>
              {attachment.image_width && attachment.image_height && <span>{attachment.image_width} x {attachment.image_height}</span>}
              <div className="row-actions">
                {attachment.previewable && <button type="button" onClick={() => onPreview?.(attachment)}>Preview</button>}
                {isImageAttachment(attachment) && <button type="button" onClick={() => onAnnotate?.(attachment)}><PenLine size={14} />Annotate</button>}
                {attachment.original_attachment_id && <button type="button" onClick={() => onOpenOriginal?.(attachment)}><FileText size={14} />Original</button>}
                <button type="button" onClick={() => onDownload?.(attachment)}><Download size={14} />Download</button>
                <button type="button" onClick={() => onDelete?.(attachment)}><Trash2 size={14} />Delete</button>
              </div>
            </article>
          ))}
        </div>
        {preview && <div className="attachment-preview compact-preview">
          <Toolbar title={preview.name}><button type="button" onClick={onClosePreview}>Close Preview</button></Toolbar>
          {preview.mime_type.startsWith("image/") ? <img src={preview.url} alt={preview.name} /> : <iframe title={preview.name} src={preview.url} sandbox="" />}
        </div>}
      </section>
      <section className="workspace-card mini-status-card">
        <h3>Schedule</h3>
        <span>{order?.due_date ? `Due ${formatDate(order.due_date)}` : "Unscheduled"}</span>
      </section>
      <section className="workspace-card mini-status-card">
        <h3>Invoice</h3>
        <span>{order?.invoice?.invoice_number || "No invoice"}</span>
        <span>{order?.invoice?.payment_status || "No payment status"}</span>
      </section>
    </aside>
  );
}

function WorkspaceOrderInfoCard({ form, onUpdate, invoiced = false }) {
  return (
    <section className="workspace-card order-info-region" data-region="order-info">
      <h3>Order Info</h3>
      <Field label="Order title" value={form.title || ""} onChange={(title) => onUpdate({ title })} />
      <Field label="Document date" type="date" value={form.document_date} onChange={(document_date) => onUpdate({ document_date })} />
      <Field label="Due date" type="date" value={form.due_date} onChange={(due_date) => onUpdate({ due_date })} />
      <SelectField label="Order status" value={form.status} onChange={(status) => onUpdate({ status })}>
        {["draft", "active", "on_hold", "complete", "cancelled"].map((status) => <option key={status}>{status}</option>)}
      </SelectField>
      <Field label="Discount" value={form.discount} disabled={invoiced} onChange={(discount) => onUpdate({ discount })} />
      <Field label="Internal notes" value={form.internal_notes} onChange={(internal_notes) => onUpdate({ internal_notes })} />
    </section>
  );
}

function WorkspaceCustomerCard({ api, customers = [], selectedCustomer, customerId, onCustomer, allowInlineCreate = false }) {
  return (
    <section className="workspace-card customer-info-region" data-region="customer-info">
      <h3>Customer</h3>
      <SelectField label="Customer" value={customerId} onChange={onCustomer}>
        <option value="">Select customer</option>
        {customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.business_name || customer.contact_name}</option>)}
      </SelectField>
      {allowInlineCreate && (
        <InlineCustomerCreator api={api} onCreated={(customer) => onCustomer(customer.id, customer)} />
      )}
      <CustomerSummary customer={selectedCustomer} compact />
    </section>
  );
}

function OrderItemsTable({ items, users = [], invoiced = false, onItemChange, onMove, onDuplicate, onRemove }) {
  const activeUsers = users.filter((user) => user.active !== false);
  return (
    <section className="workspace-card order-items-region" data-region="order-items">
      <h3>Order Items</h3>
      <div className="workspace-item-table" role="table" aria-label="Order items">
        <div className="workspace-item-row workspace-item-head" role="row">
          <span>Title</span>
          <span>Description</span>
          <span>Qty</span>
          <span>Unit</span>
          <span>Line</span>
          <span>Tax</span>
          <span>Prod</span>
          <span>Due</span>
          <span>Assigned</span>
          <span>Status</span>
          <span>Source</span>
          <span>Note</span>
          <span>Actions</span>
        </div>
        {items.map((item, index) => (
          <div className="workspace-item-row" role="row" key={item.client_id}>
            <input aria-label="Item title" value={item.title || ""} disabled={invoiced} onChange={(event) => onItemChange(index, { title: event.target.value })} />
            <input aria-label="Description" value={item.description} disabled={invoiced} onChange={(event) => onItemChange(index, { description: event.target.value })} />
            <input aria-label="Qty" value={item.quantity_decimal} disabled={invoiced} onChange={(event) => onItemChange(index, { quantity_decimal: event.target.value })} />
            <input aria-label="Unit price" value={item.unit_price} disabled={invoiced} onChange={(event) => onItemChange(index, { unit_price: event.target.value })} />
            <span className="line-total">{money(draftLineTotalCents(item))}</span>
            <label className="icon-check" title="Taxable"><input aria-label="Taxable" type="checkbox" checked={item.taxable} disabled={invoiced} onChange={(event) => onItemChange(index, { taxable: event.target.checked })} /></label>
            <label className="icon-check" title="Production"><input aria-label="Production" type="checkbox" checked={item.production_required} onChange={(event) => onItemChange(index, { production_required: event.target.checked })} /></label>
            <input aria-label="Due date" type="date" value={item.due_date} onChange={(event) => onItemChange(index, { due_date: event.target.value })} />
            <select aria-label="Assigned user" value={item.assigned_user_id} onChange={(event) => onItemChange(index, { assigned_user_id: event.target.value })}>
              <option value="">Unassigned</option>
              {activeUsers.map((user) => <option value={user.id} key={user.id}>{user.display_name}</option>)}
            </select>
            <span className="production-status-cell">{STAGE_LABELS[item.production_stage || "not_started"] || "Not Started"}</span>
            <span className="production-status-cell">{item.production_state_source === "work_order" ? item.current_work_order_number || "Work Order" : item.production_required ? "Unreleased" : "None"}</span>
            <input aria-label="Item note" value={item.internal_note} onChange={(event) => onItemChange(index, { internal_note: event.target.value })} />
            <div className="item-actions compact-item-actions">
              {!invoiced && <>
                <button type="button" title="Move up" onClick={() => onMove(index, -1)}><ArrowUp size={14} /></button>
                <button type="button" title="Move down" onClick={() => onMove(index, 1)}><ArrowDown size={14} /></button>
                <button type="button" title="Duplicate" onClick={() => onDuplicate(index)}><Copy size={14} /></button>
                <button type="button" title="Remove" onClick={() => onRemove(index)}><Trash2 size={14} /></button>
              </>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProductionSetupCard({ api, order = null, items = [], dirty = false, onDone }) {
  const productionItems = items.filter((item) => item.production_required);
  const [mode, setMode] = useState(order?.production_grouping_mode || "whole_order");
  const [groups, setGroups] = useState([{ client_id: clientSideId(), title: "Main Production Group" }]);
  const [assignments, setAssignments] = useState({});
  const [reason, setReason] = useState("");
  const [action, setAction] = useState({ busy: false, error: "", saved: "" });
  const submitInFlight = useRef(false);
  const released = Boolean(order?.sent_to_production_at || order?.work_orders?.length);
  const preview = productionSetupPreview(mode, productionItems, groups, assignments);
  const unassigned = mode === "custom_groups"
    ? productionItems.filter((item) => !assignments[item.id || item.client_id])
    : [];
  const canSend = order && !dirty && productionItems.length > 0 && (mode !== "custom_groups" || unassigned.length === 0) && preview.length > 0;

  async function submit() {
    if (!canSend || submitInFlight.current) return;
    submitInFlight.current = true;
    setAction({ busy: true, error: "", saved: "" });
    const payload = { mode };
    if (mode === "custom_groups") {
      payload.groups = groups.map((group) => ({
        title: group.title,
        item_ids: productionItems.filter((item) => assignments[item.id || item.client_id] === group.client_id).map((item) => item.id),
      })).filter((group) => group.item_ids.length);
      payload.independent_item_ids = productionItems.filter((item) => assignments[item.id || item.client_id] === "independent").map((item) => item.id);
    }
    if (released) {
      payload.reason = reason;
      payload.calendar_resolution = "return_to_order";
    }
    try {
      await api.post(`/orders/${order.id}/production/${released ? "regroup" : "send"}`, payload);
      setAction({ busy: false, error: "", saved: released ? "Regrouped" : "Sent to production" });
      onDone?.();
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    } finally {
      submitInFlight.current = false;
    }
  }

  return (
    <section className="workspace-card production-setup-region" data-region="production-setup">
      <h3>Production Setup</h3>
      {action.error && <div className="error-state">{action.error}</div>}
      {action.saved && <div className="success-state">{action.saved}</div>}
      <p className="muted-copy">How should this Order move through production?</p>
      <div className="segmented-options" role="radiogroup" aria-label="Production grouping mode">
        {[
          ["whole_order", "Keep the entire Order together"],
          ["individual_items", "Track every Order Item separately"],
          ["custom_groups", "Create custom production groups"],
        ].map(([value, label]) => (
          <button type="button" className={mode === value ? "active" : ""} key={value} onClick={() => setMode(value)}>{label}</button>
        ))}
      </div>
      {mode === "custom_groups" && (
        <div className="production-group-builder">
          <div className="row-actions">
            <button type="button" onClick={() => setGroups([...groups, { client_id: clientSideId(), title: "New Group" }])}><Plus size={14} />Group</button>
          </div>
          {groups.map((group) => (
            <div className="group-editor-row" key={group.client_id}>
              <Field label="Group name" value={group.title} onChange={(title) => setGroups(groups.map((entry) => entry.client_id === group.client_id ? { ...entry, title } : entry))} />
              <button type="button" disabled={Object.values(assignments).includes(group.client_id)} onClick={() => setGroups(groups.filter((entry) => entry.client_id !== group.client_id))}><Trash2 size={14} />Remove</button>
            </div>
          ))}
          {productionItems.map((item) => (
            <div className="assignment-row" key={item.id || item.client_id}>
              <strong>{item.title || item.description}</strong>
              <select aria-label={`Production group for ${item.title || item.description}`} value={assignments[item.id || item.client_id] || ""} onChange={(event) => setAssignments({ ...assignments, [item.id || item.client_id]: event.target.value })}>
                <option value="">Unassigned</option>
                <option value="independent">Leave independent</option>
                {groups.map((group) => <option value={group.client_id} key={group.client_id}>{group.title}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
      {unassigned.length > 0 && <div className="notice">{unassigned.length} production item{unassigned.length === 1 ? "" : "s"} still need assignment.</div>}
      <div className="work-order-preview">
        <strong>{preview.length} Work Order{preview.length === 1 ? "" : "s"} will be created</strong>
        {preview.map((entry, index) => <span key={`${entry.title}-${index}`}>Work Order {index + 1} - {entry.title} - {entry.count} item{entry.count === 1 ? "" : "s"}</span>)}
        {items.filter((item) => !item.production_required).map((item) => <span key={item.id || item.client_id}>Excluded - {item.title || item.description}</span>)}
      </div>
      {released && <Field label="Regroup reason" value={reason} onChange={setReason} />}
      <button type="button" className="primary-button" disabled={!canSend || action.busy} onClick={submit}>{released ? "Regroup Work Orders" : "Send to Production"}</button>
      {!order && <div className="notice">Save the draft before sending it to production.</div>}
      {dirty && order && <div className="notice">Save Order changes before sending or regrouping production.</div>}
    </section>
  );
}

function BundleEditor({ api, documentType, documentId, items = [], bundles = [], locked = false, onSaved }) {
  const [drafts, setDrafts] = useState(() => bundles.length ? bundles.map((bundle) => ({
    client_id: bundle.id || clientSideId(),
    title: bundle.title,
    description: bundle.description || "",
    pricing_mode: bundle.pricing_mode,
    manual_total: bundle.manual_total_cents ? String(bundle.manual_total_cents / 100) : "",
    override_reason: bundle.override_reason || "",
    show_member_prices: bundle.show_member_prices !== false,
    item_ids: (bundle.items || []).map((item) => item.id),
  })) : []);
  const [action, setAction] = useState({ busy: false, error: "", saved: "" });
  useEffect(() => {
    setDrafts(bundles.length ? bundles.map((bundle) => ({
      client_id: bundle.id || clientSideId(),
      title: bundle.title,
      description: bundle.description || "",
      pricing_mode: bundle.pricing_mode,
      manual_total: bundle.manual_total_cents ? String(bundle.manual_total_cents / 100) : "",
      override_reason: bundle.override_reason || "",
      show_member_prices: bundle.show_member_prices !== false,
      item_ids: (bundle.items || []).map((item) => item.id),
    })) : []);
  }, [documentId, bundles.length]);
  function update(index, changes) {
    setDrafts(drafts.map((bundle, i) => i === index ? { ...bundle, ...changes } : bundle));
  }
  async function save() {
    if (!documentId || locked) return;
    setAction({ busy: true, error: "", saved: "" });
    try {
      const payload = {
        bundles: drafts.map((bundle, index) => ({
          title: bundle.title,
          description: bundle.description || null,
          display_order: index,
          pricing_mode: bundle.pricing_mode,
          manual_total_cents: bundle.pricing_mode === "bundle_price" ? cents(bundle.manual_total) : null,
          override_reason: bundle.override_reason || null,
          show_member_prices: bundle.show_member_prices,
          item_ids: bundle.item_ids,
        })),
      };
      await api.put(`/${documentType}s/${documentId}/bundles`, payload);
      setAction({ busy: false, error: "", saved: "Bundles saved" });
      onSaved?.();
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }
  return (
    <section className="workspace-card bundle-editor-region" data-region="bundle-editor">
      <h3>Customer Bundles</h3>
      {action.error && <div className="error-state">{action.error}</div>}
      {action.saved && <div className="success-state">{action.saved}</div>}
      <div className="row-actions">
        <button type="button" disabled={locked} onClick={() => setDrafts([...drafts, { client_id: clientSideId(), title: "New Bundle", description: "", pricing_mode: "itemized_subtotal", manual_total: "", override_reason: "", show_member_prices: true, item_ids: [] }])}><Plus size={14} />Bundle</button>
        <button type="button" disabled={locked || action.busy || !documentId} onClick={save}><Save size={14} />Update Bundles</button>
      </div>
      {drafts.length === 0 && <div className="empty-state">No customer-facing bundles</div>}
      {drafts.map((bundle, index) => (
        <article className="bundle-editor" key={bundle.client_id}>
          <Field label="Bundle title" value={bundle.title} onChange={(title) => update(index, { title })} />
          <Field label="Description" value={bundle.description} onChange={(description) => update(index, { description })} />
          <SelectField label="Pricing mode" value={bundle.pricing_mode} onChange={(pricing_mode) => update(index, { pricing_mode })}>
            <option value="itemized_subtotal">Itemized subtotal</option>
            <option value="bundle_price">Bundle price</option>
          </SelectField>
          {bundle.pricing_mode === "bundle_price" && <Field label="Bundle total" value={bundle.manual_total} onChange={(manual_total) => update(index, { manual_total })} />}
          {bundle.pricing_mode === "bundle_price" && <Field label="Override reason" value={bundle.override_reason} onChange={(override_reason) => update(index, { override_reason })} />}
          <label className="check-row"><input type="checkbox" checked={bundle.show_member_prices} onChange={(event) => update(index, { show_member_prices: event.target.checked })} />Show member prices</label>
          <div className="bundle-members">
            {items.map((item) => (
              <label className="check-row" key={item.id || item.client_id}>
                <input type="checkbox" checked={bundle.item_ids.includes(item.id)} disabled={!item.id} onChange={(event) => {
                  const item_ids = event.target.checked ? [...bundle.item_ids, item.id] : bundle.item_ids.filter((id) => id !== item.id);
                  update(index, { item_ids });
                }} />
                {item.title || item.description}
              </label>
            ))}
          </div>
          <button type="button" disabled={locked} onClick={() => setDrafts(drafts.filter((_, i) => i !== index))}><Trash2 size={14} />Remove Bundle</button>
        </article>
      ))}
    </section>
  );
}

function InlineCustomerCreator({ api, onCreated }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ contact_name: "", business_name: "", email: "", phone: "", billing_address: blankAddress, active: true, tax_exempt: false, tax_exemption_note: "", internal_notes: "" });
  const [action, setAction] = useState({ busy: false, error: "" });
  async function save(event) {
    event.preventDefault();
    setAction({ busy: true, error: "" });
    try {
      const created = await api.post("/customers", { ...form, email: form.email || null, phone: form.phone || null, tax_exemption_note: form.tax_exemption_note || null, internal_notes: form.internal_notes || null });
      onCreated(created);
      setOpen(false);
      setForm({ contact_name: "", business_name: "", email: "", phone: "", billing_address: blankAddress, active: true, tax_exempt: false, tax_exemption_note: "", internal_notes: "" });
    } catch (err) {
      setAction({ busy: false, error: err.message, conflicts: err.conflicts || [] });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  if (!open) return <button type="button" onClick={() => setOpen(true)}><UserPlus size={14} />Create customer inline</button>;
  return (
    <form className="inline-customer-form form-grid" onSubmit={save}>
      <Toolbar title="New Customer"><button type="button" onClick={() => setOpen(false)}>Cancel</button></Toolbar>
      {action.error && <div className="error-state">{action.error}</div>}
      <Field label="Contact name" value={form.contact_name} onChange={(contact_name) => setForm({ ...form, contact_name })} />
      <Field label="Business name" value={form.business_name} onChange={(business_name) => setForm({ ...form, business_name })} />
      <Field label="Email" type="email" value={form.email} onChange={(email) => setForm({ ...form, email })} />
      <Field label="Phone" value={form.phone} onChange={(phone) => setForm({ ...form, phone })} />
      <AddressFields address={form.billing_address} setAddress={(billing_address) => setForm({ ...form, billing_address })} />
      <label className="check-row"><input type="checkbox" checked={form.tax_exempt} onChange={(event) => setForm({ ...form, tax_exempt: event.target.checked })} />Tax exempt</label>
      <button className="primary-button" disabled={action.busy}><Save size={16} />Save Customer</button>
    </form>
  );
}

function NewOrderPage({ api, setWorkspaceActions, onCreated }) {
  const customers = useLoad(() => api.get("/customers"), []);
  const settings = useLoad(() => api.get("/settings"), []);
  const [form, setForm] = useState({ customer_id: "", title: "", document_date: dateOnly(), due_date: "", status: "draft", discount: "0.00", internal_notes: "", items: [newQuickItem()] });
  const [dirty, setDirty] = useState(false);
  const [action, setAction] = useState({ busy: false, error: "", saved: "" });
  const dialogRef = useRef(null);
  const selectedCustomer = (customers.data?.items || []).find((customer) => customer.id === form.customer_id);

  function update(changes) {
    setDirty(true);
    setForm((current) => ({ ...current, ...changes }));
  }

  function requestBack() {
    if (dirty && !window.confirm("Discard unsaved Order Workspace changes?")) return;
    window.__signguyWorkspaceBypassHash = "#/orders";
    window.location.hash = "#/orders";
  }

  function setItem(index, changes) {
    update({ items: form.items.map((item, i) => (i === index ? { ...item, ...changes } : item)) });
  }

  function moveItem(index, delta) {
    const copy = [...form.items];
    const target = index + delta;
    if (target < 0 || target >= copy.length) return;
    [copy[index], copy[target]] = [copy[target], copy[index]];
    update({ items: copy });
  }

  function duplicateItem(index = form.items.length - 1) {
    const item = form.items[index];
    if (!item) return;
    update({ items: [...form.items.slice(0, index + 1), { ...item, id: undefined, client_id: clientSideId() }, ...form.items.slice(index + 1)] });
  }

  function removeItem(index) {
    update({ items: form.items.filter((_, i) => i !== index) });
  }

  async function save(event) {
    event?.preventDefault?.();
    setAction({ busy: true, error: "", saved: "" });
    try {
      const order = await api.post("/orders", documentPayload(form));
      setDirty(false);
      setAction({ busy: false, error: "", saved: "Saved" });
      window.__signguyWorkspaceBypassHash = `#/orders/${order.id}`;
      onCreated(order);
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  useEffect(() => {
    const guard = () => !dirty || window.confirm("Discard unsaved Order Workspace changes?");
    window.__signguyWorkspaceCanLeave = guard;
    return () => {
      if (window.__signguyWorkspaceCanLeave === guard) delete window.__signguyWorkspaceCanLeave;
    };
  }, [dirty]);
  useEffect(() => {
    window.setTimeout(() => dialogRef.current?.focus?.(), 0);
    const keydown = (event) => {
      if (event.key === "Escape") requestBack();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [dirty]);
  useEffect(() => {
    setWorkspaceActions({
      savedRecord: false,
      busy: action.busy,
      back: requestBack,
      save,
      addItem: () => update({ items: [...form.items, newQuickItem()] }),
      duplicateItem: form.items.length ? () => duplicateItem() : null,
      openCustomer: () => { window.location.hash = "#/customers"; },
      uploadArtwork: null,
      schedule: null,
      invoice: null,
    });
    return () => setWorkspaceActions(null);
  }, [action.busy, dirty, form]);

  return (
    <OrderWorkspaceShell
      label="New Order Workspace"
      title="New Order"
      status={form.status}
      customerName={selectedCustomer?.business_name || selectedCustomer?.contact_name || "Not selected"}
      dueDate={form.due_date}
      total="On save"
      progress={progressParts(null, form.items)}
      saveState={saveStateText(action, dirty, "Unsaved")}
      formRef={dialogRef}
      onSubmit={save}
    >
      {action.error && <div className="error-state">{action.error}</div>}
      <div className="order-dashboard-grid">
        <WorkspaceOrderInfoCard form={form} onUpdate={update} />
        <WorkspaceCustomerCard
          api={api}
          customers={customers.data?.items || []}
          selectedCustomer={selectedCustomer}
          customerId={form.customer_id}
          allowInlineCreate
          onCustomer={(customer_id, createdCustomer = null) => {
            if (createdCustomer) customers.refresh();
            update({ customer_id });
          }}
        />
        <OrderSummaryCard form={form} progress={progressParts(null, form.items)} />
        <ProductionSetupCard items={form.items} />
        <OrderItemsTable
          items={form.items}
          users={settings.data?.users || []}
          onItemChange={setItem}
          onAdd={() => update({ items: [...form.items, newQuickItem()] })}
          onMove={moveItem}
          onDuplicate={duplicateItem}
          onRemove={removeItem}
        />
        <OperationalStatusRail
          form={form}
          onUpload={null}
          onSchedule={null}
          onInvoice={null}
        />
      </div>
    </OrderWorkspaceShell>
  );
}

function OrderWorkspace({ orderId, api, returnRoute, setWorkspaceActions, onClose }) {
  const [state, setState] = useState({ loading: true, error: "", data: null });
  const [form, setForm] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [action, setAction] = useState({ busy: false, error: "", saved: "" });
  const [preview, setPreview] = useState(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [annotationTarget, setAnnotationTarget] = useState(null);
  const [scheduleTarget, setScheduleTarget] = useState(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const dialogRef = useRef(null);
  const previewRef = useRef(null);
  const annotationTargetRef = useRef(null);
  const fileInputRef = useRef(null);

  async function load() {
    setState({ loading: true, error: "", data: null });
    try {
      const data = await api.get(`/orders/${orderId}/workspace`);
      setState({ loading: false, error: "", data });
      setForm({
        expected_updated_at: data.order.updated_at,
        title: data.order.title || "",
        document_date: data.order.document_date,
        due_date: data.order.due_date || "",
        status: data.order.status,
        discount: String((data.order.discount_cents || 0) / 100),
        internal_notes: data.order.internal_notes || "",
        items: data.order.items.map(itemFromApi),
      });
      setDirty(false);
      setAction({ busy: false, error: "", saved: "" });
    } catch (err) {
      setState({ loading: false, error: err.message, data: null });
    }
  }

  useEffect(() => { load(); }, [orderId]);
  useEffect(() => {
    previewRef.current = preview;
  }, [preview]);
  useEffect(() => {
    annotationTargetRef.current = annotationTarget;
  }, [annotationTarget]);
  useEffect(() => {
    const guard = () => {
      if (annotationTarget && !window.confirm("Close annotation workspace and discard unsaved annotation work?")) return false;
      return !dirty || window.confirm("Discard unsaved Order Workspace changes?");
    };
    window.__signguyWorkspaceCanLeave = guard;
    return () => {
      if (window.__signguyWorkspaceCanLeave === guard) delete window.__signguyWorkspaceCanLeave;
    };
  }, [dirty, annotationTarget]);
  useEffect(() => {
    window.setTimeout(() => dialogRef.current?.focus?.(), 0);
    return () => {
      if (previewRef.current?.url) URL.revokeObjectURL(previewRef.current.url);
      if (annotationTargetRef.current?.url) URL.revokeObjectURL(annotationTargetRef.current.url);
    };
  }, []);
  useEffect(() => {
    const beforeUnload = (event) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const keydown = (event) => {
      if (event.key === "Escape") requestClose();
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("keydown", keydown);
    };
  }, [dirty]);
  useEffect(() => {
    window.setTimeout(() => dialogRef.current?.focus?.(), 0);
  }, [state.loading, state.error, action.saved]);

  function update(changes) {
    setDirty(true);
    setForm((current) => ({ ...current, ...changes }));
  }

  function requestClose() {
    if (window.__signguyWorkspaceCanLeave && !window.__signguyWorkspaceCanLeave()) return;
    closeAnnotation();
    setCameraOpen(false);
    onClose();
  }

  function replacePreview(next) {
    setPreview((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return next;
    });
  }

  function setItem(index, changes) {
    update({ items: form.items.map((item, i) => (i === index ? { ...item, ...changes } : item)) });
  }

  function moveItem(index, delta) {
    const copy = [...form.items];
    const target = index + delta;
    if (target < 0 || target >= copy.length) return;
    [copy[index], copy[target]] = [copy[target], copy[index]];
    update({ items: copy });
  }

  async function save(event) {
    event?.preventDefault?.();
    setAction({ busy: true, error: "", saved: "" });
    try {
      const payload = {
        expected_updated_at: form.expected_updated_at,
        title: form.title,
        document_date: form.document_date,
        due_date: form.due_date || null,
        status: form.status,
        discount_cents: cents(form.discount),
        internal_notes: form.internal_notes || null,
        items: form.items.map((item) => ({
          id: item.id,
          title: item.title,
          description: item.description,
          quantity_decimal: item.quantity_decimal,
          unit_price_cents: cents(item.unit_price),
          taxable: item.taxable,
          production_required: item.production_required,
          production_stage: item.production_stage || "not_started",
          completed: item.completed || item.production_stage === "complete",
          due_date: item.due_date || null,
          assigned_user_id: item.assigned_user_id || null,
          internal_note: item.internal_note || null,
        })),
      };
      const data = await api.patch(`/orders/${orderId}/workspace`, payload);
      setState({ loading: false, error: "", data });
      setForm({ ...form, expected_updated_at: data.order.updated_at, items: data.order.items.map(itemFromApi) });
      setDirty(false);
      setAction({ busy: false, error: "", saved: "Saved" });
    } catch (err) {
      setAction({ busy: false, error: err.status === 409 ? "Order changed elsewhere. Reload before saving again." : err.message, saved: "" });
    }
  }

  async function upload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setAction({ busy: true, error: "", saved: "" });
    try {
      await api.upload(`/orders/${orderId}/attachments`, file);
      const attachments = await api.get(`/orders/${orderId}/attachments`);
      setState((current) => ({ ...current, data: { ...current.data, attachments: attachments.items } }));
      setAction({ busy: false, error: "", saved: "Attachment uploaded" });
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    } finally {
      event.target.value = "";
    }
  }

  async function refreshAttachments(saved = "") {
    const attachments = await api.get(`/orders/${orderId}/attachments`);
    setState((current) => ({ ...current, data: { ...current.data, attachments: attachments.items } }));
    setAction({ busy: false, error: "", saved });
  }

  async function useCapturedPhoto(blob, filename) {
    setAction({ busy: true, error: "", saved: "" });
    try {
      await api.upload(`/orders/${orderId}/attachments`, new File([blob], filename, { type: blob.type || "image/jpeg" }), { source_type: "device_capture" });
      setCameraOpen(false);
      await refreshAttachments("Captured photo attached");
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
      throw err;
    }
  }

  async function openAttachment(attachment, mode) {
    setAction({ busy: true, error: "", saved: "" });
    try {
      const result = await api.blob(`/orders/${orderId}/attachments/${attachment.id}/${mode}`);
      const url = URL.createObjectURL(result.blob);
      if (mode === "download") {
        const link = document.createElement("a");
        link.href = url;
        link.download = attachment.original_filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      } else {
        replacePreview({ url, mime_type: attachment.mime_type, name: attachment.original_filename });
      }
      setAction({ busy: false, error: "", saved: "" });
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  function closeAnnotation() {
    setAnnotationTarget((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return null;
    });
  }

  async function openOriginalAttachment(attachment) {
    const original = state.data?.attachments?.find((entry) => entry.id === attachment.original_attachment_id);
    if (original) await openAttachment(original, "preview");
  }

  async function openAnnotation(attachment) {
    setAction({ busy: true, error: "", saved: "" });
    try {
      const result = await api.blob(`/orders/${orderId}/attachments/${attachment.id}/preview`);
      const url = URL.createObjectURL(result.blob);
      closeAnnotation();
      setAnnotationTarget({ attachment, url });
      setAction({ busy: false, error: "", saved: "" });
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  async function saveAnnotation(file, operations) {
    setAction({ busy: true, error: "", saved: "" });
    try {
      await api.upload(`/orders/${orderId}/attachments/${annotationTarget.attachment.id}/annotations`, file, { annotation_json: JSON.stringify(operations) });
      closeAnnotation();
      await refreshAttachments("Annotated copy saved");
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
      throw err;
    }
  }

  async function deleteAttachment(attachment) {
    if (!window.confirm(`Delete ${attachment.original_filename}?`)) return;
    setAction({ busy: true, error: "", saved: "" });
    try {
      await api.delete(`/orders/${orderId}/attachments/${attachment.id}`);
      setState((current) => ({ ...current, data: { ...current.data, attachments: current.data.attachments.filter((entry) => entry.id !== attachment.id) } }));
      if (preview?.name === attachment.original_filename) replacePreview(null);
      setAction({ busy: false, error: "", saved: "Attachment deleted" });
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  async function createOrOpenInvoice() {
    if (!state.data?.order) return;
    setAction({ busy: true, error: "", saved: "" });
    try {
      await api.post(`/orders/${orderId}/invoice`, {});
      await load();
      setAction({ busy: false, error: "", saved: "Invoice ready" });
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  useEffect(() => {
    const order = state.data?.order;
    setWorkspaceActions({
      savedRecord: Boolean(order),
      busy: action.busy,
      back: requestClose,
      save: order && form ? save : null,
      addItem: order && form && !order.invoice ? () => update({ items: [...form.items, newQuickItem({ production_stage: "not_started", completed: false })] }) : null,
      duplicateItem: order && !order.invoice && form?.items?.length ? () => {
        const item = form.items.at(-1);
        update({ items: [...form.items, { ...item, id: undefined, client_id: clientSideId() }] });
      } : null,
      uploadArtwork: order ? () => fileInputRef.current?.click?.() : null,
      schedule: order ? () => setScheduleTarget({ type: "order", order }) : null,
      openCustomer: order ? () => { window.location.hash = "#/customers"; } : null,
      invoice: order ? createOrOpenInvoice : null,
      emailCustomer: order ? () => setEmailOpen(true) : null,
      communicationNote: order ? () => document.querySelector("[data-region='communications'] textarea")?.focus?.() : null,
    });
    return () => setWorkspaceActions(null);
  }, [state.data, action.busy, form, dirty]);

  if (state.loading) return (
    <OrderWorkspaceShell
      label="Order Workspace"
      title="Loading Order"
      status="loading"
      customerName=""
      dueDate=""
      total=""
      progress={{ completed: 0, total: 0, percent: null }}
      saveState="Loading"
      formRef={dialogRef}
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="loading-state">Loading</div>
    </OrderWorkspaceShell>
  );
  if (state.error) return (
    <OrderWorkspaceShell
      label="Order Workspace"
      title="Order Workspace"
      status="error"
      customerName=""
      dueDate=""
      total=""
      progress={{ completed: 0, total: 0, percent: null }}
      saveState="Error"
      formRef={dialogRef}
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="error-state">{state.error}</div>
    </OrderWorkspaceShell>
  );

  const { order, customer, users, attachments } = state.data;
  const invoiced = Boolean(order.invoice);
  const activeUsers = users || [];
  return (
    <>
      <OrderWorkspaceShell
        label={`Order Workspace ${order.order_number}`}
        title={order.order_number}
        status={form.status}
        customerName={customer.business_name || customer.contact_name}
        dueDate={form.due_date || order.due_date}
        total={money(order.total_cents)}
        progress={order.production_progress}
        saveState={saveStateText(action, dirty, "Current")}
        formRef={dialogRef}
        onSubmit={save}
      >
        {action.error && <div className="error-state">{action.error} {action.error.includes("Reload") && <button type="button" onClick={load}>Reload</button>}</div>}
        {invoiced && <div className="notice">Invoice {order.invoice.invoice_number} exists. Financial fields and item order are locked to keep invoice totals and PDFs consistent.</div>}
        <input className="hidden-file-input" ref={fileInputRef} aria-label="Upload attachment" type="file" onChange={upload} disabled={action.busy} />
        <div className="order-dashboard-grid">
          <WorkspaceOrderInfoCard form={form} onUpdate={update} invoiced={invoiced} />
          <section className="workspace-card customer-info-region" data-region="customer-info">
            <h3>Customer</h3>
            <CustomerSummary customer={customer} compact />
            <span className="workspace-return-note">Return: {returnRoute === "production" ? "Production" : "Orders"}</span>
          </section>
          <OrderSummaryCard order={order} form={form} invoice={order.invoice} progress={order.production_progress} />
          <ProductionSetupCard api={api} order={order} items={form.items} dirty={dirty} onDone={load} />
          <BundleEditor api={api} documentType="order" documentId={order.id} items={order.items} bundles={order.bundles || []} locked={Boolean(order.invoice)} onSaved={load} />
          <OrderItemsTable
            items={form.items}
            users={activeUsers}
            invoiced={invoiced}
            onItemChange={setItem}
            onAdd={!invoiced ? () => update({ items: [...form.items, newQuickItem({ production_stage: "not_started", completed: false })] }) : null}
            onMove={moveItem}
            onDuplicate={(index) => {
              const item = form.items[index];
              update({ items: [...form.items.slice(0, index + 1), { ...item, id: undefined, client_id: clientSideId() }, ...form.items.slice(index + 1)] });
            }}
            onRemove={(index) => window.confirm("Remove this item?") && update({ items: form.items.filter((_, i) => i !== index) })}
          />
          <OperationalStatusRail
            order={order}
            form={form}
            attachments={attachments}
            preview={preview}
            onUpload={() => fileInputRef.current?.click?.()}
            onCapture={() => setCameraOpen(true)}
            onAnnotate={openAnnotation}
            onOpenOriginal={openOriginalAttachment}
            onSchedule={() => setScheduleTarget({ type: "order", order })}
            onInvoice={createOrOpenInvoice}
            onPreview={(attachment) => openAttachment(attachment, "preview")}
            onDownload={(attachment) => openAttachment(attachment, "download")}
            onDelete={deleteAttachment}
            onClosePreview={() => replacePreview(null)}
          />
          <CommunicationPanel
            api={api}
            customerId={customer.id}
            relatedEntityType="order"
            relatedEntityId={order.id}
            savedCustomerEmail={customer.email || ""}
            onEmail={() => setEmailOpen(true)}
          />
        </div>
      </OrderWorkspaceShell>
      {cameraOpen && <CameraCaptureOverlay orderNumber={order.order_number} busy={action.busy} onUsePhoto={useCapturedPhoto} onClose={() => setCameraOpen(false)} />}
      {annotationTarget && (
        <AnnotationWorkspace
          attachment={annotationTarget.attachment}
          imageUrl={annotationTarget.url}
          busy={action.busy}
          onSave={saveAnnotation}
          onClose={closeAnnotation}
        />
      )}
      {emailOpen && (
        <EmailComposerModal
          api={api}
          endpoint={`/orders/${order.id}/email`}
          title={`Email ${customer.business_name || customer.contact_name}`}
          defaultSubject={`Order ${order.order_number}`}
          defaultBody="Here is an update on your order."
          defaultTo={customer.email || ""}
          savedCustomerEmail={customer.email || ""}
          onClose={() => setEmailOpen(false)}
          onSent={load}
        />
      )}
      {scheduleTarget && <ScheduleFromWorkspaceModal api={api} target={scheduleTarget} users={activeUsers} onClose={() => setScheduleTarget(null)} />}
    </>
  );
}

function ScheduleFromWorkspaceModal({ api, target, users, onClose }) {
  const todayText = dateOnly();
  const linkedDate = target.work_order?.due_date || target.item?.due_date || target.order.due_date || todayText;
  const [form, setForm] = useState({
    title: target.type === "work_order" ? target.work_order.title : target.type === "order_item" ? target.item.title || target.item.description : target.order.title || target.order.order_number,
    start_at: `${linkedDate}T09:00`,
    end_at: `${linkedDate}T10:00`,
    all_day: false,
    assigned_user_id: target.work_order?.assigned_user_id || target.item?.assigned_user_id || "",
    internal_note: "",
  });
  const [action, setAction] = useState({ busy: false, error: "" });
  async function save(event) {
    event.preventDefault();
    setAction({ busy: true, error: "" });
    try {
      await api.post("/calendar", {
        title: form.title,
        order_id: target.order.id,
        order_item_id: target.type === "order_item" ? target.item.id : null,
        work_order_id: target.type === "work_order" ? target.work_order.id : null,
        schedule_category: target.type === "work_order" ? "production" : "general",
        start_at: form.start_at,
        end_at: form.end_at,
        all_day: form.all_day,
        assigned_user_id: form.assigned_user_id || null,
        internal_note: form.internal_note || null,
      });
      onClose();
    } catch (err) {
      setAction({ busy: false, error: err.message });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  return (
    <div className="modal-backdrop">
      <form className="calendar-modal form-grid" role="dialog" aria-modal="true" aria-label="Schedule from Order Workspace" onSubmit={save}>
        <Toolbar title="Schedule"><button type="button" onClick={onClose}>Close</button></Toolbar>
        {action.error && <div className="error-state">{action.error}</div>}
        <Field label="Title" value={form.title} onChange={(title) => setForm({ ...form, title })} />
        <label className="check-row"><input type="checkbox" checked={form.all_day} onChange={(event) => setForm({ ...form, all_day: event.target.checked, start_at: event.target.checked ? String(form.start_at).slice(0, 10) : `${String(form.start_at).slice(0, 10)}T09:00`, end_at: event.target.checked ? addDays(String(form.end_at).slice(0, 10), 1) : `${String(form.end_at).slice(0, 10)}T10:00` })} />All day</label>
        <Field label="Start" type={form.all_day ? "date" : "datetime-local"} value={form.start_at} onChange={(start_at) => setForm({ ...form, start_at })} />
        <Field label="End" type={form.all_day ? "date" : "datetime-local"} value={form.end_at} onChange={(end_at) => setForm({ ...form, end_at })} />
        <SelectField label="Assigned user" value={form.assigned_user_id} onChange={(assigned_user_id) => setForm({ ...form, assigned_user_id })}>
          <option value="">Unassigned</option>
          {users.map((user) => <option value={user.id} key={user.id}>{user.display_name}</option>)}
        </SelectField>
        <Field label="Internal note" value={form.internal_note} onChange={(internal_note) => setForm({ ...form, internal_note })} />
        <button className="primary-button" disabled={action.busy}><CalendarDays size={16} />Create Event</button>
      </form>
    </div>
  );
}

export {
  NewOrderPage,
  OrderWorkspace,
  ScheduleFromWorkspaceModal,
  BundleEditor,
  EmailAction,
  CommunicationPanel,
  CustomerSummary,
};
