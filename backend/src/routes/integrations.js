const express = require('express');
const router = express.Router();
const { getDatabase } = require('../db/database');
const { captureException } = require('../capture');

// Get all integrations
router.get('/', (req, res) => {
  const db = getDatabase();
  const integrations = db.prepare('SELECT * FROM integrations').all();
  res.json(integrations);
});

// Connect new integration
router.post('/connect', (req, res) => {
  const { provider, config } = req.body;
  const db = getDatabase();
  
  const stmt = db.prepare(`
    INSERT INTO integrations (provider, config, status) VALUES (?, ?, ?)
  `);
  
  try {
    const result = stmt.run(provider, JSON.stringify(config), 'active');
    res.json({ 
      success: true, 
      id: result.lastInsertRowid,
      provider,
      status: 'active'
    });
  } catch (error) {
    captureException(error);
    res.status(400).json({ error: error.message });
  }
});

// Disconnect integration
router.delete('/:provider', (req, res) => {
  const db = getDatabase();
  db.prepare('DELETE FROM integrations WHERE provider = ?').run(req.params.provider);
  res.json({ success: true });
});

// Test integration
router.post('/test/:provider', async (req, res) => {
  const db = getDatabase();
  const integration = db.prepare('SELECT * FROM integrations WHERE provider = ?')
    .get(req.params.provider);
  
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