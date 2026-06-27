const express = require('express');
const cors = require('cors');

const app = express();

app.set('trust proxy', true);
app.use(cors({ origin: process.env.CORS_ORIGINS === '*' ? true : (process.env.CORS_ORIGINS || '').split(','), credentials: true }));

// Capture raw body for Stripe webhook signature verification
app.use(express.json({
  limit: '2mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'cvf-pt-api' });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/sessions', require('./routes/sessions'));
app.use('/api/progress', require('./routes/progress'));
app.use('/api/programs', require('./routes/programs'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/waivers', require('./routes/waivers'));
app.use('/api/packages', require('./routes/packages'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/dashboard', require('./routes/dashboard'));

module.exports = app;
