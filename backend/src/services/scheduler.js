const cron = require('node-cron');
const { getDatabase } = require('../db/database');
const { DNSService } = require('./dnsProviders');
const { captureException } = require('../capture');

function startScheduledScans() {
  // Run daily at 2 AM
  cron.schedule('0 2 * * *', async () => {
    console.log('🔄 Starting scheduled domain scans...');
    await runScheduledScans();
  });

  // Run every 6 hours for critical domains
  cron.schedule('0 */6 * * *', async () => {
    console.log('🔄 Running critical domain health check...');
    await runCriticalScans();
  });

  console.log('✅ Scheduled scans initialized');
}

async function runScheduledScans() {
  const db = getDatabase();
  const domains = db.prepare('SELECT * FROM domains WHERE status = ?').all('active');
  const dnsService = new DNSService();
  
  for (const domain of domains) {
    try {
      const [spf, dkim, dmarc] = await Promise.all([
        dnsService.checkSPF(domain.name),
        dnsService.checkDKIM(domain.name),
        dnsService.checkDMARC(domain.name)
      ]);
      
      const score = dnsService.calculateHealthScore(spf, dkim, dmarc);
      
      db.prepare(`
        INSERT INTO scans (domain_id, score, spf_status, dkim_status, dmarc_status, 
          spf_record, dkim_selectors, dmarc_record, issues)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        domain.id,
        score,
        spf.status,
        dkim.status,
        dmarc.status,
        JSON.stringify(spf),
        JSON.stringify(dkim.selectors),
        JSON.stringify(dmarc),
        JSON.stringify([])
      );
      
      console.log(`✅ Scanned ${domain.name} - Score: ${score}`);
    } catch (error) {
      captureException(error);
      console.error(`❌ Error scanning ${domain.name}:`, error.message);
    }
  }
}

async function runCriticalScans() {
  const db = getDatabase();
  const criticalDomains = db.prepare(`
    SELECT d.*, s.score as last_score 
    FROM domains d 
    LEFT JOIN scans s ON d.id = s.domain_id 
    WHERE d.status = 'active' 
    ORDER BY s.score ASC 
    LIMIT 10
  `).all();
  
  const dnsService = new DNSService();
  
  for (const domain of criticalDomains) {
    try {
      const [spf, dkim, dmarc] = await Promise.all([
        dnsService.checkSPF(domain.name),
        dnsService.checkDKIM(domain.name),
        dnsService.checkDMARC(domain.name)
      ]);
      
      const score = dnsService.calculateHealthScore(spf, dkim, dmarc);
      
      // Save but don't flood - only alert if score changed significantly
      if (Math.abs(score - (domain.last_score || 0)) > 10) {
        console.log(`⚠️ ${domain.name} score changed: ${domain.last_score || 'N/A'} -> ${score}`);
      }
    } catch (error) {
      captureException(error);
      console.error(`❌ Error on critical scan ${domain.name}:`, error.message);
    }
  }
}

module.exports = { startScheduledScans, runScheduledScans };