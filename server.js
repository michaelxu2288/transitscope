require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const fetch = global.fetch || require('node-fetch');
const { loadTransitDataset } = require('./src/data-loader');
const IsochroneEngine = require('./src/isochrone-engine');
const { SCORING_PROFILES, resolveWeights } = require('./src/scoring');
const { createSavedLocationStore } = require('./src/saved-location-store');

const PORT = Number(process.env.PORT) || 3000;
const SALT_ROUNDS = 10;
const DEMO_USER_ID = 1; // Fallback for unauthenticated users

// Simple in-memory session store (for demo purposes)
const sessions = new Map();

function createPool() {
  return mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'transitscope',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });
}

function unpackProcedureRows(resultSets, index = 0) {
  if (!Array.isArray(resultSets)) {
    return [];
  }
  if (Array.isArray(resultSets[index])) {
    return resultSets[index];
  }
  return index === 0 ? resultSets : [];
}

function listenWithRetry(app, desiredPort, maxAttempts = 5) {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const tryListen = (port) => {
      const server = app
        .listen(port, () => {
          resolve({ server, port });
        })
        .once('error', (error) => {
          if (error.code === 'EADDRINUSE' && attempt < maxAttempts) {
            console.warn(
              `Port ${port} is busy; attempting ${(port + 1)} (attempt ${attempt + 2}/${maxAttempts + 1})`,
            );
            attempt += 1;
            tryListen(port + 1);
          } else {
            reject(error);
          }
        });
    };
    tryListen(desiredPort);
  });
}

// Session helpers
function generateSessionId() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

function createSession(userId) {
  const sessionId = generateSessionId();
  sessions.set(sessionId, { userId, createdAt: Date.now() });
  return sessionId;
}

function getSession(sessionId) {
  return sessions.get(sessionId);
}

function destroySession(sessionId) {
  sessions.delete(sessionId);
}

// Auth middleware
function authMiddleware(req, res, next) {
  const sessionId = req.headers['x-session-id'];
  if (!sessionId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const session = getSession(sessionId);
  if (!session) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  req.userId = session.userId;
  next();
}

// Optional auth middleware (doesn't fail if not authenticated)
function optionalAuthMiddleware(req, res, next) {
  const sessionId = req.headers['x-session-id'];
  if (sessionId) {
    const session = getSession(sessionId);
    if (session) {
      req.userId = session.userId;
    }
  }
  next();
}

async function bootstrap() {
  try {
    const pool = createPool();
    const dataset = await loadTransitDataset(pool);
    const isoEngine = new IsochroneEngine(dataset);
    const savedLocationStore = await createSavedLocationStore(pool, DEMO_USER_ID);

    const app = express();
    app.use(cors());
    app.use(express.json({ limit: '2mb' }));
    app.use(express.static(path.join(__dirname, 'public')));

    app.get('/api/app-config', (_req, res) => {
      res.json({
        poiCategories: dataset.poiCategories,
        scoringProfiles: SCORING_PROFILES,
        travelOptions: [15, 30, 45, 60],
        defaultLocation: dataset.defaultLocation,
        datasetStats: dataset.stats,
      });
    });

    // ==================== AUTH ENDPOINTS ====================

    // Register a new user
    app.post('/api/auth/register', async (req, res) => {
      const { username, email, password } = req.body;
      if (!username || !email || !password) {
        return res.status(400).json({ error: 'Username, email, and password are required' });
      }
      if (username.length < 3) {
        return res.status(400).json({ error: 'Username must be at least 3 characters' });
      }
      if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
      }
      try {
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
        const [result] = await pool.query(
          'INSERT INTO Users (username, email, password_hash) VALUES (?, ?, ?)',
          [username, email, passwordHash]
        );
        const sessionId = createSession(result.insertId);
        res.status(201).json({
          user: {
            user_id: result.insertId,
            username,
            email,
          },
          sessionId,
        });
      } catch (error) {
        console.error('Registration error:', error);
        if (error.code === 'ER_DUP_ENTRY') {
          return res.status(409).json({ error: 'Username or email already exists' });
        }
        res.status(500).json({ error: 'Failed to register user' });
      }
    });

    // Login
    app.post('/api/auth/login', async (req, res) => {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }
      try {
        const [rows] = await pool.query(
          'SELECT user_id, username, email, password_hash FROM Users WHERE email = ?',
          [email]
        );
        if (rows.length === 0) {
          return res.status(401).json({ error: 'Invalid email or password' });
        }
        const user = rows[0];
        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) {
          return res.status(401).json({ error: 'Invalid email or password' });
        }
        const sessionId = createSession(user.user_id);
        res.json({
          user: {
            user_id: user.user_id,
            username: user.username,
            email: user.email,
          },
          sessionId,
        });
      } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Failed to login' });
      }
    });

    // Logout
    app.post('/api/auth/logout', (req, res) => {
      const sessionId = req.headers['x-session-id'];
      if (sessionId) {
        destroySession(sessionId);
      }
      res.json({ success: true });
    });

    // Get current user
    app.get('/api/auth/me', authMiddleware, async (req, res) => {
      try {
        const [rows] = await pool.query(
          'SELECT user_id, username, email, last_saved_at FROM Users WHERE user_id = ?',
          [req.userId]
        );
        if (rows.length === 0) {
          return res.status(404).json({ error: 'User not found' });
        }
        res.json(rows[0]);
      } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ error: 'Failed to fetch user' });
      }
    });

    // ==================== USER CRUD ENDPOINTS ====================

    // Get user by ID
    app.get('/api/users/:id', authMiddleware, async (req, res) => {
      const { id } = req.params;
      // Users can only view their own profile
      if (Number(id) !== req.userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      try {
        const [rows] = await pool.query(
          'SELECT user_id, username, email, last_saved_at FROM Users WHERE user_id = ?',
          [id]
        );
        if (rows.length === 0) {
          return res.status(404).json({ error: 'User not found' });
        }
        res.json(rows[0]);
      } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ error: 'Failed to fetch user' });
      }
    });

    // Update user
    app.put('/api/users/:id', authMiddleware, async (req, res) => {
      const { id } = req.params;
      // Users can only update their own profile
      if (Number(id) !== req.userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      const { username, email, password } = req.body;
      if (!username && !email && !password) {
        return res.status(400).json({ error: 'At least one field to update is required' });
      }
      try {
        const updates = [];
        const values = [];
        if (username) {
          if (username.length < 3) {
            return res.status(400).json({ error: 'Username must be at least 3 characters' });
          }
          updates.push('username = ?');
          values.push(username);
        }
        if (email) {
          updates.push('email = ?');
          values.push(email);
        }
        if (password) {
          if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
          }
          const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
          updates.push('password_hash = ?');
          values.push(passwordHash);
        }
        values.push(id);
        await pool.query(
          `UPDATE Users SET ${updates.join(', ')} WHERE user_id = ?`,
          values
        );
        const [rows] = await pool.query(
          'SELECT user_id, username, email, last_saved_at FROM Users WHERE user_id = ?',
          [id]
        );
        res.json(rows[0]);
      } catch (error) {
        console.error('Error updating user:', error);
        if (error.code === 'ER_DUP_ENTRY') {
          return res.status(409).json({ error: 'Username or email already exists' });
        }
        res.status(500).json({ error: 'Failed to update user' });
      }
    });

    // Delete user
    app.delete('/api/users/:id', authMiddleware, async (req, res) => {
      const { id } = req.params;
      // Users can only delete their own account
      if (Number(id) !== req.userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      try {
        const [result] = await pool.query('DELETE FROM Users WHERE user_id = ?', [id]);
        if (result.affectedRows === 0) {
          return res.status(404).json({ error: 'User not found' });
        }
        // Destroy the session
        const sessionId = req.headers['x-session-id'];
        if (sessionId) {
          destroySession(sessionId);
        }
        res.json({ success: true, message: 'Account deleted successfully' });
      } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ error: 'Failed to delete user' });
      }
    });

    // ==================== END AUTH/USER ENDPOINTS ====================

    app.get('/api/analytics/top-routes', async (req, res) => {
      const limit = Number(req.query.limit) || 8;
      try {
        const [resultSets] = await pool.query('CALL sp_top_routes(?)', [limit]);
        const rows = unpackProcedureRows(resultSets);
        res.json(rows);
      } catch (error) {
        console.error('Error loading top routes', error);
        res.status(500).json({ error: 'Failed to load top routes' });
      }
    });

    app.get('/api/geocode', async (req, res) => {
      const query = (req.query.q || req.query.query || '').trim();
      if (!query) {
        return res.status(400).json({ error: 'Please provide a query parameter ?q=' });
      }
      try {
        const url = new URL('https://nominatim.openstreetmap.org/search');
        url.searchParams.set('format', 'jsonv2');
        url.searchParams.set('limit', '5');
        url.searchParams.set('q', query);
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'TransitScope/1.0 (cs411-team037@illinois.edu)',
          },
        });
        if (!response.ok) {
          throw new Error(`Geocoder HTTP ${response.status}`);
        }
        const payload = await response.json();
        const results = payload.map((row) => ({
          label: row.display_name,
          latitude: Number(row.lat),
          longitude: Number(row.lon),
        }));
        res.json(results);
      } catch (error) {
        console.error('Geocode error', error);
        res.status(502).json({ error: 'Geocoder unavailable' });
      }
    });

    app.post('/api/isochrone', (req, res) => {
      const { latitude, longitude, maxMinutes, categories, profileId, customWeights } = req.body;
      if (latitude == null || longitude == null) {
        return res.status(400).json({ error: 'latitude and longitude are required' });
      }
      const weights = resolveWeights(profileId, customWeights);
      try {
        const snapshot = isoEngine.computeIsochrone({
          latitude,
          longitude,
          maxMinutes: maxMinutes || 30,
          categories,
          weights,
        });
        res.json({
          ...snapshot,
          weights,
        });
      } catch (error) {
        console.error('Isochrone error', error);
        res.status(500).json({ error: 'Failed to compute isochrone' });
      }
    });

    app.post('/api/compare', (req, res) => {
      const { origins, maxMinutes, categories, profileId, customWeights } = req.body;
      if (!Array.isArray(origins) || origins.length < 2) {
        return res.status(400).json({ error: 'Please provide two or more origins to compare' });
      }
      const weights = resolveWeights(profileId, customWeights);

      try {
        const results = origins.map((origin) => {
          const snapshot = isoEngine.computeIsochrone({
            latitude: origin.latitude,
            longitude: origin.longitude,
            maxMinutes,
            categories,
            weights,
          });
          return {
            label: origin.label || 'Untitled pin',
            ...snapshot,
          };
        });
        res.json({
          maxMinutes,
          weights,
          results,
        });
      } catch (error) {
        console.error('Comparison error', error);
        res.status(500).json({ error: 'Failed to compute comparison' });
      }
    });

    app.get('/api/saved-locations', optionalAuthMiddleware, async (req, res) => {
      const userId = req.userId || DEMO_USER_ID;
      try {
        const [rows] = await pool.query(
          `
          SELECT s.location_id,
                 s.name,
                 s.address,
                 s.latitude,
                 s.longitude,
                 s.created_at,
                 u.username
          FROM SavedLocations s
          JOIN Users u ON u.user_id = s.user_id
          WHERE s.user_id = ?
          ORDER BY s.created_at DESC
        `,
          [userId],
        );
        const locations = rows.map((row) => ({
          location_id: row.location_id,
          name: row.name,
          address: row.address,
          latitude: row.latitude,
          longitude: row.longitude,
          created_at: row.created_at,
          username: row.username,
        }));
        res.json(locations);
      } catch (error) {
        console.error('Error fetching saved locations:', error);
        res.status(500).json({ error: 'Failed to fetch saved locations' });
      }
    });

    app.post('/api/saved-locations', optionalAuthMiddleware, async (req, res) => {
      const userId = req.userId || DEMO_USER_ID;
      const { name, address, latitude, longitude } = req.body;
      if (!name || latitude == null || longitude == null) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [result] = await connection.query(
          `
          INSERT INTO SavedLocations (user_id, name, address, latitude, longitude)
          VALUES (?, ?, ?, ?, ?)
        `,
          [userId, name, address || null, latitude, longitude],
        );
        const [reportSets] = await connection.query('CALL sp_saved_location_report(?)', [userId]);
        await connection.commit();

        const summarySet = unpackProcedureRows(reportSets, 0);
        const historySet = unpackProcedureRows(reportSets, 1);
        const summary = summarySet && summarySet[0] ? summarySet[0] : null;
        const history = historySet || [];

        res.status(201).json({
          location_id: result.insertId,
          user_id: userId,
          name,
          address: address || null,
          latitude,
          longitude,
          report: { summary, history },
        });
      } catch (error) {
        await connection.rollback();
        console.error('Error creating saved location:', error);
        res.status(500).json({ error: 'Failed to create saved location' });
      } finally {
        connection.release();
      }
    });

    app.delete('/api/saved-locations/:id', optionalAuthMiddleware, async (req, res) => {
      const userId = req.userId || DEMO_USER_ID;
      const { id } = req.params;
      try {
        // Verify the location belongs to the user
        const [existing] = await pool.query(
          'SELECT location_id FROM SavedLocations WHERE location_id = ? AND user_id = ?',
          [id, userId]
        );
        if (existing.length === 0) {
          return res.status(404).json({ error: 'Location not found' });
        }
        await pool.query('DELETE FROM SavedLocations WHERE location_id = ? AND user_id = ?', [id, userId]);
        res.json({ success: true });
      } catch (error) {
        console.error('Error deleting saved location:', error);
        res.status(500).json({ error: 'Failed to delete saved location' });
      }
    });

    app.put('/api/saved-locations/:id', optionalAuthMiddleware, async (req, res) => {
      const userId = req.userId || DEMO_USER_ID;
      const { id } = req.params;
      const { name, address, latitude, longitude } = req.body;
      if (!name || latitude == null || longitude == null) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      try {
        const [result] = await pool.query(
          `
          UPDATE SavedLocations
          SET name = ?, address = ?, latitude = ?, longitude = ?
          WHERE location_id = ? AND user_id = ?
        `,
          [name, address || null, latitude, longitude, id, userId],
        );
        if (result.affectedRows === 0) {
          return res.status(404).json({ error: 'Location not found' });
        }
        const [rows] = await pool.query(
          `
          SELECT location_id, name, address, latitude, longitude, created_at
          FROM SavedLocations
          WHERE location_id = ? AND user_id = ?
        `,
          [id, userId],
        );
        res.json(rows[0]);
      } catch (error) {
        console.error('Error updating saved location:', error);
        res.status(500).json({ error: 'Failed to update saved location' });
      }
    });

    app.get('/api/saved-locations/report', optionalAuthMiddleware, async (req, res) => {
      const userId = req.userId || DEMO_USER_ID;
      try {
        const [reportSets] = await pool.query('CALL sp_saved_location_report(?)', [userId]);
        const summarySet = unpackProcedureRows(reportSets, 0);
        const historySet = unpackProcedureRows(reportSets, 1);
        const summary = summarySet && summarySet[0] ? summarySet[0] : null;
        const history = historySet || [];
        res.json({ summary, history });
      } catch (error) {
        console.error('Error fetching saved location report', error);
        res.status(500).json({ error: 'Failed to fetch report' });
      }
    });

    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    try {
      const { port } = await listenWithRetry(app, PORT, Number(process.env.PORT_RETRIES) || 5);
      console.log(`TransitScope ready on http://localhost:${port}`);
    } catch (error) {
      console.error('Unable to bind HTTP server:', error.message);
      process.exit(1);
    }
  } catch (error) {
    console.error('Failed to bootstrap the TransitScope server', error);
    process.exit(1);
  }
}

bootstrap();
