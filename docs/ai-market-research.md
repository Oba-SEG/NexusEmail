# AI Layer: Market, Competitor, and Positioning Research

**Date:** 23 November 2026  
**Purpose:** Validate the ambient, no-prompt AI concept and identify credible selling points for Nexus Brand Protection.  
**Method:** Public vendor pages, published pricing pages, third-party comparison pages, and 2025–2026 industry reports. No hands-on product trials. Vendor performance figures are self-reported unless noted. Several comparison sources are published by competitors; they are used for quoted claims and pricing signals, not as neutral rankings.

> This is product research, not legal advice. Pricing and provider requirements change frequently; confirm before publishing customer-facing claims.

## Bottom line

- AI is now table stakes in both DMARC and brand-protection categories. Competitors already market AI detection, AI report analysis, AI troubleshooting, chat assistants, and agentic takedowns.
- The opening is **not “AI”**. It is an ambient, evidence-backed workflow for the **mid-market and agency segment**: automatic triage, plain-English fixes, ready-to-send takedowns, and proof that the fix or removal actually happened — without enterprise pricing or an analyst.
- The market gap is visible in the numbers: DMARC adoption is above half of domains, but only a small minority enforce a blocking policy. Cheap DMARC tools stop at monitoring; enterprise digital-risk platforms start at five figures and hide pricing.
- “No prompt / no assistant” is a credible UX and cost differentiator, but buyers will not pay for that phrase. Sell the outcomes: fewer alerts, faster fixes, verified outcomes, agency leverage, transparent pricing.

## Demand signals

### Email and brand abuse

- FBI IC3’s 2025 report recorded **1,008,597 complaints** and **$20.877B in reported losses**.
- **Phishing/spoofing:** 191,561 complaints, the most-reported crime type, with **$215.8M** in reported losses — up from $70.0M in 2024 and $18.7M in 2023. Volume was flat; reported losses roughly tripled year over year and rose more than 10x over two years.
- **Business email compromise (BEC):** 24,768 complaints and **$3.046B** in reported losses. BEC remained the second-largest loss category.
- IC3 also reported **over $30M** in BEC losses involving AI, as reported by businesses.
- Sources: [FBI IC3 annual reports](https://www.ic3.gov/annualreport/reports), [IC3 2025 summary](https://iblockspam.com/blog/phishing-statistics), [Red Sift IC3 analysis](https://redsift.com/blog/fbi-ic3-2025-report-email-fraud).

**Implication:** the damage is shifting from mass phishing to higher-value impersonation and BEC. Explanation, prioritization, and fast removal matter more than another raw alert feed.

### DMARC adoption vs enforcement

- EasyDMARC’s 2026 report, scanning 1.8M domains, found **52.1% DMARC adoption** (937,931 domains), up from 47.7% in 2025. Only about **9%** combine enforcement with reporting. Fortune 500 adoption was 95%, with over 80% enforcement; more than half of Inc. 5000 domains remained at monitoring-only.
- Sendmarc’s 2026 cohort found **71.5% adoption** but only **26.6% at p=reject**, leaving a 44.9-point enforcement gap. It also reported nearly 90% of 1.65M scanned domains still exposed to outbound spoofing.
- Fortra’s scan of the top 10M domains found only **18.2% with a valid DMARC record** and **7.6% with enforcement** (quarantine or reject); 81.6% had no DMARC record.
- Sources: [EasyDMARC 2026 adoption report](https://easydmarc.com/blog/easydmarc-releases-2026-dmarc-adoption-report/), [Sendmarc 2026 report](https://sendmarc.com/resources/guides-and-reports/2026-cyberthreat-report-dmarc-adoption/), [Fortra Q2 2025 analysis](https://www.fortra.com/blog/dmarc-adoption-trends-q2-2025).

**Implication:** the market has moved from “publish a record” to “reach enforcement and stay there.” That is a guidance and verification problem, not a data-visibility problem — exactly where ambient AI can help.

### Lookalike and impersonation volume

- CSC’s 2026 Domain Security Report found **88% of homoglyph domains** targeting Global 2000 brands were owned by third parties; 32% of inactive third-party domains had active MX records, making them usable for email abuse.
- Source: [CSC Domain Security Report 2026](https://cscwebcontentstorage.blob.core.windows.net/cscmarketing-cscdbs-media/images/pdfs/Domain-Security-Report2026.pdf).

**Implication:** dormant lookalikes are a leading indicator. Correlation and prioritization are more valuable than a longer list of domains.

## Competitive map

### Brand protection / digital risk

| Vendor | AI / automation claim | Takedown claim | Pricing signal |
|---|---|---|---|
| ZeroFox | AI detection with logo/image/OCR/NLP; analysts verify; 180+ platforms | 1M+ takedowns/year; 95% acceptance; in-house team and 80+ partnerships | Four bundles, quote-only; 250/500/1,000 takedown allowances by tier |
| Bolster (Fortra) | AI-led detection; automated enforcement; 1,500+ provider network | >95% of phishing/scam sites removed in as little as 2 minutes; no per-takedown fees | Quote-only; Vendr median ~$37.5k/year (range ~$13k–$93.6k) |
| BrandShield | AI detection plus expert-led enforcement; web, social, marketplaces, apps, ads, dark web, AI platforms | 98% detected/removed within SLA; 98% phishing success (vendor claims) | Quote-only; reported ~$15k–$30k+/year |
| Doppel | AI-powered social-engineering defense; Threat Graph links accounts/domains/ads; agentic AI automates takedowns | <10h median across domains/social/ads; 12-minute median phishing URL mitigation | Quote-only; mid-five-figure annual contracts reported |
| Red Points | AI-driven brand protection and enforcement | Managed enforcement | Quote-only; ~$35k/year average reported, up to ~$70k |
| Netcraft | Automated phishing detection and takedown | Managed takedown | Quote-only; Vendr median ~$35k/year |
| MarqVision | AI-driven IP/brand protection | Managed enforcement | Quote-only; ~$25k–$100k/year for growth programs |
| Corsearch | Brand protection and trademark workflow | Managed enforcement | Quote-only; software-directory estimates ~$5k–$6.6k/month |
| Katcher AI | AI agent with unlimited takedowns | Unlimited takedowns | Published $99/month (outlier low-end) |

Sources: [PhishEye 2026 comparison](https://phisheye.com/blog/best-brand-protection-platforms), [Brandefense vendor comparison](https://brandefense.io/blog/brand-protection-companies/), [VeloTouch comparison](https://velotouch.com/best-automated-brand-protection-platforms/), [Katcher pricing analysis](https://katcher.ai/blog/brand-protection-pricing-who-publishes-a-number), [ChainPatrol buyer guide](https://chainpatrol.com/buyers-guide/best-brand-protection-platforms).

**Pattern:** enterprise DRP is broad but quote-only and increasingly claims agentic/automated takedowns. The low end is emerging ($99/month unlimited takedowns), but coverage and evidence quality vary. There is room for a transparent mid-market product with strong evidence and human approval.

### DMARC / email authentication

| Vendor | AI / analysis feature | Entry pricing signal |
|---|---|---|
| Red Sift OnDMARC | Radar: LLM-assisted troubleshooting and remediation guidance; report analysis | Express from $9/month annual (4 domains, 1M emails/month, 30-day history) |
| EasyDMARC | AI-powered report analyzer; AI agents and proactive alerts on higher tiers | Plus $35.99/month annual; Premium $71.99/month annual (2–4 domains) |
| Valimail | Sender intelligence; Monitor free; Enforce quote-only | Free Monitor; Enforce quote-only |
| dmarcian | DMARC monitoring and managed services | Published tiers; enterprise quote for larger portfolios |
| PowerDMARC | DMARC/SPF/DKIM/BIMI/MTA-STS suite; partner program | Quote/partner tiers |

Sources: [Elma DMARC comparison](https://elma.sh/best/dmarc-monitoring-tools), [Gupta Deepak 2026 comparison](https://guptadeepak.com/tools/top-5-dmarc-email-authentication-tools/), [Red Sift Radar](https://redsift.com/blog/top-platforms-for-enterprise-dmarc-enforcement-technical-comparison-for-security-leaders), [EasyDMARC provider comparison](https://easydmarc.com/blog/best-dmarc-providers-in-2026/).

**Pattern:** AI report analysis and troubleshooting already exist at low price points. A generic “AI explains your DMARC” feature is not differentiated. A closed-loop fix-and-verify workflow is.

### MSP / agency tooling

- EasyDMARC sells a dedicated MSP platform and multi-client management.
- DMARCeye publishes $4/domain/month on its Scale plan and an Agency plan with isolated client sub-accounts, white-label branding, and unlimited history.
- DDMARC publishes $119/month for 30 domains and $299/month for 100 domains, with a white-label portal.
- DMARC Report offers deep white-labeling and bundle pricing (5 domains $25/month; 10 domains $75/month).
- SpoofWard publishes MSP plans from $79 to $599/month for 5–100 clients.
- Agency resale benchmarks in vendor material commonly sit at $30–$99 per client per month, with wholesale costs of roughly $3–$35 per domain or client.
- Sources: [DMARCeye agency comparison](https://dmarceye.com/insights/best-dmarc-tools-for-agencies-and-msps), [DDMARC MSP pricing](https://ddmarc.com/solutions/msp/), [SpoofWard MSP](https://spoofward.com/msp), [Verkh MSP pricing](https://verkh.io/solutions/msp/).

**Pattern:** agencies want per-client isolation, white-label reports, and predictable per-domain/per-client pricing. AI that removes analyst labor is more valuable to them than AI that requires prompting.

## What is actually differentiated

We did not find a vendor clearly marketing a **no-prompt, evidence-cited, ambient analysis layer** as its core. Most AI messaging falls into one of four buckets:

1. AI detection (computer vision, NLP, similarity).
2. AI report analysis or troubleshooting.
3. Chat assistants / MCP access.
4. Agentic or automated takedowns.

That means “we use AI” is not a selling point. The defensible combination is:

- **Ambient by default:** outputs appear in the workflow; no prompt or training required.
- **Evidence-cited:** every explanation points to the DNS record, report row, screenshot, certificate, or WHOIS field used.
- **Closed loop:** fixes and takedowns are verified, not just recommended.
- **Human-approved outbound actions:** no autonomous DNS changes or takedown sends.
- **Transparent packaging:** published pricing and no per-takedown surprises, unlike most DRP vendors.
- **Agency-native:** isolated clients, white-label outputs, portfolio triage.

## Selling points

### Primary messages

1. **“The fix-first console.”** Not another feed of alerts — the next three actions that reduce risk, with the evidence and steps.
2. **“From alert to verified fix.”** Recommendations are checked after the change; takedowns are tracked to outcome.
3. **“One incident, not forty alerts.”** Correlate lookalikes, DMARC failures, certificates, and DNS changes into campaigns.
4. **“Evidence-backed takedowns, ready to send.”** Auto-assembled evidence packs and provider-specific templates; a human reviews and sends.
5. **“Built for teams without a security analyst.”** Plain-English explanations, provider-specific steps, no prompt engineering.
6. **“Agency-ready without enterprise pricing.”** Per-client isolation, white-label reports, portfolio view, predictable pricing.
7. **“Email authentication and brand abuse in one place.”** DMARC/SPF/DKIM/BIMI plus lookalike and impersonation monitoring, with one workflow.

### By buyer

| Buyer | Message | Proof |
|---|---|---|
| SMB owner / IT generalist | “Know the three fixes that matter this week.” | Time-to-first-fix, score improvement |
| Security analyst | “One incident, not forty alerts.” | Alerts consolidated, triage time, takedown acceptance |
| Agency / MSP | “Run more clients without more analysts.” | Clients per operator, report generation time, white-label adoption |
| Leadership / compliance | “See risk going down, with evidence.” | Verified fixes, removal outcomes, audit trail |

### Claims to avoid

- “AI detects threats” — detection is deterministic scanning and brand matching; AI explains and prioritizes.
- “Fully automated takedowns” — unless the product actually sends and wins appeals without review.
- “Replaces your security team” — it reduces triage and drafting work, not accountability.
- “Guaranteed removal” — registrars, hosts, and platforms exercise discretion; ccTLDs and compromised domains behave differently.
- “Prevents phishing” — DMARC enforcement reduces exact-domain spoofing; it does not stop lookalike domains, compromised accounts, or social impersonation.

## Packaging hypothesis

Test, do not assume:

- **Core:** domain and brand monitoring, DNS checks, alerts, reports.
- **Pro:** ambient triage, fix plans, report narratives, takedown templates/evidence packs.
- **Agency:** isolated client workspaces, white-label reports, portfolio prioritization, API/webhooks, volume pricing.

Possible price anchors from the market:

- DMARC-only tools: roughly $9–$72/month for small domain counts.
- Brand-protection platforms: roughly $15k–$100k/year, mostly quote-only.
- MSP/agency tools: roughly $3–$35/domain or client wholesale, with retail at $30–$99/client.
- Low-end AI takedown outlier: $99/month unlimited.

A transparent mid-market package between cheap DMARC monitoring and enterprise DRP is the open space. Validate willingness to pay with buyer interviews before publishing a price.

## Risks and open questions

- **AI trust:** false positives, hallucinated explanations, overconfident severity. Mitigate with evidence citations, confidence thresholds, suppression, and human review.
- **Prompt injection:** scanned page text and email content are untrusted. Never let them alter instructions; use fixed prompts and schema-validated outputs.
- **Legal:** takedown templates are operational notices, not legal advice. DMCA applies to copyright, not trademarks. UDRP/ACPA require counsel and evidence of rights/bad faith.
- **Provider discretion:** registrars and hosts may decline, especially for compromised domains or subdomains; collateral-damage rules apply.
- **Data privacy:** DMARC reports and abuse evidence contain IPs, domains, and sometimes personal data. Use tenant isolation, retention limits, and no model training on customer data.
- **Competitor claims:** published takedown SLAs and acceptance rates are vendor-defined and not independently verified. Do not benchmark against them without testing.
- **Source bias:** several comparison pages are published by competitors. Pricing ranges are directional, not quotes.

## Research gaps

1. Buyer interviews: 10–15 SMB owners/IT generalists, 5–10 MSPs/agencies, 3–5 security analysts.
2. Hands-on trials of Red Sift Radar, EasyDMARC AI, Doppel, Bolster, and ZeroFox where possible.
3. Win/loss and pricing tests for Pro and Agency tiers.
4. Legal review of takedown templates and authorization workflow.
5. Independent validation of takedown acceptance/time claims.
6. Monitor 2027 DMARC and IC3 data for message freshness.

## Sources

- FBI IC3 annual reports: https://www.ic3.gov/annualreport/reports
- IC3 2025 summary: https://iblockspam.com/blog/phishing-statistics
- Red Sift IC3 analysis: https://redsift.com/blog/fbi-ic3-2025-report-email-fraud
- EasyDMARC 2026 adoption report: https://easydmarc.com/blog/easydmarc-releases-2026-dmarc-adoption-report/
- Sendmarc 2026 report: https://sendmarc.com/resources/guides-and-reports/2026-cyberthreat-report-dmarc-adoption/
- Fortra DMARC analysis: https://www.fortra.com/blog/dmarc-adoption-trends-q2-2025
- CSC Domain Security Report 2026: https://cscwebcontentstorage.blob.core.windows.net/cscmarketing-cscdbs-media/images/pdfs/Domain-Security-Report2026.pdf
- PhishEye brand-protection comparison: https://phisheye.com/blog/best-brand-protection-platforms
- Brandefense vendor comparison: https://brandefense.io/blog/brand-protection-companies/
- VeloTouch comparison: https://velotouch.com/best-automated-brand-protection-platforms/
- Katcher pricing analysis: https://katcher.ai/blog/brand-protection-pricing-who-publishes-a-number
- ChainPatrol buyer guide: https://chainpatrol.com/buyers-guide/best-brand-protection-platforms
- Elma DMARC comparison: https://elma.sh/best/dmarc-monitoring-tools
- Gupta Deepak DMARC comparison: https://guptadeepak.com/tools/top-5-dmarc-email-authentication-tools/
- Red Sift Radar comparison: https://redsift.com/blog/top-platforms-for-enterprise-dmarc-enforcement-technical-comparison-for-security-leaders
- EasyDMARC provider comparison: https://easydmarc.com/blog/best-dmarc-providers-in-2026/
- DMARCeye agency comparison: https://dmarceye.com/insights/best-dmarc-tools-for-agencies-and-msps
- DDMARC MSP pricing: https://ddmarc.com/solutions/msp/
- SpoofWard MSP: https://spoofward.com/msp
- Verkh MSP pricing: https://verkh.io/solutions/msp/
