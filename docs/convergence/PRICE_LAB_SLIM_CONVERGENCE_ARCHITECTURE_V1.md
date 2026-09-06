# PRICE LAB + SIGNGUY SLIM CONVERGENCE ARCHITECTURE & OWNERSHIP RULES V1

Phase 6A Governing Architecture Document

Prepared after Price Lab Phase 5D completion and SignGuy Slim Commercial Release C merge

**DOCUMENT STATUS**

| FIELD | VALUE |
| --- | --- |
| Status | V1 architecture baseline for convergence work |
| Price Lab checkpoint | Phase 5A-5D complete; Phase 5 complete |
| Slim checkpoint | Commercial Releases A-C complete; Release D next |
| Primary rule | Finalize in Price Lab → Mirror in Slim → Verify parity → Move on |
| Formula authority | Shared SignGuy Pricing Engine |
| UX reference authority | Price Lab desktop until each module is personally approved |
| Hosted business-record authority | SignGuy Slim |
| Portability authority | SIGNGUY-DATA-PORTABILITY only where an explicit shared contract exists |

**Purpose: Prevent Price Lab desktop and Price Lab inside SignGuy Slim from becoming two independently designed pricing products. This document defines exactly what is shared, what remains product-specific, who owns each data/behavior contract, and when a module is considered complete.**

## 1. Convergence Goal

The end state is not “copy Price Lab into Slim.” The end state is one pricing experience expressed through two runtimes: an offline/local-first desktop product and a hosted multi-tenant shop application. They should look and behave like the same product family where users perform pricing work, while each product keeps the storage, security, business-record, deployment, and operating responsibilities that belong to its runtime.

- Price Lab desktop becomes the reference implementation for the user-facing pricing experience.
- SignGuy Slim mirrors approved Price Lab modules using hosted, tenant-scoped persistence and Slim business-record workflows.
- The shared Pricing Engine remains the single authority for formulas, deterministic decimal behavior, pricing-method candidates, cost/profit/margin results, warnings, and Show the Math evidence.
- No convergence task may create a second quote/order/invoice system inside Slim when Slim already owns those business records.
- No convergence task may copy Electron, local file, installer, updater, licensing, or desktop backup mechanics into Slim.
- No convergence task may rewrite shared engine formulas in React, Node, SQLite queries, or renderer code.

**NON-NEGOTIABLE CONVERGENCE RULE**

> **PRICE LAB APPROVAL → SLIM MIRROR → PARITY CHECK → COMPLETE**

## 2. Repository and Product Ownership

| SYSTEM / REPO | OWNS | MUST NOT OWN |
| --- | --- | --- |
| SignGuy Pricing Engine | Pricing formulas; deterministic decimal calculations; pricing-method candidates; direct cost; loaded cost; selected price support; profit/margin; warnings; Show the Math; category calculation rules. | Desktop UI, hosted UI, customer records, tenant auth, Electron IPC, local backups, webstores, orders, invoices, Stripe. |
| Price Lab Desktop dnblack323/Signguy-AI-Pricing-Lab | Reference pricing UX; local SQLite; Electron runtime; IPC/preload validation; Starter Library UX; shop-owned values; Pricing Foundation; Guided Interview; Review Center; Saved Work; Packages; Sales Documents; local branding/PDF; local import/export; desktop backup/restore; later licensing/updater/installer. | Hosted tenant identity, Slim Orders, Slim production, Slim Payments, hosted auth/security, webstore operations, duplicated pricing formulas. |
| SignGuy Slim dnblack323/SIGNGUY-SLIM | Hosted tenant auth; users/roles; Customers; Quotes; Orders; Order Items; Work Orders; Production; Invoices; Payments; Incoming Requests; communications; Calendar; Employee/Time/Pay; hosted files; commercial backups; hosted Price Lab persistence and integration. | Electron/local file mechanics, desktop licensing/updater, duplicate quote/invoice subsystem for Price Lab, independent calculator formulas. |
| SIGNGUY-DATA-PORTABILITY | Versioned cross-product portability contracts explicitly designated as shared. | Live databases, sessions, secrets, runtime auth, hosting metadata, arbitrary internal state. |

## 3. Governing Architecture Principles

1. One formula source. Pricing Engine behavior must never be forked by product.
1. One approved pricing UX. Price Lab desktop is the UX reference until a module is approved.
1. Runtime-specific persistence. Desktop stores local shop state; Slim stores equivalent hosted tenant-scoped state.
1. Business records stay native. Slim Quote/Order/Invoice/Payment remain Slim records; Price Lab Sales Documents remain desktop records.
1. Snapshots are historical evidence. Recalculation creates a new version; it must not silently rewrite prior customer/commercial history.
1. Backend security remains authoritative in Slim. Price Lab desktop does not import Slim sessions, CSRF, tenant credentials, or runtime security state.
1. Desktop mechanics remain desktop-only. Electron IPC, local filesystem, updater, installer, code signing, and license storage never become normal Slim UI.
1. Hosted mechanics remain hosted-only. Tenant scoping, role/capability authorization, hosted quotas, provider email, and server recovery do not become Price Lab desktop requirements.
1. Additive contracts are preferred. Breaking calculator or snapshot changes require versioned compatibility handling.
1. No module is done merely because it renders. It must satisfy Price Lab approval, Slim mirror, and parity acceptance.

## 4. Modules That Must Exist in Both Products

| MODULE | PRICE LAB DESKTOP | SIGNGUY SLIM | SHARED / PARITY REQUIREMENT |
| --- | --- | --- | --- |
| Overview / Dashboard | Local setup status, recent pricing work, recent documents. | Hosted shop equivalent; may substitute tenant/business-record summaries. | Terminology and primary actions match; runtime-only status may differ. |
| Nine calculators | Reference UX and local saved result creation. | Hosted Price Lab calculators. | Same engine request/result contract and equivalent outputs. |
| Saved Work | Local immutable saved calculations and versions. | Tenant-scoped hosted saved calculations and versions. | Equivalent reopen/duplicate/recalculate/archive concepts. |
| Package Builder | Local reusable packages backed by saved/generated calculation evidence. | Hosted tenant-scoped packages. | No duplicated formulas; one-level package model unless later versioned. |
| Materials Library | Starter/shop values, review state, selectors, provenance. | Hosted equivalent material/pricing library. | Same user-facing material identity/selector concepts; storage implementation may differ. |
| Pricing Foundation | Local shop profile/settings. | Hosted tenant pricing foundation. | Equivalent effective inputs produce equivalent derived rates. |
| Guided Pricing Interview | Local guided proposal workflow. | Hosted guided proposal workflow. | Equivalent answers create equivalent proposals; proposals never silently become active. |
| Pricing Review Center | Local review/accept/defer workflow. | Hosted review/accept/defer workflow. | Equivalent actions produce equivalent effective pricing values. |
| Benchmark Experience | Downloaded/advisory benchmark presentation. | Hosted/future connected benchmark presentation. | Benchmark stays advisory until accepted. |
| Sales/Quote handoff | Desktop Sales Documents: Estimate/Quote/Invoice. | Price Lab actions feed native Slim Quotes, then Orders/Invoices/Payments. | Pricing evidence maps cleanly without duplicating Slim business records. |
| Branding / customer presentation | Desktop templates, print, PDF. | Slim Quote/Invoice customer presentation. | Same approved design principles; storage/versioning may differ. |

## 5. Product-Specific Responsibilities

### 5.1 Price Lab Desktop Only

- Electron shell, preload, IPC and desktop runtime boundaries.
- Local SQLite path, local migrations, diagnostics, local shop state and local history.
- Local Starter Pack file import/update/reconciliation mechanics.
- Local encrypted backup/restore and desktop recovery flows.
- Local file chooser, export/import package files and native save/open behavior.
- Native printing and local PDF/file save behavior.
- Desktop licensing, device-count enforcement, offline grace/revalidation, installer, code signing, updater and release channel.
- Offline operation when no internet is available.

### 5.2 SignGuy Slim Only

- Tenant registration, authentication, HttpOnly sessions, CSRF, rate limits, account recovery and role/capability authorization.
- Hosted Customers, Quotes, Orders, Order Items, Work Orders, Production, Invoices, Payments and Calendar.
- Employee, Time Clock, Time & Attendance, internal pay, Messages and Announcements.
- Incoming Requests and email intake.
- Hosted attachments, quotas, server backup/recovery and production storage validation.
- Customer email provider integration and communication history.
- Future Slim-specific Expenses, Sales Tax, Supply Room, Stripe customer payments, Webstores and first-run shop onboarding.

## 6. Shared Terminology Contract

| CONCEPT | APPROVED USER-FACING TERM | IMPLEMENTATION NOTE |
| --- | --- | --- |
| Pricing application area | Price Lab | Use consistently inside desktop and Slim. |
| Calculator categories | Banners, Rigid Signs, Cut Vinyl, Digital Print, Vehicle Graphics, Apparel, Promotional Products, Services, Custom Products | Keep frozen category identifiers from calculator contract. |
| Saved calculation | Saved Calculation / Saved Work | Do not expose engine/internal snapshot IDs as primary user labels. |
| Reusable bundle | Product / Package | One-level package model in V1. |
| Pricing setup | Pricing Foundation | Includes shop rate and category-profile inputs. |
| Guided setup | Guided Pricing Interview | Produces proposals requiring acceptance. |
| Pricing review | Pricing Review Center | Central location for Starter/shop/inferred/benchmark value review. |
| Customer commercial proposal | Quote | Slim user-facing term remains Quote; internal `estimate*` identifiers may remain for compatibility. |
| Production object | Work Order | Not interchangeable with Order or Order Item. |
| Material source values | Starter value / Shop value / Active value | Keep provenance visible but not intrusive. |
| Calculation explanation | Show the Math | Same phrase in both products. |

## 7. Shared Calculator Input / Output Contract

**Authority: The existing Phase 4 Calculator Contract Freeze V1 remains the base calculator contract. Convergence may improve layout and workflow, but must not silently reinterpret the frozen calculation semantics.**

### 7.1 Request Boundary

- Dimensions and quantity where applicable.
- `material_profile` when reviewed Starter/shop material participates in automatic pricing.
- Active Pricing Foundation and category-profile settings.
- Pricing components such as setup, design, travel, hardware, freight, outsourcing and category-specific charges.
- Category-specific inputs.
- Optional clearly labeled manual selling price override.
- Decimals cross the engine boundary as normalized strings; money crosses as integer cents or canonical decimal strings according to the frozen contract.

### 7.2 Result Boundary

- Calculator/category identity and framework/schema version.
- Validated input and engine request evidence.
- Direct invested cost and fully loaded cost.
- Pricing method selected plus available/unavailable method candidates.
- Selected selling price support.
- Profit and margin.
- Quantity discount evidence.
- Warnings and assumptions.
- Show the Math evidence.
- Engine identity and provenance.
- Canonical immutable snapshot evidence.

### 7.3 Rules Both Products Must Enforce

- Invalid/unavailable inputs must never invent a price.
- Manual price is an explicit pricing method, not a hidden overwrite of cost evidence.
- Warnings and assumptions survive saving, packaging and business-record handoff.
- Recalculating saved work creates a new version rather than rewriting historical snapshots.
- Equivalent requests against the same engine/profile/material state must produce equivalent pricing results.

## 8. Persistence and Identity Mapping

| DATA / CONCEPT | PRICE LAB DESKTOP | SIGNGUY SLIM | CONVERGENCE RULE |
| --- | --- | --- | --- |
| Shop identity | Single local shop/workspace context. | Tenant ID is authoritative hosted shop identity. | Do not reuse desktop database IDs as hosted tenant IDs. |
| Material identity | Stable Starter/shop keys + local records. | Hosted tenant-scoped material/value records mapped to same stable conceptual keys. | Stable product keys may be shared; local row IDs are not portable identity. |
| Pricing Foundation | Local active profile + history. | Tenant-scoped active profile + history. | Equivalent fields/units; runtime IDs may differ. |
| Category profile | Local profile versions. | Tenant-scoped profile versions. | Parity fixture references logical profile values, not DB primary keys. |
| Saved Calculation | Local immutable versioned snapshot. | Tenant-scoped immutable hosted snapshot. | Same engine evidence contract; storage schema may differ. |
| Package | Local reusable package/template. | Tenant-scoped hosted package/template. | No nested V1 packages unless contract version changes. |
| Customer | Minimal local Sales Document reference. | First-class Slim Customer. | Desktop customer record is not authoritative for Slim; handoff maps to selected/created Slim Customer. |
| Quote | Desktop Sales Document type. | Native Slim Quote record. | Do not copy desktop Quote DB row wholesale into Slim runtime. |
| Invoice | Desktop Sales Document type. | Native Slim Invoice linked to Order. | Desktop Invoice remains standalone desktop feature; Slim uses its own commercial lifecycle. |

## 9. Sales Documents to Slim Business-Record Mapping

**Critical Rule: Price Lab inside Slim must never introduce a second online Estimate/Quote/Invoice database. It contributes pricing evidence to Slim-native business records.**

| PRICE LAB ACTION / CONCEPT | SLIM MAPPING |
| --- | --- |
| Create a desktop Estimate/Quote/Invoice | Desktop-only Sales Document record when using standalone Price Lab. |
| Create New Quote from Slim Price Lab | Create a native Slim Quote and add calculation/package-backed line evidence. |
| Add to Existing Quote | Append a new Quote line backed by an immutable calculation/package snapshot. |
| Finalize desktop Sales Document | Create immutable local revision only; does not mutate Slim. |
| Slim Quote → Order | Use existing Slim Quote-to-Order conversion contract. |
| Slim Order → Invoice | Use existing Slim one-Invoice-per-Order contract unless later architecture changes it. |
| Slim Payment | Remain native Slim payment tracking/Stripe integration later. |
| Customer-safe output | Never expose internal cost, profit, margin, provenance or Show the Math unless explicitly designed for internal view. |

### 9.1 Required Pricing Evidence Stored with Slim Quote Lines

- Calculation/package logical source identity and version.
- Frozen engine request/result evidence sufficient to reproduce historical meaning.
- Engine version/provenance.
- Selected pricing method and selected price.
- Customer-facing line description and quantity.
- Warnings/assumptions retained internally where relevant.
- Direct/loaded cost and profit/margin retained as internal evidence only.
- No live dependency on future recalculation to understand a historical Quote/Order/Invoice.

## 10. Materials and Starter Library Ownership

- Price Lab owns the reference Materials Library UX and Starter Pack reconciliation UX.
- The shared conceptual identity should distinguish component type → manufacturer → product/model → variant.
- Starter source records remain immutable; shop-owned values remain separate.
- Automatic pricing may use only reviewed/effective usable values.
- Unavailable, quote-required, rejected, hidden, retired, unreviewed or incompatible records must not silently price jobs.
- Slim mirrors the everyday Materials Library behavior using hosted tenant storage; it does not expose desktop local JSON/file import mechanics as normal workflow.
- Slim Supply Room / physical inventory is a separate future operational domain. Stock quantity must not be confused with the pricing Materials Library cost/value contract.

## 11. Saved Work and Package Ownership

- Saved calculations are immutable snapshots. Recalculate/New Version creates a new snapshot.
- Packages consume saved or generated engine-backed calculation evidence.
- Package totals use component results once; UI code may not duplicate pricing formulas.
- V1 packages remain one level deep.
- Price Lab desktop stores local shop-scoped saved work; Slim stores tenant-scoped hosted equivalents.
- Rename, duplicate, archive, restore and search/filter may differ in persistence mechanics but should remain conceptually equivalent.

## 12. Pricing Foundation, Guided Interview, Review Center and Benchmark

| MODULE | REFERENCE OWNERSHIP | SLIM ADAPTATION RULE |
| --- | --- | --- |
| Pricing Foundation | Price Lab desktop UX first. Shared engine derives pricing/shop-rate outputs. | Store tenant-scoped inputs and active profile history; same units/meaning; equivalent fixture yields equivalent output. |
| Guided Pricing Interview | Price Lab owns approved question flow and proposal UX. | Hosted save/resume may differ; proposal meaning must match; inferred values never auto-activate. |
| Pricing Review Center | Price Lab owns approved review workflow. | Hosted equivalent uses tenant data; Accept/Edit/Keep/Defer/Not Applicable semantics must match. |
| Benchmark Program | Price Lab V1 owns advisory/down-loaded dataset presentation. | Slim may later receive connected benchmark updates; values remain advisory until explicit acceptance. |

## 13. UX Ownership and Mirroring Rules

1. Price Lab desktop is the reference implementation until the specific module is personally approved.
1. Approved module behavior is documented before or during Slim mirroring.
1. Slim may adapt background, account controls, global navigation and hosted context, but must preserve the approved pricing interaction hierarchy.
1. Calculator inputs, Advanced sections, result panels, pricing-method comparison, warnings, Show the Math and primary actions should use the same conceptual pattern.
1. Runtime-only controls must not clutter the shared pricing experience. Desktop file/import/licensing controls stay desktop; hosted account/tenant controls stay Slim.
1. If a Slim adaptation materially improves the shared pricing UX, the change must be intentionally applied back to Price Lab or explicitly documented as a hosted-only exception. Silent divergence is forbidden.

### 13.1 Approved Hosted Exceptions

- Slim global app navigation and account shell may differ from desktop shell chrome.
- Slim customer picker uses hosted Customers rather than Price Lab minimal local customer references.
- Slim Quote actions map directly into native Slim business records.
- Slim persistence messages may reflect network/server state; desktop messages may reflect local file/SQLite state.
- Slim permissions/capabilities may hide actions a logged-in role cannot use; desktop does not need tenant-role gating.

## 14. Desktop / Slim Parity Fixture Contract

**Purpose: A parity fixture represents logical pricing state, not database rows. It must be runnable in both products without sharing live databases or primary keys.**

### 14.1 Fixture Contents

- Fixture ID and human-readable scenario name.
- Calculator category identifier.
- Logical shop profile inputs.
- Logical category-profile inputs.
- Material/value fixture records referenced by stable conceptual keys.
- Calculator input values.
- Expected active pricing method or allowed method set.
- Expected warnings/assumptions where material.
- Engine identity/version expected for comparison.

### 14.2 Required Comparisons

**PARITY ACCEPTANCE CHECKLIST**

| DONE | ACCEPTANCE / RULE | DATE |
| --- | --- | --- |
| ☐ | Direct invested cost matches. | __________ |
| ☐ | Fully loaded cost matches. | __________ |
| ☐ | Each applicable pricing-method candidate matches. | __________ |
| ☐ | Selected selling price matches. | __________ |
| ☐ | Profit matches. | __________ |
| ☐ | Margin matches. | __________ |
| ☐ | Quantity discount result matches. | __________ |
| ☐ | Warnings/assumptions match in meaning. | __________ |
| ☐ | Category/profile usage matches. | __________ |
| ☐ | Engine identity/provenance matches. | __________ |
| ☐ | Show the Math evidence matches in meaning and amounts. | __________ |
| ☐ | Any intentional UI/storage difference is documented and does not alter price meaning. | __________ |

## 15. Contract Change and Versioning Rules

- Additive UI changes that do not alter calculator semantics may use the existing contract version.
- Breaking calculator input/result changes require an explicit new calculator contract version/freeze.
- Breaking snapshot changes require compatibility handling so historical saved calculations remain readable.
- Breaking package changes require updated package handoff rules and acceptance fixtures.
- Breaking Sales Document evidence changes require explicit mapping review for Slim Quote integration.
- Changes to shared portability require explicit SIGNGUY-DATA-PORTABILITY versioning; ordinary UI convergence does not justify a portability schema change.
- No product may silently reinterpret historical money, quantity, material or pricing-method meaning.

## 16. Required Module Convergence Workflow

| STAGE | OWNER | REQUIRED OUTPUT |
| --- | --- | --- |
| 1. Use / inspect module | Price Lab | Real-shop examples and usability notes. |
| 2. Refine module | Price Lab | Approved desktop UX/workflow. |
| 3. Freeze module rules | Price Lab + architecture docs | Layout/interaction/data contract for the module. |
| 4. Mirror module | Slim | Hosted tenant-scoped implementation using native Slim boundaries. |
| 5. Run parity fixtures | Both | Evidence that equivalent inputs produce equivalent pricing meaning/results. |
| 6. Correct drift | Whichever side drifted | Intentional convergence, not independent redesign. |
| 7. Mark complete | Project plan | Only after Price Lab approval + Slim mirror + parity acceptance. |

## 17. Explicitly Prohibited Convergence Patterns

- Copying the entire Price Lab SQLite schema into Slim as the hosted persistence model.
- Copying Electron IPC or filesystem code into Slim.
- Creating a second Slim Quote/Invoice subsystem solely for Price Lab.
- Writing calculator formulas in Slim React/Node code.
- Writing calculator formulas in Price Lab renderer code.
- Using browser-local storage as authoritative hosted pricing persistence.
- Sharing live Slim and desktop databases.
- Sharing sessions, password hashes, CSRF state, provider secrets or hosted auth state through Price Lab portability.
- Automatically converting every Price Lab desktop Sales Document into a Slim record without an explicit user handoff action.
- Letting UI styling convergence override tenant security, durability or historical snapshot rules.
- Building full SignGuy AI-only features into Slim under the excuse of convergence.

## 18. Phase 6A Module Ownership Matrix

| MODULE | PRICE LAB OWNER | SLIM OWNER | PARITY TARGET |
| --- | --- | --- | --- |
| Global Shell | Price Lab reference UX | Slim hosted adaptation | Visual/interaction family |
| Dashboard | Price Lab reference UX | Slim hosted data context | Terminology/action parity |
| Calculators | Price Lab UX + Engine contract | Slim hosted UI | Exact calculation parity |
| Saved Work | Price Lab UX | Slim tenant persistence | Behavior/snapshot parity |
| Packages | Price Lab UX | Slim tenant persistence | Engine evidence parity |
| Materials | Price Lab UX/Starter semantics | Slim hosted library | Selector/effective-value parity |
| Pricing Foundation | Price Lab setup UX | Slim tenant setup | Derived-rate parity |
| Guided Interview | Price Lab question/proposal UX | Slim hosted workflow | Proposal parity |
| Review Center | Price Lab review UX | Slim hosted workflow | Active-value parity |
| Benchmark | Price Lab V1 advisory UX | Slim hosted/future connected UX | Acceptance semantics parity |
| Sales Documents | Price Lab desktop records | Slim native Quote/Order/Invoice | Evidence mapping, not DB duplication |
| PDF/Branding | Price Lab reference design | Slim customer docs | Presentation principles |

## 19. Phase 6A Exit Gate

**PHASE 6A COMPLETION CHECKLIST**

| DONE | ACCEPTANCE / RULE | DATE |
| --- | --- | --- |
| ☐ | Both repositories document the shared ownership boundary. | __________ |
| ☐ | The Pricing Engine is explicitly the only formula authority. | __________ |
| ☐ | Price Lab desktop is explicitly the reference pricing UX until module approval. | __________ |
| ☐ | Slim hosted responsibilities are separated from desktop-only responsibilities. | __________ |
| ☐ | The list of modules that must exist in both products is approved. | __________ |
| ☐ | Sales Document → Slim Quote/Order/Invoice mapping is approved. | __________ |
| ☐ | No duplicate online Quote/Invoice system is planned. | __________ |
| ☐ | Saved Work / Package / Materials / Pricing Foundation ownership is defined. | __________ |
| ☐ | Calculator request/result contract is accepted as the shared pricing boundary. | __________ |
| ☐ | Parity fixture format and required comparisons are defined. | __________ |
| ☐ | Runtime IDs/database rows are not treated as shared cross-product identity. | __________ |
| ☐ | Data Portability is reserved for explicit versioned shared contracts only. | __________ |
| ☐ | Breaking-change/versioning rules are documented. | __________ |
| ☐ | Prohibited convergence patterns are documented. | __________ |
| ☐ | Rule accepted: no module is complete until Price Lab approval + Slim mirror + parity verification. | __________ |

## 20. Recommended Documentation Placement

- Price Lab repository: `docs/convergence/PRICE_LAB_SLIM_CONVERGENCE_ARCHITECTURE_V1.md`
- SignGuy Slim repository: equivalent copy or concise boundary reference pointing to the same approved contract.
- Future `PRICE_LAB_UX_CONTRACT_V1.md` should govern the frozen user experience after Phase 6R; this Phase 6A document governs architecture/ownership before that freeze.
- If the two copies ever disagree, stop convergence work and reconcile intentionally before proceeding.

## 21. Source Basis Used for This V1

- Price Lab README current checkpoint: Phase 5A-5D complete; shared authoritative pricing engine; local-first desktop ownership.
- Price Lab Phase 4 Calculator Contract Freeze V1: shared engine formula ownership, frozen category identifiers, request/result contracts, immutable snapshots, provenance and package handoff rules.
- Price Lab Phase 5A Sales Document Workspace: local Sales Document ownership, calculation/package-backed line evidence, conversion ancestry and immutable revision rules.
- SignGuy Slim Architecture Boundary: independent hosted app, tenant/auth/business-record/production/communication/employee/storage boundaries, one native Quote→Order→Invoice lifecycle, and separation from full MVP runtime.
- Printed dual-track convergence plan: finalize Price Lab module first, mirror in Slim, verify parity, then move on.

**APPROVAL**

| APPROVAL ITEM | DATE / INITIALS |
| --- | --- |
| Architecture & Ownership Rules V1 approved | ____________________________ |
| Ready to begin Phase 6B Shell & Visual System | ____________________________ |

### Project Notes / Decisions

____________________________________________________________________________________________
____________________________________________________________________________________________
____________________________________________________________________________________________
____________________________________________________________________________________________
____________________________________________________________________________________________
____________________________________________________________________________________________
____________________________________________________________________________________________
____________________________________________________________________________________________
