import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';

import { appConfig, securityConfig } from './config/index.js';
import { getDatabase } from './database/connection.js';
import { SQLiteSessionStore } from './services/sqlite-session-store.js';
import { setupCsrf, verifyCsrf } from './middleware/csrf.js';
import { generalLimiter } from './middleware/rate-limit.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';

// Route imports
import authRoutes from './modules/auth/auth.routes.js';
import directorRoutes from './modules/director/director.routes.js';
import virtualOfficeRoutes from './modules/virtual-office/virtual-office.routes.js';
import agentRoutes from './modules/agents/agent.routes.js';
import taskRoutes from './modules/tasks/task.routes.js';
import projectRoutes from './modules/projects/project.routes.js';
import activityRoutes from './modules/activities/activity.routes.js';
import deliverableRoutes from './modules/deliverables/deliverable.routes.js';
import approvalRoutes from './modules/approvals/approval.routes.js';
import settingsRoutes from './modules/settings/settings.routes.js';
import auditRoutes from './modules/audit/audit.routes.js';
import demoRoutes from './modules/demo/demo.routes.js';
import hermesRoutes from './integrations/hermes/hermes.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '../public');

export function createApp(customDb = null) {
  const app = express();

  // Server berjalan di belakang reverse proxy (gateway preview / Caddy / nginx di
  // deployment produksi). Tanpa ini, express-rate-limit menolak request eksternal
  // yang membawa X-Forwarded-For (ERR_ERL_UNEXPECTED_X_FORWARDED_FOR -> HTTP 500).
  // '1' = percayai satu hop proxy pertama.
  app.set('trust proxy', 1);
  const db = customDb || getDatabase();
  const sessionStore = new SQLiteSessionStore(db);

  // Live preview compatibility: Disable frameguard so preview iframe can render smoothly
  app.use(
    helmet({
      frameguard: false,
      contentSecurityPolicy: false // Allows self-contained SVGs, live WebSockets & iframe rendering
    })
  );

  // Raw body capture for HMAC webhook signature verification
  app.use(
    express.json({
      limit: '5mb',
      verify: (req, res, buf) => {
        req.rawBody = buf;
      }
    })
  );

  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(cookieParser(securityConfig.sessionSecret));

  // SQLite session middleware
  app.use(
    session({
      name: securityConfig.sessionCookieName,
      secret: securityConfig.sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: sessionStore,
      cookie: {
        httpOnly: true,
        secure: false, // Set false for local HTTP dev and proxy compatibility
        sameSite: 'lax',
        maxAge: securityConfig.sessionMaxAgeMs
      }
    })
  );

  // CSRF token generation
  app.use(setupCsrf);

  // Serve static assets
  app.use(express.static(publicDir));

  // General rate limiting on API
  app.use('/api', generalLimiter);

  // CSRF verification on mutating API requests (exempts login & webhook)
  app.use('/api', verifyCsrf);

  // Mount API modules
  app.use('/api/auth', authRoutes);
  app.use('/api/director', directorRoutes);
  app.use('/api/virtual-office', virtualOfficeRoutes);
  app.use('/api/agents', agentRoutes);
  app.use('/api/tasks', taskRoutes);
  app.use('/api/projects', projectRoutes);
  app.use('/api/activities', activityRoutes);
  app.use('/api/deliverables', deliverableRoutes);
  app.use('/api/approvals', approvalRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/audit', auditRoutes);
  app.use('/api/demo', demoRoutes);
  app.use('/api/integrations/hermes', hermesRoutes);

  // Single Page App routing fallback for UI routes
  const appRoutes = [
    '/login',
    '/office',
    '/dashboard',
    '/agents',
    '/tasks',
    '/projects',
    '/activities',
    '/approvals',
    '/settings'
  ];

  appRoutes.forEach((route) => {
    app.get(route, (req, res) => {
      res.sendFile(path.join(publicDir, 'index.html'));
    });
  });

  // Root redirect
  app.get('/', (req, res) => {
    res.redirect('/office');
  });

  // Catch unhandled API 404s
  app.use('/api', notFoundHandler);

  // Global Error Handler
  app.use(errorHandler);

  return { app, sessionStore, db };
}

export default createApp;
