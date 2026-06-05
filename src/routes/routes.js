const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../db/pool');
const auth = require('../middleware/auth');

const router = express.Router();

// Haversine distance in km
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Nearest neighbor TSP heuristic
function nearestNeighbor(locations) {
  if (locations.length === 0) return [];
  // Always start with the first pickup if any, else first item
  const start = locations.find((l) => l.type === 'pickup') || locations[0];
  const remaining = locations.filter((l) => l.id !== start.id);
  const ordered = [start];

  while (remaining.length > 0) {
    const last = ordered[ordered.length - 1];
    let minDist = Infinity;
    let minIdx = 0;
    remaining.forEach((loc, idx) => {
      const d = haversine(last.lat, last.lng, loc.lat, loc.lng);
      if (d < minDist) { minDist = d; minIdx = idx; }
    });
    ordered.push(remaining.splice(minIdx, 1)[0]);
  }

  // Calculate total distance
  let total = 0;
  for (let i = 1; i < ordered.length; i++) {
    total += haversine(ordered[i - 1].lat, ordered[i - 1].lng, ordered[i].lat, ordered[i].lng);
  }

  return { ordered, totalDistance: Math.round(total * 10) / 10 };
}

// GET /api/routes
router.get('/', auth, async (req, res) => {
  try {
    const routes = await pool.query(
      'SELECT * FROM routes WHERE user_id=$1 ORDER BY created_at DESC',
      [req.user.id]
    );

    const result = await Promise.all(
      routes.rows.map(async (route) => {
        const stops = await pool.query(
          `SELECT rs.*, l.name, l.address, l.lat, l.lng, l.type
           FROM route_stops rs
           JOIN locations l ON l.id = rs.location_id
           WHERE rs.route_id=$1
           ORDER BY rs.stop_order`,
          [route.id]
        );
        return { ...route, stops: stops.rows };
      })
    );

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/routes/optimize - optimize given location IDs
router.post('/optimize', auth, async (req, res) => {
  const { locationIds } = req.body;
  if (!Array.isArray(locationIds) || locationIds.length < 2) {
    return res.status(400).json({ error: 'Need at least 2 location IDs' });
  }
  try {
    const placeholders = locationIds.map((_, i) => `$${i + 2}`).join(',');
    const result = await pool.query(
      `SELECT * FROM locations WHERE user_id=$1 AND id IN (${placeholders})`,
      [req.user.id, ...locationIds]
    );
    const { ordered, totalDistance } = nearestNeighbor(result.rows);
    res.json({ optimized: ordered, totalDistanceKm: totalDistance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/routes - create and save a route
router.post(
  '/',
  auth,
  [body('name').trim().notEmpty(), body('locationIds').isArray({ min: 2 })],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, locationIds } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Fetch locations
      const placeholders = locationIds.map((_, i) => `$${i + 2}`).join(',');
      const locResult = await client.query(
        `SELECT * FROM locations WHERE user_id=$1 AND id IN (${placeholders})`,
        [req.user.id, ...locationIds]
      );
      const { ordered, totalDistance } = nearestNeighbor(locResult.rows);

      const routeResult = await client.query(
        'INSERT INTO routes (user_id, name, total_distance_km) VALUES ($1,$2,$3) RETURNING *',
        [req.user.id, name, totalDistance]
      );
      const route = routeResult.rows[0];

      for (let i = 0; i < ordered.length; i++) {
        await client.query(
          'INSERT INTO route_stops (route_id, location_id, stop_order) VALUES ($1,$2,$3)',
          [route.id, ordered[i].id, i + 1]
        );
      }

      await client.query('COMMIT');
      res.status(201).json({ ...route, stops: ordered });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    } finally {
      client.release();
    }
  }
);

// PATCH /api/routes/:id/status
router.patch('/:id/status', auth, async (req, res) => {
  const { status } = req.body;
  if (!['planned', 'in_progress', 'completed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  try {
    const completed_at = status === 'completed' ? new Date() : null;
    const result = await pool.query(
      'UPDATE routes SET status=$1, completed_at=$2 WHERE id=$3 AND user_id=$4 RETURNING *',
      [status, completed_at, req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/routes/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM routes WHERE id=$1 AND user_id=$2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
