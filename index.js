require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./src/db/pool');

const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use('/auth', require('./src/routes/auth'));
app.use('/locations', require('./src/routes/locations'));
app.use('/routes', require('./src/routes/routes'));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Init DB schema
async function initDB() {
  const fs = require('fs');
  const path = require('path');
  try {
    const schema = fs.readFileSync(path.join(__dirname, 'src/db/schema.sql'), 'utf8');
    await pool.query(schema);
    console.log('✅ Database schema initialized');
  } catch (err) {
    console.error('DB init error:', err.message);
  }
}

const PORT = process.env.PORT || 4000;
app.listen(PORT, async () => {
  await initDB();
  console.log(`🚀 Server running on port ${PORT}`);
});
