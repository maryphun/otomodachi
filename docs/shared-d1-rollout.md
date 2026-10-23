# Shared D1 reads: rollout and recovery

Prepared 2026-10-23. The current release configuration uses
`READ_MODEL_ENABLED=true`. The numbered setup sections below document the initial
rollout sequence, including its temporary disabled state; they are not instructions
to disable an already-active installation. Follow the recovery section for an
existing deployment.

## Ownership

| Location | Responsibility |
| --- | --- |
| Google Sheets / Apps Script | Original customer records, balances, visits, history, chip calculations, durable duplicate-request receipts and validation. |
| Existing `ATTENDANCE_DB` | Confirmed read-only copies of customers, today's visits, today's history and per-customer histories; publication timestamps and synchronization barriers. No chip arithmetic or financial transaction ledger is executed in D1. |
| Existing `QR_DB` | Permanent profile tokens and staff-controlled revocation. Existing links are preserved. |
| Browser | Static files, current screen state, recent-customer IDs only, and unresolved operation IDs needed to prevent duplicate requests. No persistent balances, histories, customer lists or attendance snapshots. |

The new tables are `read_model_blobs`, `read_model_state`, and
`read_model_pending_writes`. The last table contains synchronization metadata,
not chip amounts. The old `today_customer_presence` table is retained but is
not used or maintained by the new mode. Do not use it as a current attendance
report after activation.

## Before deployment

Arrange a quiet maintenance window. Close staff tabs and stop chip operations
and direct spreadsheet edits during the initial import and switch.
Back up the spreadsheet and note the current Worker and Apps Script deployment
versions. Do not alter or delete existing receipt sheets or QR tables.

Confirm that `WEBAPP_SPREADSHEET_ID` in the supplied script is the live shop
spreadsheet, and that the Apps Script project currently deployed at
`APPS_SCRIPT_URL` is that project. The project timezone should be Asia/Tokyo.
The app currently uses calendar midnight in Japan as the day boundary.

## 1. Cloudflare setup

No new database or paid plan is required. The existing binding is:

- `ATTENDANCE_DB`: `otomodachi-current-active-customer`
- Database ID: `e0d44928-aad0-4e73-8c8d-2b2f24b6ad19`

Apply the additive migration to the REMOTE database from the repository:

```powershell
npx.cmd wrangler d1 migrations apply ATTENDANCE_DB --remote
```

Create a new random secret of at least 32 bytes using a password manager. Store
the same value in Cloudflare's `READ_MODEL_SYNC_SECRET` and Apps Script's
`WEBAPP_READ_MODEL_SYNC_SECRET`. Do not reuse the staff PIN or paste the secret
into chat, source control, or command arguments.

Cloudflare dashboard: Workers & Pages > otomodachi > Settings > Variables and
Secrets > add `READ_MODEL_SYNC_SECRET` as a Secret. Alternatively, use the
interactive `npx.cmd wrangler secret put READ_MODEL_SYNC_SECRET`. Secret changes
can create a new deployment; do this during maintenance.

Build and deploy the updated Worker/frontend with `READ_MODEL_ENABLED` still
`false`. Review the diff before any Git push that automatically deploys main.

```powershell
npm.cmd run build
npx.cmd wrangler deploy
```

This exposes authenticated synchronization endpoints without switching reads.
Existing APPS_SCRIPT_SECRET, AUTH_PIN and AUTH_SESSION_SECRET stay unchanged.

## 2. Apps Script setup (owner action)

Replace only the webapp source file with the full content of
`appscript-full/Webapp用.txt` (identical to `appscript/Code.gs`). Do not add a
second copy or replace the separate daily-setup/onEdit scripts.

Add these Script Properties:

| Property | Value |
| --- | --- |
| `WEBAPP_READ_MODEL_SYNC_URL` | `https://otomodachi.otopo.workers.dev/internal/read-model/sync` |
| `WEBAPP_READ_MODEL_SYNC_SECRET` | The same new secret as Cloudflare's `READ_MODEL_SYNC_SECRET` |

Keep the existing `WEBAPP_API_SECRET` and QR-related properties intact.

Save, then Manage deployments > Edit the existing webapp deployment > New
version > Deploy. Keeping the same deployment preserves the `/exec` URL.
If a new deployment URL is created instead, update `APPS_SCRIPT_URL` in
Cloudflare, `wrangler.jsonc`, and the local `.dev.vars` override together.

From the Apps Script editor, select and run `runReadModelSync`. Approve the
required spreadsheet and external-request permissions. Its execution log reports
the source timestamp, resource count, `unverifiedCustomers`,
`unverifiedHistories`, and `historyWarnings`. It never adjusts chip balances or repairs records.

Deploy the updated Worker before sending the new warning-bearing snapshot format.
Keep `READ_MODEL_ENABLED=false` during staging. The history-warning UI is used by
the D1 read path; the legacy Apps Script history endpoint remains unchanged.

Do not activate until both unverified lists are empty and the import succeeds.
If IDs are reported, inspect those customers' master balance, daily rows,
change-log arithmetic/order, and pending receipts. Never clear a pending receipt
or change a balance merely to make validation pass.

`historyWarnings` is separate from the two blocking lists. It identifies gaps,
invalid old log rows, or historical ending balances that differ from the current
master. These do not invalidate a separately verified current balance. The old
logger captures visit-based observations, not a complete transaction ledger.
Staff see the approved warning and can expand sheet row/date/amount details;
customer profiles receive only a generic incomplete-history notice. Graphs do
not connect across identified gaps, invalid rows are not plotted, and loading
history never overwrites the current balance. Warnings clear on the next snapshot
when the corresponding source check passes. No original scripts, triggers, or
historical cells are changed by this reporting feature.

For investigation only, run `diagnoseReadModel` in the editor. It logs checks
without changing spreadsheet cells, timestamp properties, or D1.

Run `setupReadModelSync` once and approve trigger permissions. It adds:

- A five-minute reconciliation trigger.
- Installable edit/change handlers for this spreadsheet.

It does not replace existing onEdit or daily-setup triggers. Run setup using only
one owner account; Apps Script trigger visibility is account-specific. Confirm
the subsequent timed execution succeeds before activating.

## 3. Validate and activate

Before switching, inspect the remote D1 state:

```sql
SELECT business_date, source_updated_at, checked_at, dirty,
       invalidation_epoch, revision
FROM read_model_state WHERE id = 1;

SELECT request_id, action, customer_code, started_at
FROM read_model_pending_writes;
```

Expect today's Japan date, a recent `checked_at`, `dirty = 0`, a nonempty
revision, and no unresolved pending writes. Compare a sample of balances and
histories with the sheet, including recent re-entry visits and both reported
duplicate incidents. Do not manufacture a live deposit as a test.

Set `READ_MODEL_ENABLED` to the string `true` in `wrangler.jsonc` and deploy.
Keep the dashboard value consistent with the config; later deployments use
the config. For localhost, set the same value and the synchronization secret
in ignored `.dev.vars` if overriding environment variables there.

Reload every staff device. Older frontend write requests are rejected in the
new mode. New frontend startup removes legacy financial storage but preserves
unresolved operation IDs. Do not manually clear those IDs after a timeout.

Open one customer on two devices, check the same balance and attendance,
then observe the next legitimate staff operation. Confirm one Sheets change,
one receipt, synchronized D1 reads, and refresh on the other device. Check a
public QR page and history as well.

## Synchronization behavior and limits

- Reads use D1's primary, never a device-specific persistent data cache.
- A snapshot has a monotonic source timestamp, Japan business date, and a
  content revision. A separate `checked_at` records successful reconciliation
  even when nothing changed.
- Unchanged content reuses existing blobs. The exporter reads source ranges in
  bulk; it does not read the spreadsheet once per customer.
- An initial full import and later reconciliation still read the source data.
  Only changed content buckets are written to D1. This is not a Sheets change
  stream or a claim of zero Apps Script usage.
- Immutable content buckets are stored first. One conditional publication
  changes the visible manifest only when every referenced piece exists and
  the invalidation epoch is still current. No SQL transaction/batch API is used.
- Staff saves go to Sheets first. D1 is marked unavailable while the operation
  is unresolved. Confirmed results trigger a fresh source export; no failed
  synchronization retries a chip addition or withdrawal.
- A scheduled snapshot can resolve a lost chip-write response only from a
  matching completed Sheets receipt. Unknown entry/registration writes have
  no such receipt and require staff reconciliation; they are never auto-retried.
- Staff pages check for changes every 30 seconds while visible and when
  returning to the tab. Public profiles check every 60 seconds. Hidden tabs
  do not poll. These are bounded refresh intervals, not instantaneous push.
- Changed data during a draft hides the old view and requests a reload rather
  than silently submitting a stale form. Active network writes are not interrupted.
- Direct Sheets edits and unrelated scripts are not atomic with Cloudflare.
  Edit triggers can be delayed; script/API edits do not fire onEdit. The timed
  trigger reconciles them approximately every five minutes. There can be a
  window before Cloudflare learns of an external change. Complete instantaneous
  consistency requires all writers to participate in invalidation/sync.
- Snapshots older than ten minutes or from another Japan date are refused.
  After midnight, reads wait for a new-day snapshot instead of reusing yesterday.
- Current balances are checked against today's records when present and blocked
  for pending receipts, invalid amounts, or current-day conflicts. Blank master
  balances mean zero by shop policy; other malformed values remain blocked.
  List pages fail closed if a current record is unverified, preserving honest totals.
- Old log gaps are warnings, not proof that the current master balance is wrong.
  A manual three-month expiry is not synthesized into a transaction. Negative
  before-values are not automatically converted to positive. Invalid raw log
  amounts remain visible in staff warning details, not customer responses.
- Import guardrails: 8 MiB per snapshot and 1.5 MiB per content bucket. Actual
  production size, CPU, Apps Script runtime/trigger quotas, and D1 usage must be
  measured during the initial import. Free-plan capacity is not guaranteed.

## If a save or synchronization fails

### Overlapping trigger imports

`readModelOnChange` ignores `changeType: EDIT`, which is covered by
`readModelOnEdit`. Structural and format changes still synchronize.
If another trigger or a webapp write invalidates a snapshot while it is being
built, the Worker returns HTTP 409 with `reason: SNAPSHOT_CONFLICT`.
Apps Script rereads the current epoch through the authenticated `/epoch`
endpoint and rebuilds the snapshot from Sheets before retrying. There are at
most three publication attempts; retries never increment the epoch, replay a
chip transaction, or re-tag an old snapshot with a newer epoch. Continued
conflicts leave the usual read guards in place and report failure.

Internal import failures return fixed diagnostic reason codes. Apps Script
includes these codes in its error without logging raw response bodies, customer
records, URLs or secrets. A generic HTTP 503 from the previous version is not
enough to distinguish an overlap from validation or database failures.

Roll out the Worker endpoint changes before updating the Apps Script sync
functions. Both `appscript/Code.gs` and `appscript-full/Webapp用.txt` contain the
same updated script. Existing triggers do not need recreation. Saving the sync
functions updates Head trigger runs; the versioned Apps Script web deployment
is a separate operation. Verify a manual run and the next timed run, then
confirm D1 has a fresh `checked_at`, `dirty = 0` and no unresolved pending writes.
Local tests do not establish which Worker or Apps Script deployment is live.

Do not repeat the chip operation as a new request. Check Sheets, its receipt
sheet, and Apps Script Executions first. Once the source is verified, run
`runReadModelSync` to retry synchronization only.

For an unresolved entry/registration or a genuinely incomplete chip operation,
reconcile the source manually before removing its individual synchronization
barrier. Record the decision. Never delete all pending barriers. The source's
pending receipt must also be resolved deliberately; this implementation does
not automatically repair partially written spreadsheet records.

Do not simply disable the feature flag after operating in the new mode: the
legacy attendance table is no longer maintained. A rollback needs maintenance,
source verification, and rebuilding legacy attendance from the current sheet,
or retaining the new reads until synchronization is repaired. QR links and
receipt sheets must be preserved. Reverting Worker code never reverts Sheets.

## Read recovery in the browser

Temporary `READ_MODEL_UNAVAILABLE` or out-of-order read responses are retried
up to five times within the existing 15-second read budget. Writes are never
automatically retried. Confirmed chip saves remain in-flight through customer
readback, preventing a background status check from interrupting verification.

On background synchronization gaps, the screen pauses and automatically checks
again. An open transaction draft fetches the customer's latest verified balance
and attendance before resuming, preserving the entered amount. A day change or
an already-completed checkout closes the old checkout draft. Other views retain
the existing reload-on-change/visibility behavior. Unresolved receipt IDs are
never cleared by recovery, and real verification errors remain visible.

These browser changes require rebuilding/publishing the webapp only; no Apps
Script or D1 schema change is needed. They do not remove the server's dirty,
pending-write, stale-snapshot, or expected-balance checks.

## Local testing

Both D1 bindings explicitly use `remote: true`; `preview:worker` also uses
`wrangler dev --remote`. Localhost is NOT a sandbox for live customer data.
Use the automated tests for artificial chip operations, not the real database.

```powershell
npm.cmd test
npm.cmd run build
npx.cmd wrangler deploy --dry-run
```

The optional `tests/browser-read-model.mjs` uses Playwright and mocks every API
request. Set `PLAYWRIGHT_MODULE_PATH` to an installed Playwright package path
when it is not available as `playwright`, then run it with Node. It checks two
devices at mobile/tablet sizes and closes its temporary preview server.

The automated tests use artificial data and do not perform live chip operations.
Production deployment and Apps Script trigger verification are separate release
checks; passing local tests alone does not confirm the live setup.
