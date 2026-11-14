# NexusEmail Hosted Segbytes Plan

## Product direction
NexusEmail stays free/open-source, but Segbytes will also run a hosted instance for client organizations.

## Hosted requirements
- Segbytes admin can create client organizations.
- Each organization has its own users.
- Domains, scans, integrations, settings, reports, and brand-protection data are scoped by organization.
- Users authenticate before accessing the dashboard/API.

## Implemented first slice
- Local JWT auth.
- Seeded Segbytes admin tenant for development.
- Organization/user data model.
- Segbytes admin endpoint to create client organizations and first owner.
- Auth-required API routes.
- Tenant scoping across active JSON-backed data operations.
- Frontend login screen and bearer-token API calls.
- Production guardrails for JWT secret and first admin password.

## Production environment required
- `JWT_SECRET` or `NEXUSEMAIL_JWT_SECRET`
- `SEED_ADMIN_EMAIL`
- `SEED_ADMIN_PASSWORD` on first production boot
- `ALLOWED_ORIGINS` set to the hosted frontend URL

## Next implementation steps
1. Add client-organization provisioning from the Segbytes billing/client portal.
2. Add organization switch/admin UI for Segbytes staff.
3. Move JSON storage to Postgres/SQLite before serious multi-client production use.
4. Add audit logs for login, domain changes, provider credentials, and remediation actions.

## Employee delegation model
Use agency-agents as Segbytes employees for this work:
- Software Architect: tenancy/auth architecture review.
- Backend Architect: org/user/data isolation implementation.
- Frontend Developer: hosted login/client UI.
- Security Engineer: auth, tenant isolation, provider credential handling, audit logs.
- DevOps Automator: hosted deployment, envs, backups, health checks.
- Project Shepherd: execution board, milestones, blockers.



## Platform/hosting notes
- Platform admin is separated from tenant owner/admin via `platform_role`.
- `NEXUSEMAIL_DATA_DIR` allows production data to live outside the deploy directory.
- WHMCS integration was removed in 2026 (no longer linked); login is direct email/password.

## Hosting decision update
- Hosted product name: Nexus Brand Protection.
- Repository/codebase may remain NexusEmail for now.
- Hosting target is a plain Ubuntu LTS VM, not cPanel.
- Runtime supervisor: PM2, not systemd app services.
- Public URLs:
  - Frontend: `https://brandprotection.segbytes.co.za`
  - API: `https://api.brandprotection.segbytes.co.za/api`
- VM paths:
  - App: `/opt/nexus-brand-protection/app`
  - Data: `/var/lib/nexus-brand-protection`
  - Env: `/etc/nexus-brand-protection`
  - Backups: `/backup/nexus-brand-protection`
