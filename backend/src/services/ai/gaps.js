'use strict';

const IMAGE_OR_PDF = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
const EMAIL_FILE = ['message/rfc822', 'application/vnd.ms-outlook'];

const GAP_LIBRARY = {
  screenshot: {
    label: 'Screenshot of the live page',
    reason: 'A timestamped screenshot is the primary proof of infringement.',
    accepted_mime: IMAGE_OR_PDF,
  },
  trademark_certificate: {
    label: 'Trademark certificate',
    reason: 'Registrars and hosts require proof of the mark before acting.',
    accepted_mime: IMAGE_OR_PDF,
  },
  authorization_letter: {
    label: 'Authorization letter',
    reason: 'Brand-protection agents must prove they can act for the mark owner.',
    accepted_mime: IMAGE_OR_PDF,
  },
  phishing_email: {
    label: 'Original phishing email',
    reason: 'Hosts need the original message with full headers to trace abuse.',
    accepted_mime: EMAIL_FILE,
  },
};

function uploadKind(key) {
  return `upload_${String(key || '').replace(/[^a-z0-9_]/gi, '_').toLowerCase()}`;
}

function collectedKinds(artifacts) {
  return new Set((artifacts || []).map((artifact) => artifact.kind));
}

function addGap(gaps, key) {
  const entry = GAP_LIBRARY[key];
  if (!entry) return;
  gaps.push({
    key,
    label: entry.label,
    reason: entry.reason,
    accepted_mime: entry.accepted_mime,
    user_action_required: true,
  });
}

function hasUsable(artifacts, kind) {
  return (artifacts || []).some((artifact) => artifact.kind === kind && artifact.status === 'ok' && artifact.storage_key);
}

function computeEvidenceGaps(threat, artifacts, recommendedRoute) {
  const kinds = collectedKinds(artifacts);
  const gaps = [];

  if (!hasUsable(artifacts, 'screenshot') && !kinds.has(uploadKind('screenshot'))) {
    addGap(gaps, 'screenshot');
  }
  if (!kinds.has(uploadKind('trademark_certificate'))) {
    addGap(gaps, 'trademark_certificate');
  }
  if (['registrar', 'host', 'unknown'].includes(recommendedRoute) && !kinds.has(uploadKind('authorization_letter'))) {
    addGap(gaps, 'authorization_letter');
  }
  if (String(threat?.threat_type || '').toLowerCase() === 'phishing' && !kinds.has(uploadKind('phishing_email'))) {
    addGap(gaps, 'phishing_email');
  }

  return gaps;
}

module.exports = {
  GAP_LIBRARY,
  uploadKind,
  computeEvidenceGaps,
};
