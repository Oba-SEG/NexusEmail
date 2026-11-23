# Ambient AI Evidence & Takedown Plan

Status: approved; Phase 1 implemented (evidence foundation)  
Date: 2026-11-23  
Product: Nexus Brand Protection (hosted Segbytes product)

## 1. Decision summary

Build an ambient evidence-and-takedown workflow, not an assistant.

- No chat, no prompt box, no "ask AI" surface.
- AI runs on events and writes structured artifacts to threats and cases.
- Deterministic collectors gather evidence. AI classifies, explains gaps, and drafts. AI never invents evidence.
- Humans approve every outbound takedown. No autonomous sends, DNS changes, registrar actions, or legal filings.
- Every claim in a draft links to an evidence artifact with source, timestamp, and hash.
- Extend the existing brand tables and UI. Do not build a second brand-protection system.
- One trial plus one complete package. Recommended: 14-day trial; Complete at $79/month, below the $89 ceiling.

Locked decisions:

| Decision | Locked value |
|---|---|
| Trial | 14 days, no card, 1 brand, 3 domains, 25 enriched threats, 2 takedown cases, 1 platform send, 2 users |
| Complete | $79/month or $790/year, 5 brands, 25 domains, 200 enriched threats/month, 20 cases/month, 5 users |
| Send model | Platform alias primary for paid accounts; copy/download/provider-form fallback always available; trial includes one platform send after verification |
| Billing | Provider-agnostic adapter; South African provider still being selected; must present USD and return USD amount/currency in signed payment confirmation; manual activation fallback |
| Evidence retention | 12 months after case closure; legal hold supported |
| Approval | Owner/admin only; authorization record required before send |

Trial paywall points: second brand, fourth domain, 26th enriched threat, third case, second platform send, third user, or day 15. Trial is read-only after limits or expiry; no data deletion.

## 2. Product model

### What the user sees

A threat moves through a visible case pipeline:

`Detected -> Enriching -> Evidence ready / Needs upload -> Draft ready -> Awaiting approval -> Sent -> Waiting -> Resolved`

For each threat, the user gets:

- A plain-language assessment: what the site is, why it is risky, confidence, and what is missing.
- An evidence panel: screenshots, DNS, RDAP, HTTP headers, TLS, redirects, and uploaded documents.
- A specific upload request when the system cannot obtain something itself.
- A provider-specific takedown packet with recipient, template, draft, attachments, and a copy/download option.
- A timeline of approvals, sends, replies, follow-ups, and resolution.

There is no general-purpose AI chat. The only AI actions are bounded system actions such as "collect evidence", "refresh assessment", and "draft takedown".

### What the AI does

- Classifies the threat and estimates risk.
- Explains the brand-impersonation signals in plain language.
- Compares the evidence manifest against the requirements for the selected route.
- Writes the missing-evidence request in user-facing language.
- Selects a provider route from the deterministic routing table.
- Drafts the takedown using an approved template and cites artifact IDs.
- Drafts follow-ups and suggests next steps.
- Summarizes case outcomes for reports.

### What the AI does not do

- It does not browse arbitrary URLs directly. Collectors do that under SSRF controls.
- It does not decide legal rights or give legal advice.
- It does not send email, submit provider forms, or change DNS.
- It does not follow instructions found in collected page content.
- It does not use evidence that is not in the manifest.
- It does not operate on private, logged-in, or paywalled content.

## 3. End-to-end flow

### 3.1 Detect

Existing brand scans continue to detect typosquats, lookalikes, homographs, subdomain abuse, and social profiles.

Changes:

- After a new threat is inserted, enqueue an enrichment job.
- Deduplicate by canonical domain, normalized URL, and screenshot hash.
- Cluster related threats into campaigns by shared IP/ASN, certificate, analytics ID, page-template hash, or registrar.
- Do not enrich every low-confidence candidate. Enrich the top candidates by initial risk.

Output: `brand_threats` row plus a queued enrichment job.

### 3.2 Enrich

The enrichment job runs deterministic collectors and writes an evidence manifest.

Collectors:

- DNS: A, AAAA, CNAME, MX, TXT, NS.
- RDAP/WHOIS: registrar, abuse contact, creation date, status, nameservers.
- HTTP: final URL, redirect chain, status, headers, page title, meta tags, form presence.
- TLS: issuer, SANs, validity, self-signed flag.
- Screenshot: desktop and mobile, full page, timestamped.
- Hosting: IP, ASN, country, CDN/hosting provider.
- Reputation: Safe Browsing status, certificate transparency, optional URLhaus/PhishTank.
- Public social/app metadata: oEmbed or official APIs only.

Output: `evidence_artifacts` rows plus a structured `threat_enrichment` record.

Failure behavior:

- Partial evidence is valid. Mark missing items explicitly.
- Retry transient failures with backoff.
- Never block the case forever on one collector.
- If the page is down, preserve the failure artifact with timestamp and HTTP error.

### 3.3 Assess

The AI produces a triage artifact:

- Threat type and brand-match explanation.
- Risk score and confidence.
- Impersonation signals: logo, copy, login form, payment form, urgency, contact details.
- Recommended route: registrar, host, CDN, social, app store, Safe Browsing.
- Evidence completeness and missing items.
- Suggested priority and SLA.

The artifact is stored, versioned, and visible in the UI. It is not a chat response.

### 3.4 Request missing evidence

The gap engine compares the manifest against the route's evidence requirements.

Examples of user-only evidence:

- Trademark registration certificate.
- Letter of authorization or power of attorney.
- Original phishing email with full headers (.eml).
- Screenshot of customer confusion or payment loss.
- Proof of account ownership for a social profile.
- Legal entity details and authorized signatory.

Flow:

1. AI writes the request in plain language, with the reason and an example.
2. System creates an `upload_request` with a secure, expiring link.
3. User sees an in-app task and receives an email.
4. User uploads files; system validates type, size, and malware.
5. Evidence manifest updates; the case moves to "ready" when requirements are met.

Output: `upload_requests` plus `evidence_artifacts` of kind `upload`.

### 3.5 Draft the takedown

The routing engine selects the target and template deterministically.

The AI fills the approved template with:

- Brand and target details.
- Evidence-backed facts only.
- Artifact citations for the reviewer, not necessarily in the outbound email.
- Correct recipient and required attachments.
- Placeholders for anything the user must confirm.

The draft is stored with a version, model, prompt version, input hash, and token/cost record.

The user can edit the draft directly. There is no free-text AI prompt. A "regenerate from updated evidence" action is allowed after new artifacts arrive.

### 3.6 Approve and send

Approval screen shows:

- Recipient and route.
- Evidence citations for every factual claim.
- Attachments.
- Template version.
- Authorization checkbox: "I confirm I am authorized to act for this brand."
- Send method: platform email, copy to clipboard, download .eml, or open provider form.

Rules:

- Owner/admin approval required.
- No send without a stored authorization record.
- First sends for a new brand may require manual review.
- High-risk routes (UDRP/ACPA, legal escalation) are not automated; they produce a packet for counsel.
- The platform never sends automatically after a scan.

Output: `takedown_cases` status `approved`, then `sent`.

### 3.7 Track and resolve

Case timeline records:

- Draft created/edited.
- Approved by whom and when.
- Sent method, message ID, recipient.
- Replies and inbound messages.
- Follow-up reminders.
- Rescan result: still live, removed, parked, or redirected.
- Resolution and outcome.

No automatic follow-up send. AI drafts the follow-up; a human approves it.

## 4. Evidence model

### 4.1 Automatically collected evidence

| Evidence | Source | Method | Use | Limits |
|---|---|---|---|---|
| Screenshot | Target page | Headless browser, desktop/mobile | Visual proof, brand use | Public pages only; no auth; no form submission |
| HTTP snapshot | Target page | GET, redirects captured | Status, headers, title, forms | Size/time caps; no downloads |
| DNS | Resolver | A/AAAA/CNAME/MX/TXT/NS | Hosting and mail clues | Cached with TTL |
| RDAP/WHOIS | RDAP | Registrar, abuse contact, dates | Route and evidence | Rate limited; redact unnecessary PII |
| TLS certificate | Target | Handshake | SANs, issuer, validity | Public endpoints only |
| Hosting/IP/ASN | RDAP/ASN lookup | IP ownership | Route to host/CDN | Cached |
| Reputation | Safe Browsing/CT | API or public data | Corroboration | Optional; record source |
| Social/app metadata | Official APIs | oEmbed/listing | Route and profile proof | No logged-in scraping |

### 4.2 User-uploaded evidence

- Trademark certificate or registration proof.
- Authorization letter / power of attorney.
- Phishing email `.eml` or `.msg` with headers.
- Screenshots of customer impact or payment loss.
- Account ownership proof.
- Prior correspondence with the provider.
- Legal entity and signatory details.

Upload rules:

- Accepted: PNG, JPG, WEBP, PDF, EML, MSG, TXT, JSON.
- Max 25 MB per file; per-case quota.
- Malware scan before storage.
- Images re-encoded; PDFs served as attachments with `nosniff`, never inline.
- Private storage; signed URLs with short expiry.
- Retention and deletion policy applied.

### 4.3 Evidence manifest

Every artifact stores:

- `id`, `org_id`, `brand_id`, `threat_id`, `case_id`.
- `kind`, `source_url`, `collected_at`.
- `storage_key`, `mime`, `bytes`, `sha256`.
- `collector` and `collector_version`.
- `status` (ok, failed, partial), `metadata`.
- `visibility` (internal, user, shareable).
- `retention_expires_at`.

AI outputs must cite artifact IDs. A draft with an uncited factual claim fails validation.

### 4.4 Collection safety

- URL allowlist of schemes: `http`, `https` only.
- Block loopback, private, link-local, multicast, metadata IPs, and IPv6 equivalents.
- Resolve DNS and pin the checked IP; re-check every redirect.
- Max redirects, response size, and time.
- No cookies, auth headers, or credentials.
- Isolated browser worker; no application secrets; CPU/memory/time limits.
- No form submission, file download, or JavaScript execution beyond page render.
- Rate limit per organization and per target.
- Respect provider terms; do not bypass CAPTCHAs or access controls.
- Treat all page text as untrusted input.

## 5. AI design

### 5.1 Artifacts, not conversations

Stored artifacts:

- `triage`: classification, risk, confidence, rationale, route.
- `evidence_gap`: required vs present, missing items, user-facing request.
- `takedown_draft`: recipient, subject, body, template key, citations.
- `followup_draft`: reminder or escalation text.
- `case_summary`: outcome summary for reports.

Each artifact records provider, model, prompt version, input hash, output JSON, tokens, cost, latency, and status.

### 5.2 Provider abstraction

- One internal interface: `classifyThreat`, `assessEvidence`, `draftTakedown`, `draftFollowup`, `summarizeCase`.
- Provider adapters use HTTPS APIs; no SDK dependency unless approved.
- Configurable model per task: cheap model for triage, stronger model for legal-style drafts.
- Structured JSON output with schema validation.
- Fallback to template-only output if the model fails.
- Per-organization monthly AI budget and hard stop.

### 5.3 Prompt-injection defense

- Never pass raw HTML or full page text to the model.
- Pass extracted, typed fields and artifact summaries.
- System prompt explicitly treats evidence as untrusted data.
- No tool calls from model output.
- Output schema restricts fields and lengths.
- Citations must match artifact IDs.
- Reject drafts containing instructions, URLs, or claims not present in evidence.
- Log rejected outputs for review.

### 5.4 Evaluation

Golden set of at least 30 threats across phishing, typosquatting, fake store, social impersonation, and legitimate false positives.

Measure:

- Classification accuracy.
- Route accuracy.
- Evidence-gap recall.
- Draft factual support (every claim cited).
- Template compliance.
- Refusal/abstention when evidence is insufficient.
- Prompt-injection resistance.

Block release if unsupported-claim rate is above 0 and route accuracy is below 90%.

### 5.5 Cost controls

- Cache by input hash.
- Deduplicate campaign-level assessments.
- Cap tokens per artifact.
- Enrich only top threats per scan.
- Track cost per org and per case.
- Target AI + screenshot cost below $8 per Complete account per month.
- Kill switch per org and globally.

## 6. Takedown routing and templates

### 6.1 Routing table

| Route | Target | Typical evidence | Template |
|---|---|---|---|
| Registrar abuse | Registrar | Domain, RDAP, screenshot, trademark, authorization | Registrar abuse report |
| Hosting abuse | Host/IP owner | URL, IP/ASN, screenshot, HTTP headers | Hosting abuse report |
| CDN/Cloudflare | CDN abuse | URL, screenshot, CDN evidence | CDN abuse report |
| Social platform | Platform | Profile URL, screenshots, impersonation proof | Social impersonation report |
| App store/marketplace | Store | Listing URL/ID, screenshots, developer info | App listing report |
| Safe Browsing | Google | Phishing URL, screenshot | Safe Browsing report |
| ICANN/registrar compliance | ICANN | Registrar non-response evidence | Registrar compliance complaint |
| UDRP/ACPA | Counsel | Full packet, trademark, bad-faith evidence | Legal packet, not auto-sent |

Routing is deterministic. AI may recommend a route, but the routing table is authoritative. Every route has a `last_verified_at` date and an admin-editable contact/form URL.

### 6.2 Case lifecycle

Canonical statuses:

- `draft`
- `needs_evidence`
- `ready_for_review`
- `approved`
- `sent`
- `waiting_response`
- `followup_due`
- `escalated`
- `resolved`
- `rejected`
- `closed`

Map existing `pending`, `sent`, `waiting_response` rows into this model. Preserve old values for display until migration is complete.

### 6.3 Sending and reply tracking

Decision: platform alias is the primary send path for paid accounts. Copy, download `.eml`, and provider-form submission remain available as fallbacks.

Platform alias design:

- Per-case address: `case+<case_ref>@takedowns.segbytes.xyz`.
- Outbound sender: `cases@takedowns.segbytes.xyz` with the brand name in the display name.
- `Reply-To` points to the case alias, not the customer's personal address.
- Inbound mail is forwarded to the customer and parsed by a webhook into the case timeline.
- `Message-ID`, `In-Reply-To`, and `References` are stored to keep threads intact.
- Dedicated subdomain with SPF, DKIM, DMARC, and bounce handling.
- Inbound adapter supports one provider at a time (Cloudflare Email Workers, Postmark Inbound, Mailgun Routes, or IMAP); no provider lock-in in the case model.
- If alias delivery or inbound parsing fails, the case falls back to copy/download and the UI says so.

Trial behavior:

- One platform send is allowed after brand/domain verification and terms acceptance.
- Further sends hit the paywall.
- First platform send may be manually reviewed to prevent abuse.

User-send fallback:

- Copy to clipboard.
- Download `.eml`.
- Open provider form with prefilled fields.
- User logs the send and replies manually.

Do not auto-send in any path. The alias exists to track authorized human-approved sends, not to automate outreach.

### 6.4 Legal review

- The eight templates are operational drafts, not legal advice.
- Counsel reviews each template, jurisdiction assumptions, and escalation language.
- No UDRP/ACPA filing automation.
- No DMCA/copyright claims unless a separate reviewed flow exists.
- Store template version and approval date.

## 7. Data model

### 7.1 Existing tables to evolve

`brand_threats` add:

- `threat_url`
- `canonical_domain`
- `risk_score`
- `confidence`
- `campaign_id`
- `enrichment_status`
- `evidence_status`
- `first_seen`
- `last_seen`
- `resolved_at`
- `metadata` (JSON)

`brand_takedowns` add:

- `threat_id`
- `case_ref`
- `target_role`
- `recipient_url`
- `template_key`
- `draft_subject`
- `draft_body`
- `draft_version`
- `approval_status`
- `approved_by`
- `approved_at`
- `send_method`
- `sent_message_id`
- `resolution_status`
- `next_followup_at`
- `authorization_id`
- `ai_artifact_id`

Keep `brand_takedown_replies`; add `message_id`, `raw_headers`, `source` if inbound parsing is added.

### 7.2 New tables

- `evidence_artifacts`: manifest rows and storage pointers.
- `upload_requests`: requested items, token hash, expiry, status.
- `takedown_events`: immutable timeline.
- `takedown_artifacts`: case-to-artifact links with role (proof, attachment, citation).
- `provider_routes`: route, provider, abuse email, form URL, requirements, template, last verified.
- `authorizations`: org, brand, signer, title, accepted_at, IP, user agent, text version.
- `ai_runs`: task, provider, model, prompt version, input hash, output, tokens, cost, status.
- `jobs`: background queue with attempts, run_after, lock, last error.
- `plans`: plan code, price, currency, limits.
- `subscriptions`: org, plan, status, period, provider IDs, amount, currency.
- `payment_events`: provider, event ID, type, org, amount, currency, raw payload, processed_at.
- `usage_counters`: org, period, metric, count.
- `trial_records`: org, started_at, ends_at, converted_at, abuse flags.

Use Postgres types consistent with the existing schema. If the database is SQLite in some environments, use `TEXT` for JSON and document the difference.

### 7.3 Migration and backfill

- Add columns nullable; no blocking rewrite.
- Backfill `case_ref` and statuses for existing takedowns.
- Existing `evidence` JSON remains readable; new evidence lives in artifacts.
- Existing takedowns are marked `legacy` and cannot be auto-sent.
- Provide a rollback script.
- Test migration against a copy of staging data.

### 7.4 Retention

- Evidence: 12 months after case closure.
- Uploads: 12 months; deleted on org deletion.
- AI artifacts: 24 months for audit, unless legal hold.
- Raw page text: minimize; store hashes and excerpts, not full HTML.
- Legal hold suspends deletion.
- Export packet available to the org.

### 7.5 Tenancy and authorization

- Every query scoped by `org_id`.
- Signed URLs are short-lived and org-checked.
- Owner/admin can approve/send and manage billing.
- Members can view, upload evidence, and edit drafts but cannot send.
- Platform admin access is audited.
- All approvals, sends, downloads, and admin overrides write audit events.

## 8. API and code changes

### 8.1 Current impact map

| Area | Current state | Change |
|---|---|---|
| `backend/src/services/brandScan.js` | Detects and inserts threats | Enqueue enrichment; dedupe; campaign clustering |
| `brand_threats` | Domain, type, severity, notes, status | Add URL, risk, confidence, enrichment/evidence state |
| `backend/src/routes/brandProtection.js` | `POST /:id/takedown` auto-sends | Split draft/approve/send; remove auto-send |
| `brand_takedowns` | Manual evidence text, flat case | Evolve into case record; link artifacts; timeline |
| `backend/src/services/brandProtection.js` | Basic email template | Replace with template engine and routing |
| `backend/src/services/notifications.js` | Generic notifications | Upload requests, approval notices, follow-ups, inbound alias |
| `frontend/components/dashboard/BrandsTab.tsx` | Manual takedown modal | Case workspace, evidence, uploads, draft review |
| `frontend/components/dashboard/ThreatAlertsTab.tsx` | Alert list | Deep-link to case; show evidence readiness |
| `backend/src/db/database.js` | Plan text, domain cap | Entitlements, trial, usage, billing |
| `backend/src/routes/domains.js` | `DOMAIN_CAP` env | Plan-based domain limit with env fallback |
| `frontend/components/dashboard/AdminPanel.tsx` | Displays plan | Plan/trial/usage override with audit |
| Infrastructure | No object storage or queue worker | Private bucket, queue worker, screenshot worker |

### 8.2 Backend modules

- `services/evidence/`: collectors, SSRF-safe fetcher, manifest writer.
- `services/ai/`: provider adapters, prompt versions, schemas, eval fixtures.
- `services/takedown/`: routing, templates, case lifecycle, approval.
- `services/uploads/`: validation, malware scan, storage, signed URLs.
- `services/entitlements/`: plan limits, trial, usage counters.
- `services/jobs/`: queue enqueue/claim/complete/retry.
- `routes/evidence.js`, `routes/uploads.js`, `routes/cases.js`, `routes/billing.js`.
- Extend `brandProtection.js` for case endpoints; keep brand list shape stable.

Suggested API surface:

- `POST /api/brands/:brandId/threats/:threatId/enrich`
- `GET /api/brands/:brandId/threats/:threatId/case`
- `POST /api/brands/:brandId/threats/:threatId/evidence/collect`
- `GET /api/evidence/:id/download`
- `POST /api/brands/:brandId/upload-requests`
- `POST /api/uploads/:token`
- `POST /api/brands/:brandId/takedowns/draft`
- `PATCH /api/brands/:brandId/takedowns/:id/draft`
- `POST /api/brands/:brandId/takedowns/:id/approve`
- `POST /api/brands/:brandId/takedowns/:id/send`
- `POST /api/brands/:brandId/takedowns/:id/events`
- `GET /api/billing/plan`
- `POST /api/billing/checkout`
- `POST /api/billing/webhook`
- `GET /api/usage`

The old `POST /api/brands/:id/takedown` should create a draft only. Document the behavior change and update the frontend in the same release.

### 8.3 Frontend

New components:

- `CaseWorkspace` with tabs: Summary, Evidence, Uploads, Draft, Timeline.
- `EvidencePanel`: artifact cards, source, timestamp, hash, preview.
- `UploadRequestCard`: requested items, reason, upload dropzone, status.
- `DraftReview`: rendered email, editable fields, citations, attachments, approval.
- `TrialBanner` and `UsageMeter`.
- `PlanPanel` in settings or billing.
- `ProviderRouteBadge` and `EvidenceCompleteness` indicators.

Remove or repurpose the current manual takedown modal. Keep the existing console design language and accessibility behavior.

### 8.4 Jobs and infrastructure

- Postgres-backed job queue; worker process alongside the API.
- Screenshot worker: Playwright in an isolated container, or an external screenshot service if operations cost is lower.
- Object storage: S3-compatible private bucket; local volume for development.
- Malware scanning: ClamAV sidecar or external scan API.
- Scheduler: enqueue enrichment after scans, follow-up reminders, retention cleanup, trial expiry.
- Observability: job failures, collector latency, screenshot failure rate, AI cost, upload errors.
- Feature flags: `AI_EVIDENCE_ENABLED`, `PLATFORM_SEND_ENABLED`, `INBOUND_EMAIL_ENABLED`, `BILLING_ENABLED`.

### 8.5 Admin and operations

- Platform admin can view org usage, set plan/trial, override limits, and disable AI for an org.
- Every override is audited.
- Provider route editor with last-verified date.
- Template editor with versioning and counsel approval status.
- Job dashboard for stuck/failed enrichments.
- Kill switches for AI, screenshots, uploads, and sending.

## 9. Trial and Complete package

### 9.1 Trial

Trial is deliberately enough to complete one full loop, not enough to run ongoing brand protection for free.

- 14 days.
- No card.
- 1 brand.
- 3 domains.
- 25 enriched threats.
- 2 takedown cases.
- 1 platform send.
- 2 users.
- All features, including evidence collection, upload requests, AI drafts, and case timeline.
- Sending requires verified brand/domain and accepted terms; first send may be manually reviewed.

Paywall points:

- Add a second brand.
- Add a fourth domain.
- Enrich threat 26.
- Open takedown case 3.
- Send platform takedown 2.
- Invite user 3.
- Day 15.

At a paywall, show the exact limit and the Complete plan; keep existing evidence and cases readable. Do not delete data. Do not auto-charge.

Trial success metric: user reaches a ready-to-send takedown packet within 10 minutes of adding a brand and completes at least one send.

Trial cost cap: under $3 per trial. Enforce by limiting enrichment and screenshots to the trial caps above.

### 9.2 Complete

Recommended:

- $79/month, or $790/year (two months free).
- 5 brands.
- 25 domains.
- 200 enriched threats per month.
- 20 takedown cases per month.
- 5 users.
- Daily scans, evidence collection, AI drafts, provider routing, case timeline, reports, email/Slack alerts.
- Platform alias sends and inbound reply tracking.
- 12-month evidence retention.

Add-ons, only if needed:

- Extra brand: $19/month.
- Extra 10 domains: $10/month.
- Extra 10 takedown cases: $29/month.

Keep one public plan. Do not create feature tiers that hide evidence or AI; that undermines the "complete" promise. Use limits and add-ons instead.

### 9.3 Entitlements and usage

- `organizations.plan` remains for display/backward compatibility.
- New `plan_code`, `trial_ends_at`, `subscription_status`.
- `entitlements` service checks limits before expensive actions.
- Soft limit: warn at 80%.
- Hard limit: block new enrichment/drafts with a clear upgrade message.
- Never delete existing evidence when a trial expires; make it read-only.
- Admin override for support and design partners.
- Usage reset per billing period; trial usage separate.

### 9.4 Billing

WHMCS integration was removed; there is no current billing provider. The provider is still being selected, so build against an adapter and a strict payment-confirmation contract.

Hard requirements for any South African provider:

- Presents prices in USD.
- Accepts Mastercard and Visa.
- Returns the USD amount and currency in the signed payment confirmation, not only a ZAR-converted amount.
- Supports recurring billing, cancellation, refunds, and receipts/invoices.
- Supports metadata for `org_id`, `plan_code`, and billing interval.
- Verifies webhook signatures and supports idempotent event IDs.
- Handles 3-D Secure/SCA.
- Can settle to the South African entity.
- Produces a customer-facing receipt showing the USD plan price.

If a provider accepts cards but only presents or confirms ZAR, it does not meet the $ pricing requirement. Do not use it for the USD plan unless the product explicitly shows an FX conversion and the confirmation still shows the USD plan price. A merchant-of-record provider remains the fallback if no South African provider meets the USD requirement.

Provider adapter interface:

- `createCheckout({ orgId, planCode, amount, currency, interval })`
- `verifyWebhook(rawBody, headers)`
- `mapSubscriptionStatus(event)`
- `cancelSubscription(subscriptionId)`
- `refundPayment(paymentId, amount)`

Payment confirmation contract:

1. Create checkout with `org_id`, `plan_code`, `amount=79.00`, `currency=USD`, `interval=month|year`.
2. On signed webhook, verify signature and event ID.
3. Verify `amount`, `currency`, `plan_code`, and `org_id` match the expected plan.
4. Store the raw event in `payment_events` before processing.
5. Activate or extend the subscription idempotently.
6. Write an audit event and send the receipt.
7. Reject mismatched amounts or currencies; alert operations.

Tables:

- `payment_events`: provider, event ID, type, org, amount, currency, raw payload, processed_at.
- `subscriptions`: provider customer/subscription IDs, plan, status, period, amount, currency.

Manual activation remains available for design partners and support. Every manual activation is audited.

Do not hard-code a provider into routes or UI. The checkout button calls the adapter; the webhook handler is provider-specific only at the edge.

### 9.5 Unit economics

Target:

- AI + screenshot + storage cost: under $8 per Complete account per month.
- Gross margin: above 80%.
- Support cost: under 20 minutes per account per month after onboarding.
- Trial cost cap: under $3 per trial.

Validate with real measurements before launch. If costs exceed the target, reduce enrichment depth or move screenshots to a cheaper worker.

### 9.6 Pricing validation

- Interview 10 mid-market/agency buyers.
- Test $69, $79, and $85 price points.
- Measure trial activation, first value time, conversion, and willingness to pay for extra brands.
- Do not launch with multiple public tiers; test behind landing pages.

## 10. UX details

### 10.1 Threat list

- Risk score and confidence.
- Evidence completeness: "6 of 8 collected".
- Status: "Needs your upload", "Draft ready", "Waiting on provider".
- Primary action: "Open case".
- Secondary: "Mark safe" and "Rescan".

### 10.2 Case workspace

- Header: domain, threat type, risk, route, owner.
- Summary: AI assessment with "Why this?" citations.
- Evidence: grouped artifacts, download/export.
- Uploads: requested items, secure dropzone, status.
- Draft: email preview, edit, attachments, approval.
- Timeline: every event, actor, timestamp.

### 10.3 Upload request

- Explain exactly what is missing and why.
- Show an example and accepted formats.
- Offer in-app upload and secure email link.
- Show malware scan and processing status.
- Allow resend and expiry extension.
- Never ask for passwords, private keys, or unnecessary PII.

### 10.4 Approval

- Two-step: review, then approve.
- Show all factual claims with citations.
- Require authorization checkbox.
- Offer send via platform alias, copy, download `.eml`, or open provider form.
- Show the remaining trial send or plan usage before approval.
- Confirm success with message ID and next step.

### 10.5 Trial and billing

- Persistent but unobtrusive trial banner with days left and usage.
- Upgrade page explains limits and what happens after trial.
- No dark patterns; no auto-charge without explicit consent.
- Clear "read-only after trial" behavior.

### 10.6 Accessibility

- WCAG 2.1 AA.
- Keyboard-operable case tabs and uploads.
- Status always text + icon, not color alone.
- Reduced motion for timeline animations.
- Accessible file input and error messages.

## 11. Security and compliance

### 11.1 SSRF and collection

- URL validation and DNS pinning.
- Block private, loopback, link-local, metadata, and IPv6 equivalents.
- Re-check redirects.
- No credentials or cookies.
- Isolated worker with egress limits.
- Time, size, and redirect caps.
- Rate limits per org and target.

### 11.2 Uploads

- Magic-byte validation, not just extension.
- Size and count limits.
- Malware scan before storage.
- Image re-encoding; PDF served as attachment.
- Private bucket; signed URLs; no public listing.
- Filename sanitization; no path traversal.
- Quarantine on scan failure.

### 11.3 Prompt injection

- Untrusted content never becomes instructions.
- Structured inputs only.
- No model tool calls.
- Output schema validation.
- Citation checks.
- Reject and log suspicious outputs.

### 11.4 Tenant isolation

- Every query scoped by org.
- Signed URL checks org and expiry.
- No cross-org artifact IDs.
- Tests for IDOR on evidence, uploads, cases, and billing.

### 11.5 Privacy and AI vendor

- Minimize PII sent to the model.
- Redact emails, phone numbers, and addresses where not needed.
- Use a provider with no-training/zero-retention terms.
- Document subprocessors in the privacy policy.
- Support data export and deletion.
- DPA available for customers.

### 11.6 Abuse prevention

- One trial per verified organization.
- Email/domain verification.
- Rate limits on scans, uploads, and sends.
- Manual review for first sends and high-volume accounts.
- Terms prohibit false or bad-faith claims.
- Audit trail for every approval and send.

### 11.7 Legal

- Templates reviewed by counsel.
- No legal advice; product provides operational drafting.
- UDRP/ACPA and copyright flows are out of scope until reviewed.
- Evidence export supports chain-of-custody needs.
- Retention and legal hold documented.

## 12. Delivery plan

Estimates assume one backend/full-stack engineer plus part-time design/legal support. Adjust for team size.

### Phase 0: Decisions and design (3-5 days)

- Confirm pricing, trial limits, send model, billing provider, retention.
- Finalize schema and API sketch.
- Wireframe case workspace and upload flow.
- Start legal review of templates.
- Build cost model.

Exit: signed-off decisions and wireframes.

### Phase 1: Evidence foundation (2 weeks)

- Migrations for evidence, jobs, enrichment fields.
- SSRF-safe fetcher, DNS, RDAP, HTTP, TLS collectors.
- Screenshot worker and private storage.
- Enqueue enrichment after scan.
- Evidence panel read-only.
- Feature flag for internal org.

Exit: a threat shows a real evidence manifest and screenshot in staging.

### Phase 2: AI assessment and uploads (2 weeks)

- AI provider abstraction and schemas.
- Triage and evidence-gap artifacts.
- Upload requests, secure upload, malware scan.
- Case workspace summary/evidence/uploads tabs.
- Golden-set evaluation harness.

Exit: missing evidence produces a user-facing upload request; AI assessment cites artifacts.

### Phase 3: Takedown packets and approval (2 weeks)

- Routing table and template engine.
- Draft generation and editing.
- Approval, authorization, send/copy/download.
- Platform alias outbound identity, SPF/DKIM/DMARC, inbound adapter, reply forwarding.
- Remove auto-send; migrate existing takedowns.
- Case timeline and manual reply logging.
- Audit events.

Exit: a complete case can go from threat to approved packet, send through the platform alias, and receive a parsed reply without any automatic send.

### Phase 4: Trial, plan, billing (1-2 weeks)

- Plans, subscriptions, usage counters, entitlements.
- Trial banner and limits.
- Checkout and webhook (or manual activation for design partners).
- Admin overrides and usage view.
- Upgrade/read-only behavior.

Exit: a new org can start a trial, hit limits, and upgrade.

### Phase 5: Hardening and beta (1-2 weeks)

- Security tests: SSRF, uploads, IDOR, prompt injection.
- Load test screenshot/enrichment queue.
- Legal review complete.
- 5 design-partner beta.
- Metrics and cost review.
- Launch checklist.

Exit: beta feedback resolved; launch approved.

Total: roughly 9-11 weeks. Billing provider, inbound email provider, DNS/email identity, and legal review are the main external dependencies.

## 13. Metrics and acceptance

Product:

- Threat to evidence-ready: under 2 minutes p95.
- At least 90% of enriched threats have screenshot + DNS + RDAP.
- At least 95% of drafts have every factual claim cited.
- Zero outbound sends without approval.
- Trial first value under 10 minutes.
- Upload request completion above 60%.

Business:

- Trial-to-paid conversion target 15-25%.
- Gross margin above 80%.
- AI + screenshot cost under $8 per Complete account per month.
- Churn and expansion tracked by brand/domain usage.

Security:

- No SSRF bypass in test suite.
- No cross-tenant artifact access.
- All uploads scanned.
- All approvals and sends audited.

## 14. Risks and mitigations

| Risk | Mitigation |
|---|---|
| AI hallucinates a claim | Deterministic evidence, citation validation, human approval, template constraints |
| Prompt injection from target page | Structured inputs, no tool calls, schema validation, reject suspicious outputs |
| Legal exposure from templates | Counsel review, no legal advice, no UDRP automation, authorization records |
| Trial abuse | Verified org/domain, limits, manual review, rate limits |
| AI cost overrun | Model tiering, caching, caps, per-org budget, kill switch |
| Screenshot failures/evasion | Multiple collectors, retries, manual upload fallback, timestamped failures |
| Provider contacts stale | Last-verified dates, admin editor, fallback forms, AI recommendation only |
| Platform alias deliverability | Dedicated subdomain, SPF/DKIM/DMARC, bounce handling, inbound adapter, copy/download fallback |
| Inbound reply parsing | Provider adapter, raw message storage, manual correction, monitoring |
| Billing provider cannot present USD | Reject providers that only confirm ZAR; require USD amount/currency in webhook; merchant-of-record fallback |
| Storage/privacy | Private bucket, signed URLs, retention, minimization, DPA |
| Scope creep | One plan, phased delivery, feature flags, explicit out-of-scope list |

## 15. Open decisions

Locked:

- Send model: platform alias primary; user-send fallback; one trial platform send.
- Trial: 14 days / 1 brand / 3 domains / 25 threats / 2 cases / 1 send / 2 users.
- Complete: $79/month / 5 brands / 25 domains / 200 threats / 20 cases / 5 users.

Still open:

1. Final South African billing provider and written confirmation that it presents USD and returns USD amount/currency in the signed webhook.
2. Evidence retention: 12 months after closure, or longer for legal?
3. AI provider and monthly budget.
4. Screenshot infrastructure: self-hosted Playwright or external service.
5. Approval policy: owner/admin only, and whether first paid send also needs manual review.
6. Legal review owner and target date.
7. Whether annual pricing is $790 or a different discount.
8. Whether the trial send is manually reviewed before delivery.

## 16. Immediate next steps

1. Send billing providers the USD confirmation requirement and collect written answers.
2. Approve Phase 0 and the locked trial/Complete defaults.
3. Finalize the schema migration and API contract.
4. Start legal review of the eight templates.
5. Build the Phase 1 evidence foundation behind a feature flag.
