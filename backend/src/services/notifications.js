const nodemailer = require('nodemailer');
const { captureException } = require('../capture');

class NotificationService {
  constructor(config = {}) {
    this.config = config;
    this.transporter = null;
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

  // Send email notification
  async sendNotification(to, subject, body, options = {}) {
    if (!this.transporter) {
      console.log('[Notifications] SMTP not configured, skipping email');
      return { success: false, error: 'SMTP not configured' };
    }

    try {
      const info = await this.transporter.sendMail({
        from: this.config.from || 'Nexus Brand Protection <noreply@brandprotection.segbytes.co.za>',
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