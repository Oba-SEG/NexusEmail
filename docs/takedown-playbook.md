# Takedown Playbook and User Templates

**Date:** 23 November 2026  
**Purpose:** Operational templates and routing guidance for brand-impersonation, phishing, counterfeit, and fake-app takedowns in Nexus Brand Protection.

> **Not legal advice.** These are operational abuse-notice templates, not legal complaints. Have counsel review them before customer use. Only assert rights you own or are authorized to represent. Do not send legal demands, DMCA notices, or UDRP/ACPA claims without counsel.

## 1. Principles

1. **Report facts, not conclusions.** Describe what the page does, not who you think is behind it.
2. **Lead with the harm the provider can verify fastest.** For credential or payment theft, lead with phishing/fraud. Do not lead with a trademark essay.
3. **One ask per notice.** Suspend the domain, remove the content, remove the account/listing, or forward to the host.
4. **One notice per provider.** Registrar, host, CDN, search, and platform control different layers.
5. **Preserve evidence before reporting.** Pages change, redirect, geoblock, or disappear.
6. **Use UTC timestamps.** Include first seen and last confirmed live.
7. **Defang URLs in prose** (`hxxps://evil[.]example/path`), but paste the live URL into URL fields when a form requires it.
8. **Never submit real credentials, card data, or victim data.** A screenshot of the empty form is enough. Do not place test orders or download malware.
9. **Human approval before sending.** The product may draft and assemble; the user sends or approves.
10. **Track the case.** Receipt confirmation, follow-ups, outcome, and re-scan are part of the workflow.

## 2. Classify the abuse first

| Abuse | Primary route | Notes |
|---|---|---|
| Phishing / credential or payment harvest | Registrar, host, CDN, Safe Browsing | Lead with user harm; include exact URL and form behavior |
| Lookalike domain, no live content | Registrar | Domain-level suspension; include registration and brand evidence |
| Brand impersonation on social | Platform impersonation/IP form | Official handle, screenshots, copied assets |
| Counterfeit marketplace listing | Marketplace IP program | Trademark registration usually required |
| Fake mobile app | App store IP/impersonation form | App ID/package, developer, official app link |
| Cloned website content | Host; copyright route if copyrighted | DMCA only for copyright, not trademark |
| Trademark domain dispute | UDRP or court | Counsel; domain transfer/cancellation only under UDRP |
| Compromised legitimate site | Host and site owner | Registrar suspension may cause collateral damage; ask for content removal |
| Email account abuse | Email provider | Full EML/headers required |

## 3. Evidence pack

Build one pack per case, reuse it across providers.

### A. Case header

- Case ID and date (UTC)
- Reporter name, role, organization, monitored reply-to email
- Brand and official apex domain(s)
- Target URL(s), including path and query string
- Apex domain and registrar
- Hosting IP, ASN, and provider
- First seen (UTC) / last confirmed live (UTC)
- Requested action
- Authorization: brand owner or authorized agent (LOA attached)

### B. One-screen summary (5–8 lines)

- What the page claims to be
- How it differs from the official site (domain, certificate, login/payment ask)
- What it collects or sells
- Why it is live phishing, impersonation, or counterfeiting — facts only
- Known customer harm, if verified
- Campaign context, if related domains/accounts are known

### C. Visual evidence

- Full-page screenshot with the browser address bar and URL visible
- Timestamp or watermark with UTC date/time and URL
- Desktop and mobile views if behavior differs
- Close-ups of logo, form, payment instructions, or copied assets
- Page title and meta description
- HTML excerpt or DOM hash; note cloaking or geoblocking
- Third-party capture: urlscan.io (unlisted) or an archive link
- Official brand page for comparison

### D. Infrastructure evidence

- RDAP/WHOIS snapshot: registrar, creation date, nameservers, status
- DNS: A/AAAA, CNAME, MX, TXT where relevant
- IP and ASN; hosting provider; CDN/proxy in front
- TLS certificate subject, issuer, validity dates
- Redirect chain and final destination
- HTTP response headers
- If email was used: original EML/MSG/MBOX with full headers, plus body

### E. Rights and authorization

- Trademark registration (number, office, classes) if asserting trademark
- Official website and official social/app handles
- Letter of authorization if an agency or reseller is reporting
- For copyright: proof of ownership of the copied work

### F. Discovery and campaign context

- How it was found (new-domain monitoring, certificate transparency, customer report, social search)
- First seen and last checked
- Related domains, certificates, IPs, accounts, or payment endpoints
- Blocklist status (Google Safe Browsing, urlscan, VirusTotal)
- Distribution sample: phishing email, SMS screenshot, ad, QR code

### G. Attachments index

List filenames, sizes, and SHA-256 hashes. Keep originals; do not overwrite screenshots.

## 4. Routing matrix

| Layer | How to find it | What it can do | Evidence that matters |
|---|---|---|---|
| Registrar | ICANN Lookup / RDAP | Suspend domain (`clientHold`), lock, or investigate | Domain, exact URL, brand impersonated, screenshot with URL/time, full email headers if email |
| Registry | ICANN TLD listings | Act on large-scale or multi-registrar DNS abuse | Same as registrar, plus pattern/scale evidence |
| Hosting provider | IP WHOIS / ASN | Remove files, suspend hosting account | Exact URL/path, server IP, page behavior, compromised-vs-malicious note |
| CDN / reverse proxy | IP/ASN, headers | Forward report to host/operator; remove only content it hosts | Specific URL (not just domain), category, evidence |
| Search | Google Safe Browsing / legal removal | Warning interstitial, delisting, legal removal | Exact URL, phishing/impersonation evidence, trademark for legal route |
| Social platform | In-app report or IP form | Remove account, posts, ads | Profile/post URLs, official handle, screenshots, trademark/LOA |
| App store | Store IP/impersonation form | Remove or disable app | App ID/package, developer, official app, copied assets, trademark |
| Marketplace | Brand Registry / infringement form | Remove listing, suspend seller | ASIN/listing URL, trademark, evidence of counterfeit/confusion |
| Email provider | Abuse form | Remove account/message | Full EML/headers, body, recipient report |
| ICANN | Contractual Compliance complaint | Enforce registrar/registry obligations | Prior registrar report, receipt, all correspondence, gTLD only |
| UDRP / court | WIPO/NAF or counsel | Transfer/cancel domain; court remedies | Trademark rights, confusing similarity, no legitimate interest, bad faith |

### Provider-specific notes

- **Cloudflare:** use the abuse form at `abuse.cloudflare.com` and select **Phishing & Malware** for phishing, or **Registrar** for registrar issues. Cloudflare generally cannot remove content it does not host; it forwards reports to the site operator and hosting provider and supplies the origin IP. Reports must identify a specific URL, not only a domain. Registrar reports can also go to `registrar-abuse@cloudflare.com`, but the form is preferred. [Cloudflare reporting abuse](https://www.cloudflare.com/trust-hub/reporting-abuse/), [complaint types](https://developers.cloudflare.com/fundamentals/reference/report-abuse/complaint-types/), [abuse approach](https://www.cloudflare.com/trust-hub/abuse-approach/).
- **Registrars (gTLDs):** ICANN’s 2024 DNS Abuse Amendments require registrars to publish an abuse contact, confirm receipt, and promptly mitigate actionable DNS abuse. Actionable evidence includes a screenshot showing the phishing attempt and brand, plus the complete URL. Registrars must consider collateral damage, especially for compromised domains and subdomains. [ICANN advisory](https://www.icann.org/en/contracted-parties/advisories/documents/advisory-compliance-with-dns-abuse-obligations-in-the-registrar-accreditation-agreement-and-the-registry-agreement-05-02-2024-en).
- **ICANN escalation:** only for gTLDs, and only after reporting to the registrar/registry and allowing reasonable time. Include the prior report, receipt, evidence, and all correspondence. Do not report one abuse type to the registrar and a different one to ICANN. [ICANN guide](https://www.icann.org/en/system/files/files/submitting-dns-abuse-complaints-icann-guide-17nov25-en.pdf).
- **Google:** use the Safe Browsing phishing form for malicious pages; use the Legal Help Center for trademark removal from Google products. These are separate paths. [Safe Browsing](https://safebrowsing.google.com/safebrowsing/report_phish/), [legal removal](https://support.google.com/legal/answer/3110420).
- **Social:** Meta/Instagram, X, LinkedIn, TikTok, and YouTube each have impersonation and IP routes. Use the route that matches the harm: impersonation for fake accounts, trademark for copied marks, copyright for copied media, fraud for payment/data requests. [Instagram impersonation](https://help.instagram.com/1291391774792379), [TikTok impersonation](https://support.tiktok.com/en/safety-hc/report-a-problem/report-an-impersonation-account), [Meta IP](https://www.meta.com/help/policies/3234337743488413/).
- **App stores:** Apple uses App Store Content Dispute, App Name Dispute, and Report an app; Google Play separates impersonation flags from trademark/copyright forms and warns that the wrong form can delay processing. [Apple disputes](https://www.apple.com/legal/intellectual-property/dispute-forms/app-store/), [Google Play impersonation](https://support.google.com/googleplay/android-developer/answer/16341334).
- **Amazon:** Brand Registry’s Report a Violation tool for enrolled brands; public infringement form for rights owners not enrolled. [Amazon reporting](https://sell.amazon.com/blog/report-a-violation-to-amazon).
- **Email evidence:** many registrars require the original email in EML/MSG/MBOX with full headers; screenshots and PDFs can be altered and may be rejected. Attach the original message, not just a screenshot. [Rapid7 evidence guide](https://docs.rapid7.com/threat-command/evidence-best-practice-guidelines/), [RRSG effective reports](https://rrsg.org/wp-content/uploads/2025/03/Effective-DNS-Abuse-Reports-2025.pdf).
- **Legal routes:** DMCA is for copyright, not trademark. UDRP requires trademark rights, confusing similarity, no legitimate interest, and bad faith; remedies are transfer or cancellation. ACPA is federal court litigation with damages/injunctive relief. Use counsel. [UDRP vs ACPA](https://www.tuckerup.com/blog/udrp-vs-acpa-cybersquatted-domain-name/).

## 5. Templates

Replace `{PLACEHOLDERS}`. Remove any statement you cannot support. Keep the live URL in URL fields; defang it in prose.

### Template A — Registrar phishing / domain suspension

**Subject:** `[Phishing] {Brand} impersonation on {domain} — live {credential|payment} harvest`

```text
To: {registrar abuse contact or form}
Subject: [Phishing] {Brand} impersonation on {domain} — live {credential|payment} harvest

Reporter: {Name}, {Role}, {Company}
Reply-to: {monitored email}
Brand / official domain: {Brand} / {official domain}
Target URL: {live URL}
Apex domain: {domain}
Registrar: {registrar}
First seen (UTC): {YYYY-MM-DD HH:MM}
Last confirmed live (UTC): {YYYY-MM-DD HH:MM}
Requested action: Suspend the domain / disable DNS resolution for the abusive name.

Summary:
This domain is impersonating {Brand} and is being used for {credential phishing / payment fraud}. The page at the URL above copies {login page / brand assets / checkout flow} and asks visitors for {passwords / card data / one-time codes}. It is not operated or authorized by {Brand}.

Evidence attached:
1. {case-id}-screenshot-{timestamp}.png — full page with URL bar and UTC timestamp
2. {case-id}-rdap-{domain}.json — registration record
3. {case-id}-dns-{domain}.txt — A/AAAA/CNAME/MX records
4. {case-id}-tls-{domain}.txt — certificate subject/issuer/validity
5. {case-id}-email.eml — original phishing email with full headers (if applicable)
6. {case-id}-authorization.pdf — letter of authorization (if agent)

I am authorized to report on behalf of {Brand}. Please confirm receipt and provide a case ID. I can supply additional evidence or a live capture on request.

{Name}
{Company}
{Email} | {Phone}
```

### Template B — Hosting provider content removal

**Subject:** `[Abuse] Phishing content hosted at {IP} — {domain}{path}`

```text
To: {host abuse contact or form}
Subject: [Abuse] Phishing content hosted at {IP} — {domain}{path}

Reporter: {Name}, {Role}, {Company}
Brand / official domain: {Brand} / {official domain}
Target URL: {live URL}
Resolved IP: {IP}
ASN / hosting provider: {ASN} / {provider}
First seen (UTC): {timestamp}
Last confirmed live (UTC): {timestamp}
Requested action: Remove or disable the abusive content and review the hosting account.

The URL above serves a page impersonating {Brand} and collects {credentials / payment data}. The page is {hosted directly on your network / on a domain that appears compromised}. If the domain owner is not the actor, please notify them to clean the specific path rather than suspending unrelated legitimate content.

Evidence attached:
1. Screenshot with URL bar and UTC timestamp
2. HTTP response headers and redirect chain
3. Page source/DOM hash
4. urlscan.io or archive capture link
5. DNS/RDAP and certificate snapshot
6. Original phishing email with full headers, if applicable

Please preserve relevant access logs for this URL and confirm receipt. I am authorized to act for {Brand}.

{Name}
{Company}
{Email} | {Phone}
```

### Template C — Cloudflare / CDN report body

Use the Cloudflare abuse form and select **Phishing & Malware**. This is body text, not an email substitute.

```text
Category: Phishing & Malware
Brand impersonated: {Brand}
Official domain: {official domain}
Target URL: {live URL}
Apex domain: {domain}
First seen (UTC): {timestamp}
Last confirmed live (UTC): {timestamp}

The URL above is an active phishing page impersonating {Brand}. It copies {login/checkout} and collects {credentials/payment data}. The page is not authorized by {Brand}.

Attached: screenshot with URL bar and UTC timestamp; RDAP; DNS; TLS certificate; page source; original phishing email with full headers if available.

Requested action: Forward to the origin host and site operator; disable access if Cloudflare hosts the content. If Cloudflare is the registrar, please also review under the Registrar category.
```

### Template D — Social media impersonation

**Subject:** `[Impersonation] Fake {platform} account posing as {Brand}`

```text
To: {platform impersonation/IP form}
Subject: [Impersonation] Fake {platform} account posing as {Brand}

Reporter: {Name}, {Role}, {Company}
Brand: {Brand}
Official handle(s): {official handles}
Impersonating account: {profile URL}
Display name / handle: {name} / {handle}
First seen (UTC): {timestamp}
Last confirmed live (UTC): {timestamp}
Requested action: Remove the impersonating account and its content.

The account presents itself as {Brand} using our name, logo, and {copied assets}. It is contacting users and directing them to {URL / payment request / credential form}. Our official account is {official handle}. The account is not authorized by us.

Evidence attached:
1. Profile and post screenshots with timestamps
2. Side-by-side with official account
3. Copies of messages/posts showing customer confusion or payment requests
4. Trademark registration or LOA (if asserting trademark)
5. Destination URL capture

I am authorized to act for {Brand}. Please confirm receipt and the outcome.

{Name}
{Company}
{Email}
```

### Template E — App store / marketplace IP complaint

**Subject:** `[Trademark/Impersonation] Listing "{listing name}" infringes {Brand}`

```text
To: {store/marketplace IP form}
Subject: [Trademark/Impersonation] Listing "{listing name}" infringes {Brand}

Rights owner: {Brand / legal entity}
Reporter: {Name}, {Role}, {Company}
Official app/store listing: {official URL}
Infringing listing: {URL}
App ID / package name / ASIN: {identifier}
Developer / seller: {name}
First seen (UTC): {timestamp}

The listing uses {Brand}'s name, logo, screenshots, and/or product imagery without authorization and is likely to confuse users into believing it is official. It directs users to {payment page / download / support channel} that we do not operate.

Requested action: Remove or disable the listing and review the developer/seller account.

Evidence attached:
1. Dated screenshots of the listing
2. Comparison with the official listing
3. Trademark registration number/office (if asserting trademark)
4. LOA if an agent is reporting
5. Evidence of user confusion or fraudulent payment/download flow

I declare that I am the rights owner or authorized to act on the owner's behalf, and the information in this notice is accurate.

{Name}
{Company}
{Email}
```

### Template F — Search / Safe Browsing

**Safe Browsing body:**

```text
URL: {live URL}
Brand impersonated: {Brand}
Official domain: {official domain}
Observed (UTC): {timestamp}
What the page does: copies {Brand} {login/checkout} and collects {credentials/payment data}.
Evidence: {urlscan/archive link}; screenshot attached.
Requested action: Add the URL to Safe Browsing.
```

For trademark removal from Google Search or other Google products, use the Legal Help Center trademark route. Do not use the phishing form as a substitute for a legal notice.

### Template G — ICANN escalation (gTLDs only)

**Subject:** `[ICANN complaint] Registrar did not act on actionable phishing report — {domain}`

```text
To: ICANN Contractual Compliance (Abuse/DNS Abuse — Registrar)
Subject: [ICANN complaint] Registrar did not act on actionable phishing report — {domain}

Complainant: {Name}, {Role}, {Company}
Brand: {Brand}
gTLD domain(s): {domain}
Registrar: {registrar}
Registrar abuse report submitted (UTC): {date/time}
Registrar case ID / receipt: {ID or "no receipt received"}
Follow-up sent (UTC): {date/time}
Requested action: {suspension / mitigation}

Summary:
The domain is being used for phishing against {Brand}. The registrar received actionable evidence on {date}, including the exact URL, a screenshot showing the phishing page and impersonated brand, and {email headers / other evidence}. As of {date}, the abuse remains live.

Attached:
1. Original abuse report and receipt
2. All correspondence with the registrar
3. Screenshot with URL bar and UTC timestamp
4. RDAP/WHOIS and DNS records
5. Evidence of brand authorization

I am authorized to act for {Brand}. Please confirm receipt and advise on next steps.
```

Only escalate after giving the registrar reasonable time. ICANN has no authority over ccTLDs or content hosts.

### Template H — UDRP / legal escalation checklist

Do not send a UDRP complaint or legal demand without counsel. Prepare:

- Trademark registration and chain of title
- Domain and registrant details
- Evidence of confusing similarity
- Evidence of no rights or legitimate interests
- Evidence of bad faith: impersonation, commercial gain, sale offers, pattern, concealment
- First-use and registration dates
- Customer confusion and harm evidence
- Desired remedy: transfer or cancellation
- Forum, filing fees, and timeline
- Whether court (ACPA) is preferable for damages, discovery, or injunctive relief

## 6. Case lifecycle and follow-up

| State | Meaning | Action |
|---|---|---|
| Draft | Evidence incomplete | Complete checklist; do not send |
| Ready | Template and evidence validated | Human review |
| Submitted | Sent via email/form | Record case ID/receipt |
| Acknowledged | Provider confirmed receipt | Track SLA |
| More info needed | Provider asks questions | Respond within 24h if possible |
| Removed | Content/domain disabled | Re-scan; record outcome |
| Refused | Provider declined | Evaluate escalation or legal route |
| Reappeared | Same actor returns | Link to original case; escalate as repeat abuse |

Follow-up guidance:

- Keep one case ID per provider.
- Follow up after a reasonable interval; avoid duplicate reports with changed facts.
- Preserve all correspondence and receipts.
- Re-scan after removal; capture the new state.
- If the domain is compromised, prioritize host notification over registrar suspension to avoid collateral damage.
- For repeat campaigns, link cases and provide the pattern to the provider.

## 7. Product requirements

### Data model

- `takedown_cases`: org, brand, subject type/id, abuse type, status, priority, assignee, timestamps
- `takedown_targets`: URL, domain, IP, ASN, provider, layer, registrar
- `evidence_artifacts`: type, filename, hash, captured_at, source, redaction state
- `provider_routes`: provider, layer, channel, required fields, evidence requirements, SLA notes
- `authorizations`: trademark records, LOAs, expiry, scope
- `takedown_events`: draft, submitted, acknowledged, info_requested, removed, refused, reappeared

### Automation

- Capture screenshot with URL bar and UTC timestamp
- RDAP/WHOIS, DNS, TLS, HTTP headers, redirect chain
- Parse original EML/MSG/MBOX for headers and body
- Resolve registrar, host, ASN, CDN, and platform
- Render provider-specific template with validated fields
- Attach evidence pack and index with hashes
- Send through the user's mailbox or open the provider form with prefilled text
- Track receipt, replies, and outcomes; schedule follow-ups
- Re-scan after removal; reopen on reappearance

### AI role (ambient only)

- Classify abuse type and recommend route
- Draft the summary and select the template
- Summarize evidence and flag missing items
- Assign confidence; suppress low-confidence drafts
- Never auto-send, never alter facts, never invent rights or registration numbers
- Treat page/email text as untrusted data; fixed instructions only

### UX

- Threat detail → **Prepare takedown**
- Checklist with missing-evidence warnings
- Preview per provider, with live URL fields and defanged prose
- Human approval and send
- Case timeline with receipt, follow-ups, outcome
- Reuse evidence across providers without re-uploading

### Metrics

- Time from detection to first submission
- Provider acceptance rate
- Median removal time
- Reappearance rate
- Evidence completeness at first submission
- Cases closed without legal escalation
- Agency clients served per operator

## 8. Sources

- Cloudflare reporting abuse: https://www.cloudflare.com/trust-hub/reporting-abuse/
- Cloudflare complaint types: https://developers.cloudflare.com/fundamentals/reference/report-abuse/complaint-types/
- Cloudflare abuse approach: https://www.cloudflare.com/trust-hub/abuse-approach/
- ICANN DNS Abuse Advisory (2024): https://www.icann.org/en/contracted-parties/advisories/documents/advisory-compliance-with-dns-abuse-obligations-in-the-registrar-accreditation-agreement-and-the-registry-agreement-05-02-2024-en
- ICANN DNS abuse complaint guide: https://www.icann.org/en/system/files/files/submitting-dns-abuse-complaints-icann-guide-17nov25-en.pdf
- RRSG effective DNS abuse reports: https://rrsg.org/wp-content/uploads/2025/03/Effective-DNS-Abuse-Reports-2025.pdf
- Rapid7 evidence best practices: https://docs.rapid7.com/threat-command/evidence-best-practice-guidelines/
- NCSC takedown guidance: https://www.ncsc.gov.uk/guidance/takedown-removing-malicious-content-to-protect-your-brand
- Google Safe Browsing report: https://safebrowsing.google.com/safebrowsing/report_phish/
- Google legal removals: https://support.google.com/legal/answer/3110420
- Instagram impersonation: https://help.instagram.com/1291391774792379
- TikTok impersonation: https://support.tiktok.com/en/safety-hc/report-a-problem/report-an-impersonation-account
- Meta IP reporting: https://www.meta.com/help/policies/3234337743488413/
- Apple App Store disputes: https://www.apple.com/legal/intellectual-property/dispute-forms/app-store/
- Google Play impersonation: https://support.google.com/googleplay/android-developer/answer/16341334
- Amazon reporting violations: https://sell.amazon.com/blog/report-a-violation-to-amazon
- UDRP vs ACPA: https://www.tuckerup.com/blog/udrp-vs-acpa-cybersquatted-domain-name/
