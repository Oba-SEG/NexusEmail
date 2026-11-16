// Single source of truth for DNS-provider integrations: the grid on the
// Integrations tab AND the configure-provider modal. Only providers with
// real DNS-management API endpoints in backend/src/services/providers/index.js
// are listed. Registrar-only / no-API providers (Aliyun SDK-required,
// Domains.co.za, WebAfrica, HostAfrica, MWeb, Afrihost, CoolIdeas) used to
// be in this list but were rendered as stubs that couldn't actually fix
// SPF/DMARC records, which was misleading to customers.

  // T160 — Provider metadata is the single source of truth for the
  // integrations grid AND the configure-provider modal. Only providers with
  // real DNS-management API endpoints in backend/src/services/providers/index.js
  // are listed. Registrar-only / no-API providers (Aliyun SDK-required,
  // Domains.co.za, WebAfrica, HostAfrica, MWeb, Afrihost, CoolIdeas) used to
  // be in this list but were rendered as stubs that couldn't actually fix
  // SPF/DMARC records, which was misleading to customers.
  export type ProviderField = {
key: string;
label: string;
placeholder: string;
description: string;
type: 'text' | 'password';
required: boolean;
  };
  export type ProviderMeta = {
category: 'Global' | 'Cloud' | 'Asia';
docsUrl: string;
summary: string;
fields: ProviderField[];
  };
  export const PROVIDER_METADATA: Record<string, ProviderMeta> = {
'Cloudflare': {
  category: 'Global',
  docsUrl: 'https://dash.cloudflare.com/profile/api-tokens',
  summary: 'Edit DNS records via Cloudflare API tokens. Fastest and most reliable.',
  fields: [
    { key: 'api_key', label: 'API Token', placeholder: 'cf-...', type: 'password', required: true,
      description: 'Create a token with Zone:DNS:Edit permission scoped to the relevant zone(s).' },
    { key: 'email', label: 'Account Email', placeholder: 'you@example.com', type: 'text', required: false,
      description: 'Optional. Only needed if the token has not yet superseded API-key authentication on legacy accounts.' },
  ],
},
'AWS Route53': {
  category: 'Cloud',
  docsUrl: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html',
  summary: 'Edit Route53 hosted-zone records via an IAM access key with Route53 write permissions.',
  fields: [
    { key: 'access_key_id', label: 'Access Key ID', placeholder: 'AKIA...', type: 'text', required: true,
      description: 'IAM user / role access-key ID.' },
    { key: 'secret_access_key', label: 'Secret Access Key', placeholder: 'wJalrXUtnFEMI/...', type: 'password', required: true,
      description: 'Corresponding secret. Grant route53:ChangeResourceRecordSets + ListHostedZones.' },
    { key: 'region', label: 'Region', placeholder: 'us-east-1', type: 'text', required: false,
      description: 'Defaults to us-east-1. Route53 is global, but the SDK still requires a region.' },
  ],
},
'GoDaddy': {
  category: 'Global',
  docsUrl: 'https://developer.godaddy.com/keys',
  summary: 'PUT TXT records via the GoDaddy v1 API.',
  fields: [
    { key: 'api_key', label: 'API Key', placeholder: 'gd...', type: 'password', required: true,
      description: 'Generate a Production key (Test keys cannot edit live DNS).' },
    { key: 'secret', label: 'API Secret', placeholder: 'paired secret', type: 'password', required: true,
      description: 'Paired secret issued alongside the API key.' },
  ],
},
'DigitalOcean': {
  category: 'Cloud',
  docsUrl: 'https://cloud.digitalocean.com/account/api/tokens',
  summary: 'Edit DNS records on domains managed by DigitalOcean DNS.',
  fields: [
    { key: 'api_token', label: 'Personal Access Token', placeholder: 'dop_v1_...', type: 'password', required: true,
      description: 'Token must have Write scope on the Domains category.' },
  ],
},
'Vercel': {
  category: 'Cloud',
  docsUrl: 'https://vercel.com/account/tokens',
  summary: 'Edit DNS records on domains managed by Vercel.',
  fields: [
    { key: 'token', label: 'Access Token', placeholder: 'vercel_...', type: 'password', required: true,
      description: 'Account token with full access to the team / personal scope owning the domain.' },
  ],
},
'Namecheap': {
  category: 'Global',
  docsUrl: 'https://ap.www.namecheap.com/settings/tools/apiaccess/',
  summary: 'Edit DNS via the Namecheap XML API. Requires whitelisting your egress IP.',
  fields: [
    { key: 'username', label: 'Namecheap Username', placeholder: 'yourhandle', type: 'text', required: true,
      description: 'Account username (the one that owns the domain).' },
    { key: 'api_key', label: 'API Key', placeholder: 'a1b2c3...', type: 'password', required: true,
      description: 'Enable API access on your account first, then copy the key.' },
    { key: 'ip', label: 'Whitelisted IP', placeholder: 'auto', type: 'text', required: true,
      description: 'Public IP of the Brand Protection backend. Must be whitelisted in Namecheap API settings.' },
  ],
},
'NameSilo': {
  category: 'Global',
  docsUrl: 'https://www.namesilo.com/account/api-manager',
  summary: 'Edit DNS via the NameSilo XML API.',
  fields: [
    { key: 'api_key', label: 'API Key', placeholder: 'ns-...', type: 'password', required: true,
      description: 'Generate from Account → API Manager.' },
  ],
},
'Gandi': {
  category: 'Global',
  docsUrl: 'https://account.gandi.net/en/users/_/security',
  summary: 'Edit LiveDNS records via Apikey authentication.',
  fields: [
    { key: 'api_key', label: 'API Key', placeholder: 'gandi-...', type: 'password', required: true,
      description: 'Generate a personal API key under Account → Security.' },
  ],
},
'DNSimple': {
  category: 'Global',
  docsUrl: 'https://dnsimple.com/user',
  summary: 'Edit zone records via DNSimple v2 API.',
  fields: [
    { key: 'access_token', label: 'Account Access Token', placeholder: 'dnsimple_...', type: 'password', required: true,
      description: 'Generate from User Settings → Access Tokens. Use an Account-level token.' },
    { key: 'account_id', label: 'Account ID', placeholder: '12345', type: 'text', required: true,
      description: 'Numeric ID of your DNSimple account (visible in the URL when logged in).' },
  ],
},
'Linode': {
  category: 'Cloud',
  docsUrl: 'https://cloud.linode.com/profile/tokens',
  summary: 'Edit Linode-managed DNS via personal access token.',
  fields: [
    { key: 'access_token', label: 'Personal Access Token', placeholder: 'linode_...', type: 'password', required: true,
      description: 'Scope must include Domains: Read/Write.' },
  ],
},
'Porkbun': {
  category: 'Global',
  docsUrl: 'https://porkbun.com/account/api',
  summary: 'Edit DNS via Porkbun JSON API. Enable API access on the domain first.',
  fields: [
    { key: 'api_key', label: 'API Key', placeholder: 'pk1_...', type: 'password', required: true,
      description: 'Enable API access in your account, then copy the key.' },
    { key: 'secret', label: 'Secret API Key', placeholder: 'sk1_...', type: 'password', required: true,
      description: 'Paired secret issued alongside the API key.' },
  ],
},
'ClouDNS': {
  category: 'Global',
  docsUrl: 'https://www.cloudns.net/api-settings/',
  summary: 'Edit DNS via the ClouDNS API.',
  fields: [
    { key: 'auth_id', label: 'Auth ID', placeholder: 'numeric ID', type: 'text', required: true,
      description: 'Auth-ID issued by ClouDNS for API access. Sub-auth IDs work too.' },
    { key: 'auth_password', label: 'Auth Password', placeholder: '••••••••', type: 'password', required: true,
      description: 'Paired password for the auth-ID.' },
  ],
},
'Google Cloud DNS': {
  category: 'Cloud',
  docsUrl: 'https://cloud.google.com/dns/docs/reference/v1',
  summary: 'Edit Cloud DNS managed-zone records via OAuth2 access token.',
  fields: [
    { key: 'project_id', label: 'GCP Project ID', placeholder: 'my-project-123', type: 'text', required: true,
      description: 'Project ID hosting the managed zone.' },
    { key: 'access_token', label: 'OAuth2 Access Token', placeholder: 'ya29...', type: 'password', required: true,
      description: 'Short-lived bearer token (use a service account with roles/dns.admin and mint via gcloud auth print-access-token).' },
  ],
},
'Azure DNS': {
  category: 'Cloud',
  docsUrl: 'https://learn.microsoft.com/en-us/azure/dns/dns-sdk',
  summary: 'Edit Azure DNS zone records via the Azure REST API.',
  fields: [
    { key: 'subscription_id', label: 'Subscription ID', placeholder: '00000000-0000-0000-0000-000000000000', type: 'text', required: true,
      description: 'Azure subscription that contains the DNS zone.' },
    { key: 'resource_group', label: 'Resource Group', placeholder: 'my-dns-rg', type: 'text', required: true,
      description: 'Resource group that owns the dnsZones resource.' },
    { key: 'access_token', label: 'OAuth2 Access Token', placeholder: 'eyJ...', type: 'password', required: true,
      description: 'Bearer token for management.azure.com (mint via service principal or az account get-access-token).' },
  ],
},
'DNSPod': {
  category: 'Asia',
  docsUrl: 'https://www.dnspod.cn/console/user/security',
  summary: 'Edit DNS via the DNSPod (Tencent Cloud) login_token API.',
  fields: [
    { key: 'token', label: 'login_token', placeholder: 'id,token', type: 'password', required: true,
      description: 'Format: <id>,<token>. Generate under Security → API Token in the DNSPod console.' },
  ],
},
'NS1': {
  category: 'Global',
  docsUrl: 'https://my.nsone.net/#/account/settings',
  summary: 'Edit NS1 zones via the X-Nsone-Key API.',
  fields: [
    { key: 'api_key', label: 'API Key', placeholder: 'ns1-...', type: 'password', required: true,
      description: 'Generate under Account Settings → API Keys with at least Manage zones permission.' },
  ],
},
'Bunny DNS': {
  category: 'Global',
  docsUrl: 'https://dash.bunny.net/account/api-key',
  summary: 'Edit Bunny DNS records via Bearer-token API.',
  fields: [
    { key: 'api_key', label: 'API Key', placeholder: 'bunny_...', type: 'password', required: true,
      description: 'Account-level API key (DNS zones share the account scope).' },
  ],
},
'UltraDNS': {
  category: 'Global',
  docsUrl: 'https://docs.ultradns.com/',
  summary: 'Edit UltraDNS zones via Basic-auth REST API.',
  fields: [
    { key: 'username', label: 'Username', placeholder: 'your.username', type: 'text', required: true,
      description: 'UltraDNS portal username with zone-edit privileges.' },
    { key: 'password', label: 'Password', placeholder: '••••••••', type: 'password', required: true,
      description: 'Portal password. Recommend dedicating an API user.' },
  ],
},
'EdgeDNS': {
  category: 'Global',
  docsUrl: 'https://techdocs.akamai.com/edge-dns/reference',
  summary: 'Edit Akamai EdgeDNS zones via OAuth2 access token.',
  fields: [
    { key: 'access_token', label: 'EdgeGrid Access Token', placeholder: 'akab-...', type: 'password', required: true,
      description: 'Generated via Akamai Control Center → Identity & Access → API Users.' },
    { key: 'cp_code', label: 'CP Code', placeholder: '12345', type: 'text', required: true,
      description: 'Customer Profile Code that owns the EdgeDNS zone.' },
  ],
},
'Hetzner DNS': {
  category: 'Cloud',
  docsUrl: 'https://dns.hetzner.com/settings/api-token',
  summary: 'Edit Hetzner DNS records via Bearer-token API.',
  fields: [
    { key: 'api_token', label: 'API Token', placeholder: 'hetzner_...', type: 'password', required: true,
      description: 'Generate from DNS Console → Settings → API Tokens.' },
  ],
},
  };

  // T164 — Per-provider brand affordance for the integrations grid.
  // Two-letter monogram + the provider's actual brand colour. Falls back to
  // a neutral gradient if a provider isn't listed.
  export const PROVIDER_BRAND: Record<string, { mono: string; bg: string; text: string }> = {
'Cloudflare':       { mono: 'CF', bg: 'linear-gradient(135deg, #f6821f 0%, #f48120 100%)', text: '#fff' },
'AWS Route53':      { mono: 'R5', bg: 'linear-gradient(135deg, #ff9900 0%, #ff6f00 100%)', text: '#1a1208' },
'GoDaddy':          { mono: 'GD', bg: 'linear-gradient(135deg, #1bdbdb 0%, #00838f 100%)', text: '#fff' },
'DigitalOcean':     { mono: 'DO', bg: 'linear-gradient(135deg, #0080ff 0%, #0069d9 100%)', text: '#fff' },
'Vercel':           { mono: 'VC', bg: 'linear-gradient(135deg, #000 0%, #1a1a1a 100%)', text: '#fff' },
'Namecheap':        { mono: 'NC', bg: 'linear-gradient(135deg, #de3723 0%, #b81d13 100%)', text: '#fff' },
'NameSilo':         { mono: 'NS', bg: 'linear-gradient(135deg, #009688 0%, #00695c 100%)', text: '#fff' },
'Gandi':            { mono: 'GA', bg: 'linear-gradient(135deg, #ff6961 0%, #e63946 100%)', text: '#fff' },
'DNSimple':         { mono: 'DS', bg: 'linear-gradient(135deg, #2c3e50 0%, #1a2530 100%)', text: '#fff' },
'Linode':           { mono: 'LD', bg: 'linear-gradient(135deg, #00a95c 0%, #007c40 100%)', text: '#fff' },
'Porkbun':          { mono: 'PB', bg: 'linear-gradient(135deg, #ef9a9a 0%, #e57373 100%)', text: '#fff' },
'ClouDNS':          { mono: 'CD', bg: 'linear-gradient(135deg, #5b6df3 0%, #3949ab 100%)', text: '#fff' },
'Google Cloud DNS': { mono: 'GC', bg: 'linear-gradient(135deg, #4285f4 0%, #1976d2 100%)', text: '#fff' },
'Azure DNS':        { mono: 'AZ', bg: 'linear-gradient(135deg, #0072c6 0%, #004578 100%)', text: '#fff' },
'DNSPod':           { mono: 'DP', bg: 'linear-gradient(135deg, #00a4ff 0%, #0077c2 100%)', text: '#fff' },
'NS1':              { mono: 'N1', bg: 'linear-gradient(135deg, #25c2a0 0%, #1a8b73 100%)', text: '#fff' },
'Bunny DNS':        { mono: 'BN', bg: 'linear-gradient(135deg, #ff8800 0%, #e07000 100%)', text: '#fff' },
'UltraDNS':         { mono: 'UD', bg: 'linear-gradient(135deg, #d32f2f 0%, #9a0007 100%)', text: '#fff' },
'EdgeDNS':          { mono: 'AK', bg: 'linear-gradient(135deg, #009cde 0%, #0073a8 100%)', text: '#fff' },
'Hetzner DNS':      { mono: 'HZ', bg: 'linear-gradient(135deg, #d50c2d 0%, #a30923 100%)', text: '#fff' },
  };

// Derived provider list for the integrations grid.
export const DNS_PROVIDERS = Object.keys(PROVIDER_METADATA).map(name => ({
  name,
  category: PROVIDER_METADATA[name].category,
  summary: PROVIDER_METADATA[name].summary,
}));

/** Provider brand affordance (monogram + colours) with a neutral fallback. */
export function providerBrand(name: string) {
  return PROVIDER_BRAND[name] || { mono: name.slice(0, 2).toUpperCase(), bg: 'linear-gradient(135deg, #475569 0%, #1e293b 100%)', text: '#fff' };
}
