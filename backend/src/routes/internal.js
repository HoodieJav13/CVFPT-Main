const crypto = require('node:crypto');
const express = require('express');
const { logError } = require('../utils/logger');
const { sendDailyDigests } = require('../services/email');

const router = express.Router();

function secretMatches(header, expected) {
  const supplied = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!supplied || !expected) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.get('/digest', async (req, res) => {
  if (!secretMatches(req.get('authorization'), process.env.CRON_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    return res.json(await sendDailyDigests(new Date()));
  } catch (error) {
    logError('daily digest error', error);
    return res.status(500).json({ error: 'Failed to send daily digest' });
  }
});

module.exports = { router, secretMatches };
