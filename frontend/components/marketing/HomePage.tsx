"use client";

import {
  ArrowRight, BarChart3, Check, FileCheck2, Globe2, LockKeyhole,
  MailCheck, Radar, ShieldCheck,
} from "lucide-react";

interface HomePageProps {
  onSignIn: () => void;
  onCreateAccount: () => void;
}

const COVERAGE = ["SPF", "DKIM", "DMARC", "MTA-STS", "TLS-RPT", "Brand watch"];

const FEATURES = [
  {
    number: "01",
    icon: Globe2,
    title: "See the whole perimeter",
    body: "SPF, DKIM, DMARC, MTA-STS and TLS-RPT in one posture score. Every finding names the record, the risk, and the fix.",
  },
  {
    number: "02",
    icon: Radar,
    title: "Catch impersonation early",
    body: "Watch for typosquats and lookalike domains, triage what is registered, and keep the evidence attached to the threat.",
  },
  {
    number: "03",
    icon: FileCheck2,
    title: "Prove the work",
    body: "Shareable reports, scan history and DMARC aggregate insights for the people who ask, 'are we actually safer?'",
  },
];

const STEPS = [
  { number: "01", title: "Add a domain", body: "Paste the domain. Nexus reads the public DNS records — no agent, no MX change." },
  { number: "02", title: "Fix the top signal", body: "One next action per domain, with the exact record and provider-ready guidance." },
  { number: "03", title: "Keep watch", body: "Scheduled rescans, brand lookalikes and digests keep the perimeter current." },
];

function RecordField() {
  const line = "v=DMARC1; p=reject; rua=mailto:dmarc@example.com   _dmarc TXT   v=spf1 include:_spf.example.com -all   selector1._domainkey CNAME   ";
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden font-mono text-[9px] leading-[1.85] tracking-[0.06em] text-[#7a3515]/20">
      {Array.from({ length: 22 }).map((_, i) => (
        <p key={i} className="whitespace-nowrap">{line.repeat(3)}</p>
      ))}
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
    <div className="overflow-hidden rounded-[18px] border border-[#3a2a21] bg-[#141110] shadow-[0_40px_100px_-32px_rgba(52,24,10,0.55)]">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="nbp-mark flex h-6 w-6 items-center justify-center text-[9px]">N</span>
          <span className="text-[11px] font-medium text-white/80">Nexus</span>
          <span className="text-[10px] text-white/30">/</span>
          <span className="font-mono text-[10.5px] text-white/55">aperture.co</span>
        </div>
        <span className="rounded-full border border-[#ff9d52]/25 bg-[#ff9d52]/10 px-2 py-0.5 font-mono text-[9.5px] text-[#ffb987]">
          scanned 2m ago
        </span>
      </div>
      <div className="grid gap-px bg-white/[0.06] md:grid-cols-[1.35fr_1fr]">
        <div className="bg-[#141110] p-5 md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] text-white/40">Domain posture</p>
              <p className="mt-1 text-[19px] font-semibold tracking-[-0.02em] text-white">aperture.co</p>
              <p className="mt-1 text-[11px] text-white/40">4 passing · 1 to review</p>
            </div>
            <div className="text-right">
              <p className="font-serif text-[48px] leading-none text-[#ff9d52]">92</p>
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
        <div className="bg-[#100e0d] p-5 md:p-6">
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
    <main className="min-h-screen overflow-x-hidden bg-[#f5f0e9] text-[#211511]">
      <div className="bg-[#2b120d] px-4 py-2.5 text-center text-[11.5px] text-[#f5e5d9]">
        <button type="button" onClick={onCreateAccount} className="group inline-flex items-center gap-1.5">
          Workspaces are open. Bring your domains into focus.
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>

      <header className="sticky top-0 z-50 border-b border-[#d9cdc1] bg-[#f5f0e9]/90 backdrop-blur-md">
        <div className="mx-auto flex h-[68px] max-w-[1320px] items-center gap-8 px-5 sm:px-8">
          <a href="#top" className="flex flex-shrink-0 items-center gap-2.5" aria-label="Nexus home">
            <span className="nbp-mark flex h-8 w-8 items-center justify-center text-[11px]">N</span>
            <span className="text-[17px] font-semibold tracking-[-0.03em]">Nexus</span>
          </a>
          <nav className="hidden items-center gap-7 text-[12.5px] text-[#5e4c42] md:flex">
            <a href="#platform" className="transition-colors hover:text-[#211511]">Platform</a>
            <a href="#coverage" className="transition-colors hover:text-[#211511]">Coverage</a>
            <a href="#how" className="transition-colors hover:text-[#211511]">How it works</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={onSignIn} className="rounded-full px-3.5 py-2 text-[12px] font-medium text-[#4a392f] transition-colors hover:bg-[#e9dfd4] hover:text-[#211511]">
              Sign in
            </button>
            <button type="button" onClick={onCreateAccount} className="inline-flex items-center gap-1.5 rounded-full bg-[#ff9d52] px-4 py-2 text-[12px] font-semibold text-[#28140a] transition-colors hover:bg-[#ffad6d]">
              Get started
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>

      <section id="top" className="relative">
        <div className="mx-auto max-w-[1120px] px-6 pb-10 pt-20 text-center sm:pt-28">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[#8a5a3f]">Email security, owned end to end</p>
          <h1 className="mx-auto mt-6 max-w-[980px] font-serif text-[clamp(3.5rem,8.8vw,7.4rem)] leading-[0.92] tracking-[-0.035em] text-[#211511]">
            Own your email perimeter.
          </h1>
          <p className="mx-auto mt-7 max-w-[620px] text-[15.5px] leading-7 text-[#5e4c42] sm:text-[17px]">
            Nexus turns DNS, DMARC and brand signals into one clear answer:
            what is exposed, what to fix first, and what changed since yesterday.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button type="button" onClick={onCreateAccount} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[#211511] px-6 text-[13px] font-semibold text-[#fbf6f0] transition-colors hover:bg-[#3a241b]">
              Start a workspace
              <ArrowRight className="h-4 w-4" />
            </button>
            <button type="button" onClick={onSignIn} className="inline-flex h-11 items-center justify-center rounded-full px-5 text-[13px] font-medium text-[#4a392f] transition-colors hover:bg-[#eadfd4]">
              Sign in to your console
            </button>
          </div>
          <p className="mt-5 text-[11px] text-[#8b7567]">No credit card. No DNS changes to get your first score.</p>
        </div>

        <div className="relative h-[250px] overflow-hidden bg-[linear-gradient(180deg,#f5f0e9_0%,#ffd8bb_42%,#ffb27e_100%)] sm:h-[300px]">
          <RecordField />
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#f5f0e9] to-transparent" />
          <div className="relative z-10 mx-auto flex max-w-[1000px] flex-wrap items-center justify-center gap-x-7 gap-y-3 px-6 pt-14 text-[11px] font-medium text-[#6d371d]">
            {COVERAGE.map((item) => (
              <span key={item} className="inline-flex items-center gap-1.5">
                <Check className="h-3 w-3" /> {item}
              </span>
            ))}
          </div>
        </div>

        <div className="relative z-20 mx-auto -mt-16 max-w-[1080px] px-5 sm:px-8">
          <ConsolePreview />
        </div>
      </section>

      <section id="platform" className="mx-auto max-w-[1180px] px-6 py-24 sm:py-32">
        <div className="grid gap-10 border-b border-[#d9cdc1] pb-14 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-[#8a5a3f]">The operator&apos;s console</p>
          <h2 className="font-serif text-[clamp(2.6rem,5.8vw,5.1rem)] leading-[0.98] tracking-[-0.03em]">
            Built for the people<br className="hidden sm:block" /> who own the inbox.
          </h2>
        </div>
        <div className="grid gap-px bg-[#d9cdc1] md:grid-cols-3">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <article key={feature.number} className="bg-[#f5f0e9] px-1 py-8 md:px-0">
                <div className="flex items-center justify-between px-5 md:px-6">
                  <span className="font-mono text-[10px] text-[#a08472]">{feature.number}</span>
                  <Icon className="h-5 w-5 text-[#a34e1d]" strokeWidth={1.6} />
                </div>
                <h3 className="mt-10 px-5 font-serif text-[29px] leading-[1.05] tracking-[-0.02em] md:px-6">{feature.title}</h3>
                <p className="mt-3 px-5 text-[12.5px] leading-6 text-[#6b584c] md:px-6">{feature.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section id="coverage" className="bg-[#20120f] py-24 text-[#f6ece4] sm:py-32">
        <div className="mx-auto max-w-[1180px] px-6">
          <div className="grid gap-12 lg:grid-cols-[1fr_1fr] lg:gap-20">
            <div>
              <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-[#d58b5d]">One perimeter</p>
              <h2 className="mt-5 font-serif text-[clamp(2.8rem,6vw,5.4rem)] leading-[0.96] tracking-[-0.03em]">
                From DNS record<br /> to takedown.
              </h2>
              <p className="mt-6 max-w-[460px] text-[14px] leading-7 text-[#c9b6a9]">
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
                      <h3 className="text-[13px] font-medium text-[#f6ece4]">{title as string}</h3>
                      <p className="mt-1.5 max-w-[480px] text-[12px] leading-5 text-[#9f8b7f]">{body as string}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-[1180px] px-6 py-24 sm:py-32">
        <div className="flex flex-col gap-5 border-b border-[#d9cdc1] pb-10 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-[#8a5a3f]">How it works</p>
            <h2 className="mt-4 font-serif text-[clamp(2.6rem,5vw,4.4rem)] leading-[0.98] tracking-[-0.03em]">Three moves to a smaller surface.</h2>
          </div>
          <button type="button" onClick={onCreateAccount} className="inline-flex flex-shrink-0 items-center gap-1.5 text-[12px] font-medium text-[#a34e1d] hover:text-[#7a3515]">
            Create your workspace <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="grid gap-10 pt-12 md:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.number}>
              <p className="font-mono text-[10px] text-[#a08472]">{step.number}</p>
              <h3 className="mt-6 text-[15px] font-semibold tracking-[-0.01em]">{step.title}</h3>
              <p className="mt-2 text-[12.5px] leading-6 text-[#6b584c]">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-[linear-gradient(180deg,#f5f0e9_0%,#ffd9bd_55%,#ffb17c_100%)] px-6 py-24 sm:py-32">
        <div className="mx-auto max-w-[900px] text-center">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-[#7a3a18]">Start with one domain</p>
          <h2 className="mt-5 font-serif text-[clamp(3rem,7vw,6rem)] leading-[0.92] tracking-[-0.035em]">
            Close the gap between<br /> alert and fix.
          </h2>
          <p className="mx-auto mt-6 max-w-[520px] text-[14px] leading-7 text-[#613d29]">
            Get the first posture score in minutes. Invite the rest of the team when you are ready.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button type="button" onClick={onCreateAccount} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[#211511] px-6 text-[13px] font-semibold text-[#fbf6f0] transition-colors hover:bg-[#3a241b]">
              Create a workspace <ArrowRight className="h-4 w-4" />
            </button>
            <button type="button" onClick={onSignIn} className="inline-flex h-11 items-center justify-center rounded-full border border-[#b97f59]/50 px-5 text-[13px] font-medium text-[#4a2a18] transition-colors hover:bg-white/20">
              Sign in
            </button>
          </div>
        </div>
      </section>

      <footer className="bg-[#20120f] px-6 py-10 text-[#b7a397]">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <span className="nbp-mark flex h-7 w-7 items-center justify-center text-[10px]">N</span>
            <span className="text-[13px] font-medium text-[#f6ece4]">Nexus</span>
            <span className="text-[11px] text-[#7f6a5d]">Brand protection</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px]">
            <a href="#platform" className="hover:text-[#f6ece4]">Platform</a>
            <a href="#coverage" className="hover:text-[#f6ece4]">Coverage</a>
            <button type="button" onClick={onSignIn} className="hover:text-[#f6ece4]">Sign in</button>
            <button type="button" onClick={onCreateAccount} className="hover:text-[#f6ece4]">Create account</button>
          </div>
          <p className="text-[10.5px] text-[#6f5b4f]">Segbytes · Email security console</p>
        </div>
      </footer>
    </main>
  );
}
