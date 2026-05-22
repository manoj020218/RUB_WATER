const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const env = require('./config/env');
const apiRoutes = require('./routes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { seedIfEmpty } = require('./db/seed');
const { resetStore } = require('./db/datastore');
const { forbidden } = require('./utils/errors');

function normalizeOrigin(origin) {
  if (!origin) {
    return '';
  }
  return String(origin).trim().replace(/\/+$/, '');
}

function createApp(options = {}) {
  if (options.resetStore === true) {
    resetStore();
  }

  if (options.seed !== false) {
    seedIfEmpty();
  }

  const app = express();
  app.use(helmet());
  const allowedOriginSet = new Set(
    env.corsAllowedOrigins.map((origin) => normalizeOrigin(origin.toLowerCase()))
  );
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || env.corsAllowAll) {
          return callback(null, true);
        }

        const normalizedOrigin = normalizeOrigin(origin.toLowerCase());
        if (allowedOriginSet.has(normalizedOrigin)) {
          return callback(null, true);
        }

        return callback(
          forbidden(
            `CORS blocked for origin: ${origin}. Allowed origins: ${env.corsAllowedOrigins.join(', ')}`
          )
        );
      },
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-API-Key',
        'X-Device-Key',
        'X-Provision-Key'
      ]
    })
  );
  app.use(express.json({ limit: '1mb' }));

  const dashboardDir = path.resolve(__dirname, '..', '..', 'dashboard');
  app.use('/dashboard', express.static(dashboardDir));
  app.get('/', (req, res) => {
    res.redirect('/dashboard/FloodGuard_Desktop_UI.html');
  });

  app.get('/health', (req, res) => {
    res.json({
      ok: true,
      data: {
        service: env.appName,
        project: env.projectName,
        status: 'UP',
        timestamp: new Date().toISOString()
      }
    });
  });

  app.use('/api', apiRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = {
  createApp
};
