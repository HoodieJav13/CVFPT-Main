require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const app = require('./app');

const PORT = process.env.PORT || 8001;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`CVF PT API listening on 0.0.0.0:${PORT}`);
});
