const express = require('express');
const cors = require('cors');
const { corsConfiguration, createCorsOriginCheck } = require('./config/cors');

const app = express();
const corsConfig = corsConfiguration(process.env);

// Vercel places one trusted proxy hop in front of the Express function.
// A numeric hop count prevents clients from selecting an arbitrary left-most IP.
app.set('trust proxy', 1);
app.use(cors({
  origin: createCorsOriginCheck(corsConfig.origins),
  credentials: corsConfig.credentials,
}));

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
app.use('/api/check-ins', require('./routes/checkins'));
app.use('/api/programs', require('./routes/programs'));
app.use('/api/resources', require('./routes/resources'));
app.use('/api/resource-categories', require('./routes/resourceCategories'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/waivers', require('./routes/waivers'));
app.use('/api/packages', require('./routes/packages'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/workout-logs', require('./routes/workoutLogs'));
app.use('/api/notifications', require('./routes/notifications'));

module.exports = app;
