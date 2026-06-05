const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../db/pool');
const auth = require('../middleware/auth');

const router = express.Router();

// GET /api/locations - get all for current user
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM locations WHERE user_id=$1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/locations
router.post(
  '/',
  auth,
  [
    body('name').trim().notEmpty(),
    body('address').trim().notEmpty(),
    body('lat').isFloat(),
    body('lng').isFloat(),
    body('type').isIn(['pickup', 'delivery']),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, address, lat, lng, type } = req.body;
    try {
      const result = await pool.query(
        'INSERT INTO locations (user_id, name, address, lat, lng, type) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
        [req.user.id, name, address, lat, lng, type]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// DELETE /api/locations/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM locations WHERE id=$1 AND user_id=$2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
