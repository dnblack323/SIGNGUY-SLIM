# Step 3 Select Alignment Tracker

This tracker records the SignGuy Select side of dual-track Step 3 after Price Lab PR #40.

## Lane Status

| Lane | Status | Evidence |
| --- | --- | --- |
| Price Lab Step 3 shell | Complete and merged | PR #40 merged with normal merge commit `120be7bb46c23a84b1b123a18ccba54cb451f2ad`; Price Lab main then recorded completion at `58271c0e47444779addb941762723f5afa4f5c0f`. |
| SignGuy Select Step 3 implementation and alignment | Implementation complete on this branch; review PR pending owner visual approval | This branch preserves Select's hosted navigation, Employee Portal, permissions, and richer business workflows while applying the final approved shared shell patterns where appropriate. |
| Owner visual review | Pending | Screenshots from the review build are required before merge approval. |

## Compare Before Changing

| Requirement | Existing implementation/evidence | Actual gap | Correction or reason no change is needed |
| --- | --- | --- | --- |
| Expenses | `docs/STEP3_EXPENSES_SALES_TAX.md`; `ExpensesPage`; backend expense records, receipt attachment support, filtering, summaries, backup coverage. | No functional Step 3 gap found. | No workflow rebuild. Existing implementation reused; ordinary bookkeeping notice retained. |
| Sales Tax tracking/reporting | `SalesTaxPage`; issued-invoice-basis reporting with monthly, quarterly, yearly, and custom filters. | No functional Step 3 gap found. | No tax workflow expansion; tax-filing limitations remain visible. |
| Home/dashboard refinements | `HomePage` uses real dashboard data, Monday-Friday important-week row, clocked-in widget, payments, attention, production focus, and widget preferences. | No functional Step 3 gap found. | Preserve approved Select Home features; no Price Lab dashboard transplant. |
| Sales navigation and Order workspace cleanup | `src/navigation.js` keeps Customers, Quotes, and Orders under the Sales area; Order Workspace remains full-width/deep-linked with dirty navigation protection. | No functional Step 3 gap found. | Preserve Select's area-based hosted shell and meaningful Order Workspace behavior. |
| Demo/sample data controls | Settings exposed optional demo-data controls backed by real `/dashboard/sample-data` storage. | Visible wording still used "Demo Data" and button labels differed from final Price Lab "Sample Data" language. | Renamed Settings controls to Sample Data, Add Sample Data, Remove Sample Data, and installed/not-installed status while preserving the existing backend contract and safe removal behavior. |
| Compact desktop header, tabs, and ribbons | Header, module tabs, and Orders/Calendar ribbons already use compact icon-over-label commands with subtle separators and no visible group labels. | Some simple contextual ribbons were ungrouped, making separator behavior less consistent than the final shared pattern. | Grouped simple Home, Customers, Quotes, Production, Employees, Time, Payroll, Employee Portal, Invoices, and Payments ribbons with the existing separator model. |
| Navigation and capability visibility | Navigation and route guards consume backend capabilities; Employee Portal and management areas remain role/capability gated. | No functional Step 3 gap found. | Preserve Select-specific navigation, permissions, and Employee Portal boundaries. |
| Natural scrolling | App shell uses one main content-stage scroll; Order Workspace and media overlays retain their existing focused scroll behavior. | No concrete Step 3 scrolling defect found in source inspection. | No layout rebuild; screenshot review remains required. |
| Technical diagnostics | Operational diagnostics are primarily backend/runbook/CLI surfaces. Settings exposed a storage quota panel and email-provider key status in ordinary settings flow. | Hosted quota/provider readiness are useful diagnostics but should not read as ordinary business setup clutter. | Consolidated quota and email-provider readiness into one collapsed Technical Details section under Settings. |
| Applicable final Price Lab shell/dashboard patterns | Select already uses compact header, tabs, icon-over-label ribbons, compact cards, real Home data, sample-data controls, and actionable empty/error states. | Final Price Lab wording and ribbon grouping needed small alignment; Price Lab dock/sidebar patterns are not appropriate for Select. | Applied bounded wording/grouping/diagnostic changes only; preserved Select's hosted shell, richer production system, and business-record ownership. |

## Boundaries Preserved

- Price Lab runtime code is unchanged by this Select branch.
- Step 4 Banner work, Foundation implementation, Step 6 Saved Work/Package Builder expansion, Step 11 full-app audit, Stripe, Webstores, Supply Room, onboarding expansion, and Stage 9 Meta/Facebook work remain future work.
- Select keeps native Customers, Quotes, Orders, Work Orders, Invoices, Payments, Expenses, Sales Tax, Employee Portal, Calendar, and role/capability permissions.
- No duplicate online Quote/Invoice subsystem was introduced.

## Verification Evidence

Screenshots were captured from an isolated local review tenant with Settings-installed sample data. The evidence files are intentionally left under `artifacts/` and are not part of the source commit.

| Screen | Evidence |
| --- | --- |
| Home with sample dashboard data | `artifacts/step3-select-shell-alignment/screenshots/home-sample-data.png` |
| Orders list with sample orders | `artifacts/step3-select-shell-alignment/screenshots/orders-list-sample-data.png` |
| Opened Order Workspace | `artifacts/step3-select-shell-alignment/screenshots/order-workspace-sample-data.png` |
| Quotes with sample quotes and grouped ribbon | `artifacts/step3-select-shell-alignment/screenshots/quotes-sample-data.png` |
| Invoices with sample invoice and grouped ribbon | `artifacts/step3-select-shell-alignment/screenshots/invoices-sample-data.png` |
| Sales Tax with sample invoice totals | `artifacts/step3-select-shell-alignment/screenshots/sales-tax-sample-data.png` |
| Settings Sample Data and collapsed Technical Details | `artifacts/step3-select-shell-alignment/screenshots/settings-sample-data-technical-details.png` |

The Codex in-app browser used for evidence exposes a fixed `1280x720` viewport in this run and did not provide a viewport resize API. Natural scrolling and compact shell access were inspected in that viewport; smaller-window evidence remains a visual-review item unless captured by CI/browser tooling in a follow-up.

## Verification Results

| Check | Result |
| --- | --- |
| Focused UI regression | `npm run test -- src/app.test.jsx` passed: 102 tests. Existing jsdom navigation warnings appeared. |
| Date-stable sample-data regression | `npm run test -- backend/src/services.test.js -t "adds tenant-scoped removable Home demo data once and refreshes dashboard summaries"` passed: 1 test, 156 skipped. The test now freezes time during the sample workweek so the existing `Next Up` assertion is not dependent on the calendar date when CI runs. |
| Repository migration check | `SIGNGUY_SLIM_DB_PATH=:memory: npm run backend:migrate` passed. |
| Lint | `npm run lint` passed with the existing React hook warnings and zero errors. |
| Full test suite | `npm run test` passed: 7 files, 467 tests. Existing jsdom navigation warnings appeared. |
| Exclusion guard | `npm run guard` passed. |
| Production build | `npm run build` passed. |
| Whitespace check | `git diff --check` passed. |

## Remaining Before Merge

- GitHub CI for the review PR must pass on the pushed branch.
- Owner visual review is still pending; this branch should remain unmerged until reviewed.
- A true smaller-window screenshot was not captured because the available Codex in-app browser surface was fixed at `1280x720` and exposed no viewport resize API.
