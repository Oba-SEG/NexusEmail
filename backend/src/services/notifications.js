const nodemailer = require('nodemailer');
const { captureException } = require('../capture');
const db = require('../db/database');

const DEFAULT_RESEND_API_BASE = 'https://api.resend.com';
const DEFAULT_FROM = 'Nexus Brand Protection <noreply@brandprotection.segbytes.co.za>';

class NotificationService {
  constructor(config = {}) {
    this.config = config;
    this.transporter = null;
    this.resend = null;
    this.slackWebhook = null;
  }

  // Configure SMTP
  configureSMTP(config) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth ? {
        user: config.auth.user,
        pass: config.auth.pass
      } : undefined,
      tls: config.tls ? {
        rejectUnauthorized: false
      } : undefined
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
          svc.configureSMTP({
            ...smtp,
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
      if (!this.transporter) {
        return { success: false, error: 'SMTP not configured' };
      }
      const result = await this.transporter.verify();
      return { success: true, message: 'SMTP connection successful' };
    } catch (error) {
      captureException(error);
      return { success: false, error: error.message };
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
            <p style="margin: 10px 0 0 0;">Domain: ${domain}</p>
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
                    ${results.spf?.found ? (results.spf.policy || 'weak') : 'Not Found'}
                  </span>
                </td>
              </tr>
              <tr>
                <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>DKIM</strong></td>
                <td style="padding: 10px; border-bottom: 1px solid #eee;">
                  <span style="color: ${results.dkim?.found ? 'green' : 'red'}">
                    ${results.dkim?.found ? `${results.dkim.selectors.length} selector(s)` : 'Not Found'}
                  </span>
                </td>
              </tr>
              <tr>
                <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>DMARC</strong></td>
                <td style="padding: 10px; border-bottom: 1px solid #eee;">
                  <span style="color: ${results.dmarc?.found ? (results.dmarc.policy === 'reject' ? 'green' : 'orange') : 'red'}">
                    ${results.dmarc?.found ? (results.dmarc.policy || 'none') : 'Not Found'}
                  </span>
                </td>
              </tr>
            </table>

            ${results.issues?.length > 0 ? `
            <h3>Issues Found (${results.issues.length})</h3>
            <div class="issues">
              ${results.issues.map(issue => `
                <div class="issue ${issue.severity}">
                  <strong>${issue.type}</strong><br>
                  ${issue.message}
                </div>
              `).join('')}
            </div>
            ` : ''}

            ${results.recommendations?.length > 0 ? `
            <h3>Recommendations</h3>
            ${results.recommendations.map(rec => `
              <div class="rec">
                <strong>${rec.action}</strong> (${rec.priority})<br>
                <div class="rec-code">${rec.command || rec.action}</div>
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
          <li>${r.domain} - Score: ${r.score}</li>
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
      <p><strong>Domain:</strong> ${domain}</p>
      <p><strong>Issues:</strong></p>
      <ul>
        ${issues.map(i => `<li>${i.message}</li>`).join('')}
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
    return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }
}

module.exports = { NotificationService };
