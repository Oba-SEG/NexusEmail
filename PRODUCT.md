# Product

## Register

product

## Users

Domain owners, IT/email administrators, and MSP operators managing one to a few hundred domains. They arrive in a work context (morning checks, incident response after a spoofing scare, onboarding a new sending domain) and need to answer one question fast: "is my email posture safe, and what do I fix next?" Primary task on every screen: assess domain health and act on the top fix.

## Product Purpose

NexusEmail is an open-source email security auditing platform: it scans SPF, DKIM, DMARC, MTA-STS, and TLS-RPT for a domain portfolio, scores posture 0–100, watches for typosquat/lookalike impersonation via RDAP, ingests DMARC aggregate reports, and pushes one-click fixes through DNS provider integrations. Success = a user can see current posture, understand the single most important fix, and apply it without leaving the app (or confidently know why they can't).

## Brand Personality

Confident operator: calm, precise, data-forward. Dark segbytes palette (#090b12) with electric orange (#ff9d52) as the single signal color. The UI speaks like a competent security engineer: short declarative status ("DMARC: policy present, rua configured"), never raw stack traces, never hype. Emotional goal: the user feels in control of their email perimeter.

## Anti-references

- **Raw dev console**: monospace error strings ("queryTxt ENOTFOUND"), unstyled exception text, developer-only affordances with no explanation. The current Issues panels drift this way; it is the thing to eliminate.
- **Enterprise SOC noise**: wall-of-charts dashboards, blinking severity badges, alert fatigue.
- **Landing-page glow**: gradient heroes and decorative glass inside a working tool.

## Design Principles

1. **Status before data.** Every panel leads with a verdict ("Passing / Needs fix / Unknown") before raw record text; raw values are secondary detail, never the headline.
2. **One top action per domain.** The next fix is always explicit, reachable in one click, and named ("Publish DMARC record"). Raw error text is translated into what it means for the user.
3. **Feedback where the finger is.** Every action confirms in place (inline/toast) within the component that triggered it; blocking browser dialogs are banned.
4. **Progressive disclosure.** Rows summarize; details expand on demand (records, ext-rec checks, per-source breakdowns). Nothing important is only reachable by an unlabeled icon button.
5. **Unknown is a state, not an error.** DNS lookup failures render as "Not configured (lookup failed)" guidance, never a stack trace fragment.

## Accessibility & Inclusion

WCAG 2.1 AA: ≥4.5:1 text contrast (the faint orange fix-hints fail today), visible focus rings, full keyboard operability for row actions and tabs, `prefers-reduced-motion` support for any added motion. Color is never the only signal — status always pairs text + icon.
