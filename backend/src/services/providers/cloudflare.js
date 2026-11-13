// Cloudflare DNS Provider
const { Cloudflare } = require('cloudflare');

class CloudflareProvider {
  constructor(config) {
    this.cf = new Cloudflare({ token: config.apiToken });
    this.email = config.email;
  }

  async getZoneId(domain) {
    try {
      const zones = await this.cf.zones.browse({ name: domain });
      return zones.result?.[0]?.id || null;
    } catch (e) {
      console.error('[Cloudflare] Failed to get zone:', e.message);
      return null;
    }
  }

  // Real auth probe: list zones (page 1). Fails on invalid/expired tokens
  // and on tokens without Zone:Read, instead of hardcoding success.
  async testConnection() {
    const start = Date.now();
    try {
      const zones = await this.cf.zones.browse({ per_page: 1 });
      return {
        success: zones.success !== false,
        latency: Date.now() - start,
        zones: (zones.result || []).length
      };
    } catch (e) {
      console.error('[Cloudflare] Test connection failed:', e.message);
      return { success: false, error: e.message };
    }
  }

  async createTXTRecord(name, content, domain) {
    try {
      const zoneId = await this.getZoneId(domain);
      if (!zoneId) return { success: false, error: 'Zone not found' };

      const result = await this.cf.dnsRecords.create(zoneId, {
        type: 'TXT',
        name: name,
        content: content,
        ttl: 3600
      });

      return { success: true, provider: 'cloudflare', record: result.result };
    } catch (e) {
      console.error('[Cloudflare] Create failed:', e.message);
      return { success: false, error: e.message };
    }
  }

  async deleteTXTRecord(name, domain) {
    try {
      const zoneId = await this.getZoneId(domain);
      if (!zoneId) return { success: false, error: 'Zone not found' };

      const records = await this.cf.dnsRecords.read({ zone_id: zoneId, name: name, type: 'TXT' });
      if (records.result?.[0]) {
        await this.cf.dnsRecords.delete(zoneId, records.result[0].id);
      }
      return { success: true, provider: 'cloudflare' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async listRecords(domain) {
    try {
      const zoneId = await this.getZoneId(domain);
      if (!zoneId) return { success: false, error: 'Zone not found' };

      const records = await this.cf.dnsRecords.browse({ zone_id: zoneId });
      return { success: true, records: records.result || [] };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}

module.exports = { CloudflareProvider };