# Phase 0 Design Lock

Status: Phase 1 implemented (evidence foundation)  
Date: 2026-11-23  
Scope: Phase 1 evidence foundation

## Evidence artifact contract

Kinds:

- `dns`
- `rdap`
- `http`
- `tls`
- `screenshot`

Statuses:

- `ok`
- `partial`
- `failed`
- `skipped`

Every artifact stores:

- `org_id`, `brand_id`, `threat_id`
- `kind`, `status`
- `source_url`
- `storage_key` for binary artifacts
- `mime`, `bytes`, `sha256`
- `collector`, `collector_version`
- `metadata` JSON
- `collected_at`, `retention_expires_at`

One artifact per threat and kind. Refreshing evidence updates the existing row and overwrites the same storage key.

## Threat enrichment fields

Added to `brand_threats`:

- `threat_url`
- `canonical_domain`
- `risk_score`
- `confidence`
- `campaign_id`
- `enrichment_status`: `pending`, `running`, `complete`, `failed`
- `evidence_status`: `pending`, `partial`, `complete`, `failed`
- `first_seen`, `last_seen`, `resolved_at`
- `metadata`

## Job contract

Table: `jobs`

- `type`
- `payload`
- `status`: `pending`, `running`, `completed`, `failed`
- `attempts`, `max_attempts`
- `dedupe_key`
- `run_after`
- `locked_at`, `locked_by`
- `last_error`

Phase 1 job type: `threat.enrich` with payload `{ orgId, brandId, threatId }`.

## API contract

- `GET /api/brands/:brandId/threats/:threatId/evidence`
  - Returns `{ enrichment_status, evidence_status, enrichment_active, artifacts }`.
  - `enrichment_active` is true only while a `threat.enrich` job is queued or
    running; the UI polls only in that window.
- `POST /api/brands/:brandId/threats/:threatId/enrich`
  - Queues a refresh; returns `202 { queued: true }`.
- `GET /api/brands/:brandId/evidence/:artifactId`
  - Streams a stored binary artifact after org and brand checks.
  - Add `?download=1` to force an attachment (used for screenshot download).

## UX contract

- Threat rows show enrichment and evidence state.
- Each threat gets an evidence action.
- Evidence dialog shows:
  - Threat summary.
  - Collection state.
  - Artifact cards with kind, status, source, timestamp, hash.
  - Screenshot preview and download.
  - DNS, RDAP, HTTP, and TLS metadata.
- No AI assessment, upload requests, or sending in Phase 1.

## Configuration

- `EVIDENCE_DIR`: evidence storage root.
- `EVIDENCE_ENRICH_MAX_PER_SCAN`: maximum new threats enriched per scan; default 10.
- `EVIDENCE_RETENTION_DAYS`: provisional artifact retention window from collection; default 365. Final retention is 12 months after case closure in Phase 3.
- `JOB_WORKER_POLL_MS`: worker poll interval; default 1000.
- `CHROME_BIN` or `CHROMIUM_BIN`: optional local screenshot binary.
- `SCREENSHOT_ALLOW_LOCAL`: set to `1` before local Chrome capture is attempted; external service is preferred.
- `SCREENSHOT_SERVICE_URL`: optional external screenshot service.
- `SCREENSHOT_SERVICE_TOKEN`: optional bearer token for the screenshot service.
- `SCREENSHOT_SERVICE_WIDTH`, `SCREENSHOT_SERVICE_HEIGHT`: external service dimensions; default 1280x720.
- `SCREENSHOT_WIDTH`, `SCREENSHOT_HEIGHT`: local Chrome dimensions; default 1280x720.
- `SCREENSHOT_NO_SANDBOX`: set to `1` only inside a sandboxed container.
- `DISABLE_JOB_WORKER`: set `true` to stop the background worker.

## Phase 1 boundaries

Included:

- Schema and migrations.
- Job queue and worker.
- DNS, RDAP, HTTP, TLS, optional screenshot collection.
- Local private evidence storage.
- Auto-enqueue after scans and manual threats.
- Read-only evidence UI.

Deferred:

- AI triage.
- Upload requests.
- Takedown drafts and sending.
- Trial and billing.
- Object storage and retention cleanup.
