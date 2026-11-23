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

## Optional: Google sign-in

Google sign-in stays hidden until three backend environment variables are set:

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://nexusapi.segbytes.xyz/api/auth/google/callback
```

1. In Google Cloud Console, create an OAuth 2.0 **Web application** client.
2. Add the callback above to **Authorized redirect URIs** (and the staging API callback if needed).
3. Set the three variables in the backend `.env` and restart it.

The first Google sign-in creates a workspace and owner account; the account has
no password until one is set. If an email already belongs to a password
account, Google sign-in asks the user to sign in with that password instead of
silently linking the accounts. Set `GOOGLE_APP_REDIRECT` only to force a return
URL; otherwise the console returns to the allowlisted origin it started from.

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