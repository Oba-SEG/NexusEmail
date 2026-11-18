const dns = require('dns').promises;
const net = require('net');
const nodemailer = require('nodemailer');
const { captureException } = require('../capture');
const db = require('../db/database');
const { escapeHtml } = require('../utils/html');

// SMTP destinations must not be usable as an SSRF pivot (loopback, RFC1918,
// link-local, CGNAT, cloud metadata, ULA). Self-hosters running a LAN mail
// relay can opt out explicitly.
function normalizeAddress(address) {
  const value = String(address || '').trim().toLowerCase();
  // IPv4-mapped IPv6 (::ffff:192.168.0.1 and ::ffff:c0a8:1) classifies by the
  // embedded IPv4 value instead of slipping past the IPv6 prefixes.
  const mapped = value.match(/^::ffff:(?:(\d{1,3}(?:\.\d{1,3}){3})|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/);
  if (mapped) {
    if (mapped[1]) return mapped[1];
    const hi = parseInt(mapped[2], 16);
    const lo = parseInt(mapped[3], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return value;
}

function isPrivateAddress(address) {
  const value = normalizeAddress(address);
  if (net.isIPv4(value)) {
    const [a, b] = value.split('.').map(Number);
    return a === 0 || a === 10 || a === 127
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127);
  }
  if (value === '::1' || value === '::') return true;
  const firstGroup = parseInt(value.split(':')[0] || '0', 16);
  if (Number.isFinite(firstGroup)) {
    if ((firstGroup & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
    if ((firstGroup & 0xfe00) === 0xfc00) return true; // unique-local fc00::/7
  }
  return false;
}

function policyError(message) {
  const error = new Error(message);
  error.code = 'ESMTPPOLICY';
  return error;
}

// Resolve once and return the address Nodemailer must connect to, so a
// second DNS answer cannot bypass the policy. Null means the private-host
// opt-out is enabled and the hostname is used as-is.
async function resolveSmtpConnectAddress(host) {
  if (process.env.ALLOW_PRIVATE_SMTP_HOSTS === 'true') return null;
  const resolved = await dns.lookup(host, { all: true });
  if (!resolved.length) throw policyError('SMTP host did not resolve');
  if (resolved.some((entry) => isPrivateAddress(entry.address))) {
    throw policyError('SMTP host resolves to a private or local address');
  }
  return resolved[0].address;
}

// Connection errors must not echo raw Nodemailer internals to API callers.
function describeSmtpError(error) {
  switch (error && error.code) {
    case 'EAUTH':
      return 'SMTP authentication failed. Check the username and password.';
    case 'ENOTFOUND':
    case 'EDNS':
      return 'SMTP host did not resolve.';
    case 'ETIMEDOUT':
    case 'ECONNECTION':
    case 'ESOCKET':
      return 'SMTP connection failed. Check host, port, and TLS settings.';
    case 'ETLS':
      return 'SMTP server rejected the TLS upgrade. Check the port and TLS mode.';
    case 'ESMTPPOLICY':
      return error.message;
    default:
      return 'SMTP connection failed.';
  }
}

const DEFAULT_RESEND_API_BASE = 'https://api.resend.com';
const DEFAULT_FROM = 'Nexus Brand Protection <noreply@brandprotection.segbytes.co.za>';

class NotificationService {
  constructor(config = {}) {
    this.config = config;
    this.transporter = null;
    this.resend = null;
    this.slackWebhook = null;
    this.smtpConfigError = null;
  }

  // Configure SMTP
  configureSMTP(config) {
    // Connect to the pre-validated address (SSRF pinning) while keeping the
    // original hostname for certificate verification. Credentialed sessions
    // always verify the peer certificate.
    const tlsOptions = { ...(config.tls || {}) };
    if (config.auth) tlsOptions.rejectUnauthorized = true;
    if (config.connectAddress) tlsOptions.servername = config.host;
    this.transporter = nodemailer.createTransport({
      host: config.connectAddress || config.host,
      port: config.port,
      secure: config.secure,
      // With credentials configured, refuse to send them over a plaintext
      // connection: fail instead of silently skipping STARTTLS.
      requireTLS: !!config.auth,
      auth: config.auth ? {
        user: config.auth.user,
        pass: config.auth.pass
      } : undefined,
      tls: Object.keys(tlsOptions).length ? tlsOptions : undefined
    });
    this.config = config;
    return this.transporter;
  }

  // Configure Resend (HTTP email API — no outbound SMTP ports needed)
  configureResend(config = {}) {
    const apiKey = config.apiKey || config.api_key;
    if (!apiKey) return null;
    this.resend = { apiKey, from: config.from || this.config.from || DEFAULT_FROM, apiBase: config.apiBase || DEFAULT_RESEND_API_BASE };
    return this.resend;
  }

  // Configure Slack (incoming webhook)
  configureSlack(webhookUrl) {
    this.slackWebhook = webhookUrl || null;
    return this.slackWebhook;
  }

  // Build an SMTP-only instance from stored settings. Channel tests must
  // exercise the channel they name: a saved Resend key must not shadow the
  // SMTP transport (createForOrg prefers Resend).
  static async createSmtpForOrg(orgId) {
    const svc = new NotificationService();
    const smtpRaw = await db.getSetting('smtp_config', orgId);
    if (smtpRaw) {
      try {
        const smtp = JSON.parse(smtpRaw);
        if (smtp.host && smtp.host.trim()) {
          const connectAddress = await resolveSmtpConnectAddress(smtp.host);
          svc.configureSMTP({
            ...smtp,
            connectAddress,
            auth: smtp.user && smtp.pass ? { user: smtp.user, pass: smtp.pass } : undefined
          });
        }
      } catch (e) {
        captureException(e);
        svc.smtpConfigError = describeSmtpError(e);
      }
    }
    return svc;
  }

  // Build an instance pre-configured from the org's stored settings.
  // Prefers Resend for email when configured, falls back to SMTP.
  static async createForOrg(orgId) {
    const svc = new NotificationService();
    const [smtpRaw, resendRaw, slackWebhook] = await Promise.all([
      db.getSetting('smtp_config', orgId),
      db.getSetting('resend_config', orgId),
      db.getSetting('slack_webhook', orgId)
    ]);
    if (resendRaw) {
      try { svc.configureResend(JSON.parse(resendRaw)); } catch (e) { captureException(e); }
    }
    if (!svc.resend && smtpRaw) {
      try {
        const smtp = JSON.parse(smtpRaw);
        if (smtp.host && smtp.host.trim()) {
          const connectAddress = await resolveSmtpConnectAddress(smtp.host);
          svc.configureSMTP({
            ...smtp,
            connectAddress,
            auth: smtp.user && smtp.pass ? { user: smtp.user, pass: smtp.pass } : undefined
          });
        }
      } catch (e) { captureException(e); }
    }
    if (slackWebhook) svc.configureSlack(slackWebhook);
    return svc;
  }

  // Test SMTP connection
  async testConnection() {
    try {
      if (this.smtpConfigError) {
        return { success: false, error: this.smtpConfigError };
      }
      if (!this.transporter) {
        return { success: false, error: 'SMTP not configured' };
      }
      await this.transporter.verify();
      return { success: true, message: 'SMTP connection successful' };
    } catch (error) {
      captureException(error);
      return { success: false, error: describeSmtpError(error) };
    }
  }

  // Test Resend connection — sends a real (small) email
  async testResend(to) {
    try {
      if (!this.resend) return { success: false, error: 'Resend not configured' };
      return await this.sendViaResend(
        to,
        'Nexus Brand Protection — test email',
        '<p>Resend delivery is working.</p>'
      );
    } catch (error) {
      captureException(error);
      return { success: false, error: error.message };
    }
  }

  async sendViaResend(to, subject, html, options = {}) {
    try {
      if (!this.resend) return { success: false, error: 'Resend not configured' };
      const payload = {
        from: this.resend.from,
        to: [to],
        subject,
        html,
        text: this.stripHtml(html)
      };
      // Map common SMTP-style options to Resend's fields.
      if (options.replyTo) payload.reply_to = options.replyTo;
      if (options.cc) payload.cc = Array.isArray(options.cc) ? options.cc : [options.cc];
      if (options.bcc) payload.bcc = Array.isArray(options.bcc) ? options.bcc : [options.bcc];
      const response = await fetch(`${this.resend.apiBase}/emails`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.resend.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const err = result.message || `HTTP ${response.status}`;
        return { success: false, error: err };
      }
      return { success: true, provider: 'resend', id: result.id };
    } catch (error) {
      captureException(error);
      return { success: false, error: error.message };
    }
  }

  // Send Slack message via incoming webhook
  async sendSlack({ text, blocks }) {
    try {
      if (!this.slackWebhook) return { success: false, error: 'Slack not configured' };
      const response = await fetch(this.slackWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, blocks })
      });
      const body = await response.text();
      if (!response.ok || body !== 'ok') {
        return { success: false, error: body || `HTTP ${response.status}` };
      }
      return { success: true, provider: 'slack' };
    } catch (error) {
      captureException(error);
      return { success: false, error: error.message };
    }
  }

  // Build a Slack-only instance: the webhook test must not wait on SMTP DNS.
  static async createSlackForOrg(orgId) {
    const svc = new NotificationService();
    const slackWebhook = await db.getSetting('slack_webhook', orgId);
    if (slackWebhook) svc.configureSlack(slackWebhook);
    return svc;
  }

  // Test Slack — sends a real message to the webhook
  async testSlack() {
    try {
      if (!this.slackWebhook) return { success: false, error: 'Slack not configured' };
      return await this.sendSlack({
        text: '✅ Nexus Brand Protection connected to this channel'
      });
    } catch (error) {
      captureException(error);
      return { success: false, error: error.message };
    }
  }

  // Send email notification (Resend preferred, SMTP fallback)
  async sendNotification(to, subject, body, options = {}) {
    if (this.resend) {
      return await this.sendViaResend(to, subject, body, options);
    }
    if (!this.transporter) {
      console.log('[Notifications] No email channel configured, skipping email');
      return { success: false, error: 'No email channel configured' };
    }

    try {
      const info = await this.transporter.sendMail({
        from: this.config.from || DEFAULT_FROM,
        to,
        subject,
        html: body,
        text: this.stripHtml(body),
        ...options
      });

      return { success: true, messageId: info.messageId };
    } catch (error) {
      captureException(error);
      return { success: false, error: error.message };
    }
  }

  // Dispatch a scan result to email + Slack based on org notification prefs.
  static async dispatchScanResults(orgId, domain, results) {
    const out = {};
    const prefs = await NotificationService.getPrefs(orgId);
    if (!prefs.scan_completed) return { skipped: true };

    const svc = await NotificationService.createForOrg(orgId);
    if (domain.notify_email) {
      out.email = await svc.sendScanResults(domain.name, results, domain.notify_email);
    }
    if (svc.slackWebhook) {
      out.slack = await svc.sendSlack({
        text: `🔍 *Scan complete:* ${domain.name} — score ${results.score}/100 (${results.issues?.length || 0} issues)`
      });
    }
    return out;
  }

  // Dispatch a critical alert to email + Slack.
  static async dispatchCriticalAlert(orgId, domain, message) {
    const out = {};
    const prefs = await NotificationService.getPrefs(orgId);
    if (!prefs.critical_alerts) return { skipped: true };

    const svc = await NotificationService.createForOrg(orgId);
    if (domain.notify_email) {
      out.email = await svc.sendCriticalAlert(domain.name, [{ message }], domain.notify_email);
    }
    if (svc.slackWebhook) {
      out.slack = await svc.sendSlack({ text: `🚨 *Critical:* ${domain.name} — ${message}` });
    }
    return out;
  }

  static async getPrefs(orgId) {
    const vals = await Promise.all([
      db.getSetting('notify_scan_completed', orgId),
      db.getSetting('notify_critical_alerts', orgId),
      db.getSetting('notify_weekly_report', orgId)
    ]);
    return {
      scan_completed: vals[0] !== '0',      // default on
      critical_alerts: vals[1] !== '0',     // default on
      weekly_report: vals[2] === '1'        // default off
    };
  }

  // Slack webhooks only live on hooks.slack.com — anything else is an SSRF
  // vector (the backend would happily POST to internal services otherwise).
  static isValidSlackWebhook(url) {
    return /^https:\/\/hooks\.slack\.com\/services\//.test(url);
  }

  // Send scan results notification
  async sendScanResults(domain, results, to) {
    const scoreColor = results.score >= 70 ? 'green' : results.score >= 40 ? 'orange' : 'red';

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .score { font-size: 48px; font-weight: bold; color: ${scoreColor}; }
          .score-label { font-size: 14px; color: #666; }
          .issues { margin: 20px 0; }
          .issue { background: white; padding: 15px; margin: 10px 0; border-radius: 8px; border-left: 4px solid #667eea; }
          .issue.high { border-color: #ef4444; }
          .issue.medium { border-color: #f59e0b; }
          .rec { background: white; padding: 15px; margin: 10px 0; border-radius: 8px; }
          .rec-code { background: #1e293b; color: #10b981; padding: 10px; border-radius: 5px; font-family: monospace; font-size: 12px; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0;">Brand Protection Scan Results</h1>
            <p style="margin: 10px 0 0 0;">Domain: ${escapeHtml(domain)}</p>
          </div>
          <div class="content">
            <div style="text-align: center; margin-bottom: 30px;">
              <div class="score">${results.score}</div>
              <div class="score-label">Security Health Score</div>
            </div>

            <h3>Record Status</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>SPF</strong></td>
                <td style="padding: 10px; border-bottom: 1px solid #eee;">
                  <span style="color: ${results.spf?.found ? (results.spf.policy === 'hardfail' ? 'green' : 'orange') : 'red'}">
                    ${escapeHtml(results.spf?.found ? (results.spf.policy || 'weak') : 'Not Found')}
                  </span>
                </td>
              </tr>
              <tr>
                <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>DKIM</strong></td>
                <td style="padding: 10px; border-bottom: 1px solid #eee;">
                  <span style="color: ${results.dkim?.found ? 'green' : 'red'}">
                    ${escapeHtml(results.dkim?.found ? `${results.dkim.selectors.length} selector(s)` : 'Not Found')}
                  </span>
                </td>
              </tr>
              <tr>
                <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>DMARC</strong></td>
                <td style="padding: 10px; border-bottom: 1px solid #eee;">
                  <span style="color: ${results.dmarc?.found ? (results.dmarc.policy === 'reject' ? 'green' : 'orange') : 'red'}">
                    ${escapeHtml(results.dmarc?.found ? (results.dmarc.policy || 'none') : 'Not Found')}
                  </span>
                </td>
              </tr>
            </table>

            ${results.issues?.length > 0 ? `
            <h3>Issues Found (${results.issues.length})</h3>
            <div class="issues">
              ${results.issues.map(issue => `
                <div class="issue ${escapeHtml(issue.severity)}">
                  <strong>${escapeHtml(issue.type)}</strong><br>
                  ${escapeHtml(issue.message)}
                </div>
              `).join('')}
            </div>
            ` : ''}

            ${results.recommendations?.length > 0 ? `
            <h3>Recommendations</h3>
            ${results.recommendations.map(rec => `
              <div class="rec">
                <strong>${escapeHtml(rec.action)}</strong> (${escapeHtml(rec.priority)})<br>
                <div class="rec-code">${escapeHtml(rec.command || rec.action)}</div>
              </div>
            `).join('')}
            ` : ''}

            <p style="margin-top: 30px;">
              <a href="#" style="display: inline-block; background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
                View Full Report
              </a>
            </p>
          </div>
          <div class="footer">
            <p>Nexus Brand Protection</p>
            <p>This email was sent automatically based on your notification settings</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendNotification(
      to,
      `🔍 Brand Protection Scan: ${domain} - Score ${results.score}/100`,
      html
    );
  }

  // Send bulk scan summary
  async sendBulkSummary(results, to) {
    const passCount = results.filter(r => r.score >= 70).length;
    const warnCount = results.filter(r => r.score >= 40 && r.score < 70).length;
    const failCount = results.filter(r => r.score < 40).length;

    const html = `
      <h2>Bulk Scan Summary</h2>
      <p><strong>Total Domains:</strong> ${results.length}</p>
      <p><strong style="color: green;">Passing:</strong> ${passCount}</p>
      <p><strong style="color: orange;">Warnings:</strong> ${warnCount}</p>
      <p><strong style="color: red;">Failed:</strong> ${failCount}</p>

      <h3>Domains Requiring Attention</h3>
      <ul>
        ${results.filter(r => r.score < 70).map(r => `
          <li>${escapeHtml(r.domain)} - Score: ${Number(r.score) || 0}</li>
        `).join('')}
      </ul>
    `;

    return await this.sendNotification(
      to,
      `📊 Brand Protection Bulk Scan: ${passCount}/${results.length} Passing`,
      html
    );
  }

  // Alert on critical issues
  async sendCriticalAlert(domain, issues, to) {
    const html = `
      <h2 style="color: red;">⚠️ Critical Security Alert</h2>
      <p><strong>Domain:</strong> ${escapeHtml(domain)}</p>
      <p><strong>Issues:</strong></p>
      <ul>
        ${issues.map(i => `<li>${escapeHtml(i.message)}</li>`).join('')}
      </ul>
      <p>Please take immediate action to secure this domain.</p>
    `;

    return await this.sendNotification(
      to,
      `🚨 CRITICAL: ${domain} Security Alert`,
      html
    );
  }

  stripHtml(html) {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|tr|ul|ol|blockquote)>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (m, e) =>
        ({ nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[e]))
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}

module.exports = { NotificationService };
