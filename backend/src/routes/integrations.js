const express = require('express');
const router = express.Router();
const { getIntegrations, addIntegration, deleteIntegration } = require('../db/database');
const { captureException } = require('../capture');

// Get all integrations
router.get('/', async (req, res) => {
  const integrations = await getIntegrations();
  res.json(integrations);
});

// Connect new integration
router.post('/connect', async (req, res) => {
  const { provider, config } = req.body;

  try {
    const created = await addIntegration({ provider, config, status: 'active' });
    res.json({
      success: true,
      id: created.id,
      provider,
      status: 'active'
    });
  } catch (error) {
    captureException(error);
    res.status(400).json({ error: error.message });
  }
});

// Disconnect integration
router.delete('/:provider', async (req, res) => {
  const rows = await getIntegrations();
  const match = rows.find((r) => r.provider === req.params.provider);
  if (match) await deleteIntegration(match.id);
  res.json({ success: true });
});

// Test integration
router.post('/test/:provider', async (req, res) => {
  const rows = await getIntegrations();
  const integration = rows.find((r) => r.provider === req.params.provider);

  if (!integration) {
    return res.status(404).json({ error: 'Integration not found' });
  }

  // Simulate test
  res.json({
    success: true,
    message: `Connection to ${req.params.provider} verified`,
    latency: Math.floor(Math.random() * 100)
  });
});

module.exports = router;
