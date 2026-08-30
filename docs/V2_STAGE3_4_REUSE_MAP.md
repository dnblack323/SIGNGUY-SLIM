# Version 2 Stages 3-4 Reuse Map

Base commit: `c48c233f36b571fb6dd33e2b9b84477c4d941210`

Branch: `codex/v2-stages-3-4-camera-annotation`

## Scope

Stages 3 and 4 add Order Workspace device-camera photo capture and simple photo
annotation. They do not add a global Camera page, general design editor, crop or
filter tools, AI image tools, customer proofing, signatures, video annotation,
Asset Library, templates, public media links, or Stage 5+ work.

## Reused Components

| Area | Reuse decision | Evidence |
| --- | --- | --- |
| Order Workspace | Reused | Capture and annotation controls live inside the existing Artwork & Files area, preserving the finalized shell, ribbon, tabs, and single scrolling workspace. |
| Attachment storage | Reused | Captured photos and annotated copies use the existing private `order_attachments` filesystem pipeline, MIME/content checks, size limits, checksums, preview/download endpoints, and soft delete behavior. |
| Permissions | Reused | Upload and annotation creation both require the existing write-role gate and tenant-scoped Order lookup. |
| Audit | Reused | Device captures write `attachment.device_capture`; annotated copies write `attachment.annotation_create`; regular upload/delete/download audit behavior remains unchanged. |
| Backup/restore | Adapted | Existing encrypted backup packaging continues to carry active attachments and now preserves derivative metadata on restore. |

## Additive Schema

Migration `011_v2_stage3_4_camera_annotation.sql` adds metadata columns to
`order_attachments`:

- `source_type`: `upload`, `device_capture`, `intake`, or `annotation_derivative`.
- `original_attachment_id`: self-reference from a derivative to its immutable original.
- `derivative_type`: currently `annotation`.
- `image_width` and `image_height`: byte-derived dimensions for image records.
- `annotation_json`: compact normalized annotation operations used to reopen markup.

The migration also adds an index for original/derivative lookup and triggers that
reject self-references, missing originals, cross-tenant/cross-Order derivative
links, and derivative rows without annotation metadata.

## Original And Derivative Rules

Original image bytes are never overwritten. Saving an annotation renders a new
PNG through the private attachment path, creates a new attachment record, links it
to the original attachment, stores dimensions and normalized operation data, and
leaves earlier derivatives intact. Annotated rows show as `Annotated`; source
rows show as `Original`, with captured photos marked `Original / Captured`.

## Annotation Tools

The annotation workspace supports pointer, pen, mouse, and touch input with:

- select/delete;
- freehand pen;
- arrow;
- rectangle;
- text label;
- color swatches;
- practical stroke widths;
- undo;
- redo;
- clear all with confirmation;
- cancel with unsaved-work warning;
- save annotated copy.

Coordinates are saved as normalized values from 0 to 1 so markup remains aligned
when the canvas is displayed at a different size.

## Browser Camera Limits

Camera capture uses `navigator.mediaDevices.getUserMedia` with `audio: false`
and an environment-facing camera preference. Browsers must support media devices
and generally require a secure context, with localhost treated as suitable for
development. Device labels and camera switching depend on browser permission and
available hardware. Unsupported, denied, missing-device, busy-device, capture,
and upload failures keep ordinary file upload available as the fallback.

## Validation

Focused coverage was added for:

- captured-photo attachment metadata and audit;
- authorized annotated derivative creation;
- immutable original bytes;
- multiple derivatives;
- tenant, permission, cross-Order, unsupported source, malformed payload, and
  excessive payload rejection;
- camera-supported capture, retake, confirmed upload, and track shutdown;
- unsupported and permission-denied camera fallback;
- annotation open/save, normalized coordinates, undo, redo, clear, unsaved
  warning, original access, and ordinary upload availability.

Final validation for this branch should include `npm run test`, `npm run guard`,
`npm run build`, `SIGNGUY_SLIM_DB_PATH=:memory: npm run backend:migrate`, and
`git diff --check`.
