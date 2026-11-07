import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import session from 'express-session';
import pinoHttp from 'pino-http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { authController } from './controllers/auth.js';
import { linkController } from './controllers/links.js';
import { apiRoutes } from './routes/api.js';
import { rateLimiter } from './middleware/security.js';
import { AppError } from './utils/errors.js';

export function createApp(deps) {
  const { config, logger, sessionStore } = deps;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(helmet());
  app.use(
    pinoHttp({
      logger,
      genReqId: () => randomUUID(),
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, path: req.url?.split('?')[0] }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use((req, res, next) => {
    res.set('X-Request-ID', req.id);
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(
    cors({
      origin(origin, callback) {
        callback(
          origin && !config.origins.includes(origin)
            ? new AppError(403, 'ORIGIN_FORBIDDEN', 'Origin is not allowed.')
            : null,
          !origin || config.origins.includes(origin),
        );
      },
      credentials: true,
      allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
      exposedHeaders: ['Retry-After', 'X-Request-ID'],
    }),
  );
  app.get('/health', (req, res) => res.json({ success: true, data: { status: 'live' } }));
  app.get('/ready', async (req, res) => {
    try {
      await deps.pool.query('SELECT 1');
      if (!deps.redis.isReady) throw new Error();
      res.json({ success: true, data: { status: 'ready' } });
    } catch {
      res.status(503).json({
        success: false,
        error: { code: 'NOT_READY', message: 'Database or Redis unavailable.' },
      });
    }
  });
  const controller = linkController(deps);
  const redirectRate = rateLimiter(deps, 'redirect', 6000, 60, true);
  // Public redirects bypass sessions, so a session-store outage need not break cached redirects.
  app.get('/api/short/:shortCode', redirectRate, controller.redirect);
  app.get('/', (req, res) =>
    res.json({ success: true, data: { name: 'ZipLink API', docs: '/api/openapi.json' } }),
  );
  app.get('/api/openapi.json', (req, res) =>
    res.sendFile(fileURLToPath(new URL('../openapi.json', import.meta.url))),
  );
  app.use('/api', express.json({ limit: '16kb', strict: true }));
  const sessions = session({
    name: config.production ? '__Host-ziplink.sid' : 'ziplink.sid',
    store: sessionStore,
    secret: config.secret,
    resave: false,
    saveUninitialized: false,
    rolling: false,
    cookie: {
      httpOnly: true,
      secure: config.production,
      sameSite: 'lax',
      maxAge: config.sessionSeconds * 1000,
      path: '/',
    },
  });
  app.use('/api', (req, res, next) =>
    sessions(req, res, (error) =>
      next(
        error
          ? new AppError(503, 'SESSION_UNAVAILABLE', 'Session store unavailable. Please try again.')
          : undefined,
      ),
    ),
  );
  app.use('/api', async (req, res, next) => {
    if (req.session?.userId && req.session.authExpiresAt <= Date.now()) {
      await new Promise((resolve, reject) =>
        req.session.regenerate((error) => (error ? reject(error) : resolve())),
      );
    }
    next();
  });
  app.use('/api', apiRoutes(deps, authController(deps), controller));
  app.get('/:shortCode', redirectRate, controller.redirect);
  app.use((req, res, next) => next(new AppError(404, 'NOT_FOUND', 'Endpoint not found.')));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status && error.status >= 400 && error.status <= 599 ? error.status : 500;
    const code =
      error.type === 'entity.parse.failed' ? 'INVALID_JSON' : error.code || 'INTERNAL_ERROR';
    if (status >= 500)
      logger.error({ requestId: req.id, code: error.code, type: error.name }, 'Request failed');
    res.status(status).json({
      success: false,
      error: {
        code: status === 500 ? 'INTERNAL_ERROR' : code,
        message: status === 500 ? 'An unexpected error occurred.' : error.message,
        requestId: req.id,
      },
    });
  });
  return app;
}
