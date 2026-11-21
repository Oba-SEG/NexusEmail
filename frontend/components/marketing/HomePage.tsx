"use client";

import {
  ArrowRight, BarChart3, Check, FileCheck2, Globe2, LockKeyhole,
  MailCheck, Radar, ShieldCheck, Terminal,
} from "lucide-react";

interface HomePageProps {
  onSignIn: () => void;
  onCreateAccount: () => void;
}

const COVERAGE = ["SPF", "DKIM", "DMARC", "MTA-STS", "TLS-RPT", "Brand watch"];

const METRICS = [
  { value: "92", label: "posture score" },
  { value: "1", label: "fix queued" },
  { value: "5", label: "DNS checks" },
  { value: "24/7", label: "brand watch" },
];

const FEATURES = [
  {
    number: "01",
    icon: Globe2,
    title: "See the whole perimeter",
    body: "SPF, DKIM, DMARC, MTA-STS and TLS-RPT in one posture score. Every finding names the record, the risk, and the fix.",
    meta: "5 checks · 1 score",
  },
  {
    number: "02",
    icon: Radar,
    title: "Catch impersonation early",
    body: "Watch for typosquats and lookalike domains, triage what is registered, and keep the evidence attached to the threat.",
    meta: "continuous discovery",
  },
  {
    number: "03",
    icon: FileCheck2,
    title: "Prove the work",
    body: "Shareable reports, scan history and DMARC aggregate insights for the people who ask, 'are we actually safer?'",
    meta: "export-ready evidence",
  },
  {
    number: "04",
    icon: LockKeyhole,
    title: "Keep tenants apart",
    body: "Every domain, scan, secret and report belongs to one workspace. Platform access is audited end to end.",
    meta: "audited access",
  },
];

const STEPS = [
  { number: "01", title: "Add a domain", body: "Paste the domain. Nexus reads the public DNS records — no agent, no MX change.", cmd: "nexus domains add acme.com" },
  { number: "02", title: "Fix the top signal", body: "One next action per domain, with the exact record and provider-ready guidance.", cmd: "nexus fix acme.com --top" },
  { number: "03", title: "Keep watch", body: "Scheduled rescans, brand lookalikes and digests keep the perimeter current.", cmd: "nexus watch acme.com --digest" },
];

const TERMINAL_LINES = [
  { kind: "prompt", text: "~/acme $ npx nexus scan acme.com" },
  { kind: "pass", text: "DMARC    p=reject · rua configured" },
  { kind: "pass", text: "SPF      hard fail · 4 authorized senders" },
  { kind: "pass", text: "DKIM     selector1 aligned" },
  { kind: "warn", text: "MTA-STS  enforce in 6d (observation)" },
  { kind: "pass", text: "TLS-RPT  reporting endpoint present" },
  { kind: "result", text: "→ posture 92/100 · 1 fix queued" },
];

function RecordField() {
  const line = "v=DMARC1; p=reject; rua=mailto:dmarc@example.com   _dmarc TXT   v=spf1 include:_spf.example.com -all   selector1._domainkey CNAME   ";
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden font-mono text-[9px] leading-[1.9] tracking-[0.06em] text-[#ff9d52]/[0.07]">
      {Array.from({ length: 26 }).map((_, i) => (
        <p key={i} className="whitespace-nowrap">{line.repeat(3)}</p>
      ))}
    </div>
  );
}

function TerminalPreview() {
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0d0d0f] shadow-[0_40px_120px_-40px_rgba(255,106,26,0.45)]">
      <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff6b1a]" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">nexus-cli</span>
        <span className="font-mono text-[10px] text-[#ff9d52]">live</span>
      </div>
      <div className="space-y-1.5 p-4 font-mono text-[11.5px] leading-6 sm:p-5 sm:text-[12px]">
        {TERMINAL_LINES.map((line) => (
          <p
            key={line.text}
            className={
              line.kind === "prompt"
                ? "text-white/85"
                : line.kind === "warn"
                  ? "text-amber-300/90"
                  : line.kind === "result"
                    ? "pt-2 text-[#ff9d52]"
                    : "text-white/45"
            }
          >
            {line.kind === "prompt" ? "" : line.kind === "result" ? "" : "✓ "}
            {line.text}
          </p>
        ))}
        <p className="pt-1 text-white/85">
          <span className="text-[#ff6b1a]">$</span> <span className="inline-block h-4 w-[7px] translate-y-0.5 animate-pulse bg-[#ff9d52]/80" />
        </p>
      </div>
      <div className="grid grid-cols-3 gap-px border-t border-white/10 bg-white/10">
        {[
          ["92", "score"],
          ["4/4", "aligned"],
          ["1", "open fix"],
        ].map(([value, label]) => (
          <div key={label} className="bg-[#0d0d0f] px-4 py-3">
            <p className="font-mono text-[16px] text-white">{value}</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-white/35">{label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConsolePreview() {
  const checks = [
    ["DMARC", "p=reject · rua configured", "pass"],
    ["SPF", "hard fail · 4 authorized senders", "pass"],
    ["DKIM", "selector1 aligned", "pass"],
    ["MTA-STS", "enforce · max-age 1w", "warn"],
    ["TLS-RPT", "reporting endpoint present", "pass"],
  ];
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-[#101013]">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="nbp-mark flex h-6 w-6 items-center justify-center text-[9px]">N</span>
          <span className="text-[11px] font-medium text-white/80">Nexus</span>
          <span className="text-[10px] text-white/25">/</span>
          <span className="font-mono text-[10.5px] text-white/55">aperture.co</span>
        </div>
        <span className="rounded-full border border-[#ff9d52]/25 bg-[#ff9d52]/10 px-2 py-0.5 font-mono text-[9.5px] text-[#ffb987]">
          scanned 2m ago
        </span>
      </div>
      <div className="grid gap-px bg-white/[0.06] md:grid-cols-[1.35fr_1fr]">
        <div className="bg-[#101013] p-5 md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] text-white/40">Domain posture</p>
              <p className="mt-1 text-[19px] font-semibold tracking-[-0.02em] text-white">aperture.co</p>
              <p className="mt-1 text-[11px] text-white/40">4 passing · 1 to review</p>
            </div>
            <div className="text-right">
              <p className="font-mono text-[48px] leading-none text-[#ff9d52]">92</p>
              <p className="text-[10px] uppercase tracking-[0.14em] text-white/35">score</p>
            </div>
          </div>
          <div className="mt-5 space-y-1">
            {checks.map(([label, detail, status]) => (
              <div key={label} className="flex items-center gap-3 rounded-md px-2 py-2">
                <span className={`flex h-4 w-4 items-center justify-center rounded-full ${status === "pass" ? "bg-[#ff9d52]/15 text-[#ffb987]" : "bg-amber-400/10 text-amber-300"}`}>
                  <Check className="h-2.5 w-2.5" />
                </span>
                <span className="w-[62px] text-[11px] font-medium text-white/70">{label}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-white/35">{detail}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-[#0c0c0e] p-5 md:p-6">
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-white/40">Brand watch</p>
            <span className="font-mono text-[10px] text-[#ffb987]">3 open</span>
          </div>
          <div className="mt-4 space-y-3">
            {[
              ["aperture-login.com", "registered", "high"],
              ["apertur3.co", "registered", "medium"],
              ["aperture-security.net", "unregistered", "info"],
            ].map(([domain, state, severity]) => (
              <div key={domain} className="border-t border-white/[0.07] pt-3 first:border-0 first:pt-0">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate font-mono text-[10.5px] text-white/65">{domain}</span>
                  <span className={`rounded-full px-1.5 py-0.5 text-[9px] ${severity === "high" ? "bg-red-400/10 text-red-300" : severity === "medium" ? "bg-amber-400/10 text-amber-300" : "bg-white/[0.05] text-white/40"}`}>{severity}</span>
                </div>
                <p className="mt-1 text-[10px] text-white/30">{state}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-lg border border-[#ff9d52]/20 bg-[#ff9d52]/[0.06] p-3">
            <p className="text-[10px] leading-4 text-[#ffc9a3]">Next fix: tighten MTA-STS to enforcement mode after a 7-day observation window.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HomePage({ onSignIn, onCreateAccount }: HomePageProps) {
  return (
    <main className="min-h-screen overflow-x-hidden bg-[#09090b] text-[#f5f2ee]">
      <div className="border-b border-[#ff9d52]/15 bg-[#ff6b1a]/10 px-4 py-2 text-center font-mono text-[10.5px] uppercase tracking-[0.14em] text-[#ffb987]">
        <button type="button" onClick={onCreateAccount} className="group inline-flex items-center gap-1.5">
          Workspaces are open — bring your domains into focus
          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>

      <header className="sticky top-0 z-50 border-b border-white/[0.07] bg-[#09090b]/85 backdrop-blur-xl">
        <div className="mx-auto flex h-[64px] max-w-[1220px] items-center gap-8 px-5 sm:px-7">
          <a href="#top" className="flex flex-shrink-0 items-center gap-2.5" aria-label="Nexus home">
            <span className="nbp-mark flex h-8 w-8 items-center justify-center text-[11px]">N</span>
            <span className="text-[16px] font-semibold tracking-[-0.02em]">Nexus</span>
            <span className="hidden rounded border border-white/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-white/40 sm:inline">
              brand protection
            </span>
          </a>
          <nav className="hidden items-center gap-7 font-mono text-[10.5px] uppercase tracking-[0.16em] text-white/45 md:flex">
            <a href="#platform" className="transition-colors hover:text-white">Platform</a>
            <a href="#coverage" className="transition-colors hover:text-white">Coverage</a>
            <a href="#how" className="transition-colors hover:text-white">Workflow</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={onSignIn} className="rounded-lg px-3.5 py-2 text-[12px] font-medium text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white">
              Sign in
            </button>
            <button type="button" onClick={onCreateAccount} className="inline-flex items-center gap-1.5 rounded-lg bg-[#ff6b1a] px-4 py-2 text-[12px] font-semibold text-[#160a03] transition-colors hover:bg-[#ff9d52]">
              Get started
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>

      <section id="top" className="relative overflow-hidden border-b border-white/[0.07]">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-[-320px] h-[640px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,#ff6b1a_0%,#a3340a_38%,transparent_68%)] opacity-[0.22] blur-3xl" />
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#ff9d52]/50 to-transparent" />
        </div>

        <div className="relative mx-auto grid max-w-[1220px] gap-14 px-5 pb-20 pt-16 sm:px-7 sm:pt-24 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-16">
          <div>
            <p className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[#ff9d52]">
              brand protection, shipped like software
            </p>
            <h1 className="mt-6 text-[clamp(3rem,6.6vw,5.4rem)] font-bold leading-[0.95] tracking-[-0.045em]">
              Own your email
              <br />
              perimeter<span className="text-[#ff6b1a]">.</span>
            </h1>
            <p className="mt-6 max-w-[540px] text-[15px] leading-7 text-white/55">
              Nexus turns DNS, DMARC and brand signals into one clear answer:
              what is exposed, what to fix first, and what changed since yesterday.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button type="button" onClick={onCreateAccount} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#ff6b1a] px-6 text-[13px] font-semibold text-[#160a03] transition-colors hover:bg-[#ff9d52]">
                Start a workspace
                <ArrowRight className="h-4 w-4" />
              </button>
              <button type="button" onClick={onSignIn} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/12 bg-white/[0.03] px-5 text-[13px] font-medium text-white/70 transition-colors hover:bg-white/[0.07] hover:text-white">
                <Terminal className="h-3.5 w-3.5 text-[#ff9d52]" />
                Open the console
              </button>
            </div>
            <p className="mt-5 font-mono text-[10.5px] text-white/30">
              No credit card. No DNS changes to get your first score.
            </p>

            <dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 sm:grid-cols-4">
              {METRICS.map((metric) => (
                <div key={metric.label} className="bg-[#0b0b0e] px-4 py-4">
                  <dt className="sr-only">{metric.label}</dt>
                  <dd className="font-mono text-[22px] leading-none text-white">{metric.value}</dd>
                  <dd className="mt-1.5 text-[10px] uppercase tracking-[0.12em] text-white/35">{metric.label}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="relative">
            <div aria-hidden="true" className="pointer-events-none absolute -inset-6 rounded-3xl bg-[radial-gradient(circle_at_70%_20%,rgba(255,107,26,0.14),transparent_65%)] blur-2xl" />
            <div className="relative">
              <TerminalPreview />
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-white/[0.07]">
        <div className="mx-auto flex max-w-[1220px] flex-wrap items-center gap-x-8 gap-y-3 px-5 py-5 sm:px-7">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/25">Coverage</span>
          {COVERAGE.map((item) => (
            <span key={item} className="inline-flex items-center gap-1.5 font-mono text-[11px] text-white/50">
              <Check className="h-3 w-3 text-[#ff9d52]" /> {item}
            </span>
          ))}
          <span className="ml-auto hidden font-mono text-[10px] text-white/25 lg:inline">one workspace · one score</span>
        </div>
      </section>

      <section id="platform" className="mx-auto max-w-[1220px] px-5 py-20 sm:px-7 sm:py-28">
        <div className="grid gap-8 border-b border-white/10 pb-12 lg:grid-cols-[0.85fr_1.15fr] lg:items-end">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-[#ff9d52]">The operator&apos;s console</p>
          <h2 className="text-[clamp(2.4rem,4.8vw,4.2rem)] font-bold leading-[1.02] tracking-[-0.04em]">
            Built for the people who own the inbox.
          </h2>
        </div>

        <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 md:grid-cols-2">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <article key={feature.number} className="group bg-[#0b0b0e] p-6 transition-colors hover:bg-[#0f0f13] sm:p-8">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-[#ff9d52]/70">{feature.number}</span>
                  <Icon className="h-5 w-5 text-[#ff9d52]" strokeWidth={1.6} />
                </div>
                <h3 className="mt-8 text-[22px] font-semibold tracking-[-0.03em]">{feature.title}</h3>
                <p className="mt-2.5 max-w-[440px] text-[13px] leading-6 text-white/45">{feature.body}</p>
                <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.14em] text-white/25">{feature.meta}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section id="coverage" className="relative overflow-hidden border-y border-white/[0.07] bg-[#0b0b0e] py-20 sm:py-28">
        <RecordField />
        <div className="relative mx-auto max-w-[1220px] px-5 sm:px-7">
          <div className="grid gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:gap-16">
            <div>
              <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-[#ff9d52]">One perimeter</p>
              <h2 className="mt-5 text-[clamp(2.4rem,5.2vw,4.4rem)] font-bold leading-[1.0] tracking-[-0.04em]">
                From DNS record to takedown.
              </h2>
              <p className="mt-6 max-w-[460px] text-[14px] leading-7 text-white/45">
                Most tools stop at a red badge. Nexus keeps the chain intact:
                signal, evidence, owner, action. Nothing important lives in a
                screenshot on someone&apos;s desktop.
              </p>
            </div>
            <div className="space-y-0 border-t border-white/10">
              {[
                [MailCheck, "Authentication posture", "SPF, DKIM, DMARC, MTA-STS and TLS-RPT interpreted together, not as five disconnected checkers."],
                [ShieldCheck, "Brand defense", "Lookalike discovery with registration checks, safe-list control and an audited takedown trail."],
                [BarChart3, "Evidence on demand", "Shareable reports, scheduled digests and trend history for security reviews."],
                [LockKeyhole, "Tenant separation", "Every domain, scan, secret and report belongs to one workspace. Platform access is audited."],
              ].map(([Icon, title, body]) => {
                const ItemIcon = Icon as typeof MailCheck;
                return (
                  <div key={title as string} className="grid grid-cols-[24px_1fr] gap-4 border-b border-white/10 py-6">
                    <ItemIcon className="mt-0.5 h-4 w-4 text-[#ff9d52]" strokeWidth={1.6} />
                    <div>
                      <h3 className="text-[13px] font-medium text-white">{title as string}</h3>
                      <p className="mt-1.5 max-w-[480px] text-[12px] leading-5 text-white/40">{body as string}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-[1220px] px-5 py-20 sm:px-7 sm:py-28">
        <div className="flex flex-col gap-5 border-b border-white/10 pb-10 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-[#ff9d52]">Workflow</p>
            <h2 className="mt-4 text-[clamp(2.2rem,4.4vw,3.8rem)] font-bold leading-[1.02] tracking-[-0.04em]">
              Three moves to a smaller surface.
            </h2>
          </div>
          <button type="button" onClick={onCreateAccount} className="inline-flex flex-shrink-0 items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[#ff9d52] hover:text-[#ffb987]">
            Create your workspace <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="grid gap-10 pt-12 lg:grid-cols-[1fr_1fr] lg:gap-16">
          <div className="space-y-8">
            {STEPS.map((step) => (
              <div key={step.number} className="flex gap-5">
                <span className="font-mono text-[10px] text-[#ff9d52]/70">{step.number}</span>
                <div>
                  <h3 className="text-[15px] font-semibold tracking-[-0.01em]">{step.title}</h3>
                  <p className="mt-1.5 max-w-[420px] text-[12.5px] leading-6 text-white/45">{step.body}</p>
                  <code className="mt-3 inline-block rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1 font-mono text-[10.5px] text-white/55">
                    <span className="text-[#ff9d52]">$</span> {step.cmd}
                  </code>
                </div>
              </div>
            ))}
          </div>

          <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0d0d0f]">
            <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-4 py-2.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/35">dns fix · dmarc</span>
              <span className="font-mono text-[10px] text-[#ff9d52]">copy-ready</span>
            </div>
            <div className="space-y-3 p-5 font-mono text-[11.5px] leading-6">
              <p className="text-white/30"># before</p>
              <p className="text-white/60">_dmarc.acme.com TXT <span className="text-red-300/90">&quot;v=DMARC1; p=none&quot;</span></p>
              <p className="pt-2 text-white/30"># after</p>
              <p className="text-white/60">_dmarc.acme.com TXT <span className="text-[#ffb987]">&quot;v=DMARC1; p=reject; rua=mailto:dmarc@acme.com&quot;</span></p>
              <p className="pt-3 text-[#ff9d52]">→ propagate · rescan in 2m</p>
              <p className="text-white/25"># evidence attached to the fix</p>
            </div>
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden border-t border-white/[0.07]">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,#ff6b1a_0%,#7a2a08_35%,transparent_65%)] opacity-[0.28]" />
        <div className="relative mx-auto max-w-[900px] px-5 py-24 text-center sm:px-7 sm:py-32">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-[#ff9d52]">Start with one domain</p>
          <h2 className="mt-5 text-[clamp(2.6rem,6vw,5rem)] font-bold leading-[0.98] tracking-[-0.045em]">
            Close the gap between
            <br />
            alert and fix<span className="text-[#ff6b1a]">.</span>
          </h2>
          <p className="mx-auto mt-6 max-w-[520px] text-[14px] leading-7 text-white/50">
            Get the first posture score in minutes. Invite the rest of the team when you are ready.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button type="button" onClick={onCreateAccount} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#ff6b1a] px-6 text-[13px] font-semibold text-[#160a03] transition-colors hover:bg-[#ff9d52]">
              Create a workspace <ArrowRight className="h-4 w-4" />
            </button>
            <button type="button" onClick={onSignIn} className="inline-flex h-11 items-center justify-center rounded-lg border border-white/15 px-5 text-[13px] font-medium text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white">
              Sign in
            </button>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/[0.07] bg-[#070709] px-5 py-9 sm:px-7">
        <div className="mx-auto flex max-w-[1220px] flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <span className="nbp-mark flex h-7 w-7 items-center justify-center text-[10px]">N</span>
            <span className="text-[13px] font-medium">Nexus</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/25">brand protection</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white/35">
            <a href="#platform" className="hover:text-white">Platform</a>
            <a href="#coverage" className="hover:text-white">Coverage</a>
            <button type="button" onClick={onSignIn} className="hover:text-white">Sign in</button>
            <button type="button" onClick={onCreateAccount} className="hover:text-white">Create account</button>
          </div>
          <p className="font-mono text-[10px] text-white/25">Segbytes · Nexus console</p>
        </div>
      </footer>
    </main>
  );
}
