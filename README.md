# NexusEmail

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License">
  <img src="https://img.shields.io/badge/node-%5E20.19%20%7C%7C%20%5E22.13%20%7C%7C%20%3E%3D24-blue.svg" alt="Node.js">
  <img src="https://img.shields.io/badge/nextjs-14-black.svg" alt="Next.js">
</p>

<p align="center">
  <strong>Open-source email security auditing platform</strong><br>
  Scan, monitor, and fix DMARC, SPF, and DKIM records for your domains.
</p>

---

## Features

- **DNS Scanning** — Comprehensive DMARC, SPF, DKIM, MTA-STS, TLS-RPT analysis
- **Multi-Provider Support** — Cloudflare, AWS Route53, GoDaddy, Namecheap, Azure, Google, DigitalOcean, Vercel
- **Anti-Impersonation Detection** — Domain spoofing analysis
- **Auto-Remediation** — One-click fixes for common issues
- **Health Scoring** — 0-100 score with actionable insights
- **Scheduled Scans** — Automatic daily health checks
- **Email Notifications** — SMTP alerts for scan results and critical issues
- **Reports** — HTML and CSV export
- **Beautiful UI** — Polished shadcn/ui with dark mode support

## Quick Start

### Prerequisites

- Node.js matching `^20.19.0 || ^22.13.0 || >=24.0.0` (required by the test toolchain — vitest 3 / vite 7 / jsdom 29; note this excludes Node 21 and 23)

### Installation

```bash
# Clone the repository
git clone https://github.com/obakeng-SEG/NexusEmail.git
cd NexusEmail
```

### Backend

```bash
cd backend
npm install
npm run dev
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The app will be available at `http://localhost:3000`

## Configuration (UI-Based)

All settings are configurable via the web interface - no `.env` editing required:

1. **Provider Credentials**: Go to Settings to add API keys for Cloudflare, AWS, GoDaddy, etc.
2. **SMTP Settings**: Configure email notifications via Settings
3. **Scan Schedule**: Enable automatic scans
4. **Auto-Remediation**: Enable one-click fixes

## Usage

### Adding a Domain

1. Open `http://localhost:3000`
2. Enter your domain name
3. Click "Scan" to run an initial audit

### Running Scans

- **Manual Scan**: Click the scan button on any domain
- **Bulk Scan**: Scan all domains at once
- **Scheduled**: Scans run automatically at 2 AM daily

### Connecting DNS Providers

1. Go to **DNS providers**
2. Add your provider credentials
3. Generate fix recommendations from a domain's remediation panel; records are applied manually

## Architecture

```
NexusEmail/
├── frontend/          # Next.js 14 + shadcn/ui
│   └── app/          # React components & pages
├── backend/          # Node.js Express API
│   └── src/
│       ├── routes/   # API endpoints
│       ├── services/ # DNS scanning & providers
│       └── db/       # JSON database
└── data/             # Local storage
```

## Tech Stack

- **Frontend**: Next.js 14, React 18, shadcn/ui, Tailwind CSS
- **Backend**: Node.js, Express, JSON file storage

## License

MIT License

---

Built with ☕ and frustration over manually checking DNS records.