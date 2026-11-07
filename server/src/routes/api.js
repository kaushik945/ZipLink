import { Router } from 'express';
import { csrf, requireAuth, rateLimiter } from '../middleware/security.js';

export function apiRoutes(deps, auth, controller) {
  const api = Router();
  const management = rateLimiter(deps, 'management', 300, 60);
  const create = rateLimiter(deps, 'create', 30, 60);
  api.use(csrf(deps.config));
  api.get('/auth/me', management, auth.profile);
  api.post('/auth/register', rateLimiter(deps, 'register', 5, 3600), auth.register);
  api.post('/auth/login', rateLimiter(deps, 'login', 10, 900), auth.login);
  api.post('/auth/logout', management, auth.logout);
  api.use(requireAuth, management);
  api.get('/analytics/overview', controller.overview);
  api.post(['/links', '/shorten'], create, controller.create);
  api.get(['/links', '/urls'], controller.list);
  api.get('/links/:id/analytics/timeseries', controller.analytics);
  api.get('/links/:id/analytics', controller.analytics);
  api.get('/links/:id', controller.details);
  api.patch('/links/:id', controller.update);
  api.delete(['/links/:id', '/urls/:id'], controller.remove);
  return api;
}
