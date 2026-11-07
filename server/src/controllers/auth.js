import bcrypt from 'bcryptjs';
import { credentials } from '../validators/auth.js';
import { AppError, assert } from '../utils/errors.js';
import { csrfToken } from '../middleware/security.js';

const sessionCall = (req, method) =>
  new Promise((resolve, reject) =>
    req.session[method]((error) => (error ? reject(error) : resolve())),
  );
export function authController({ users, config }) {
  // Computed once at startup so nonexistent accounts still perform a real password comparison.
  const dummyHash = bcrypt.hashSync('dummy-password-never-used-to-login', config.bcryptRounds);
  async function establish(req, user) {
    await sessionCall(req, 'regenerate');
    req.session.userId = user.id;
    req.session.authExpiresAt = Date.now() + config.sessionSeconds * 1000;
    const token = csrfToken(req);
    await sessionCall(req, 'save');
    return { user: { id: user.id, email: user.email }, csrfToken: token };
  }
  return {
    async register(req, res) {
      const { email, password } = credentials(req.body);
      const hash = await bcrypt.hash(password, config.bcryptRounds);
      let user;
      try {
        user = await users.create(email, hash);
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY')
          throw new AppError(409, 'ACCOUNT_EXISTS', 'An account with this email already exists.');
        throw error;
      }
      res.status(201).json({ success: true, data: await establish(req, user) });
    },
    async login(req, res) {
      const { email, password } = credentials(req.body);
      const user = await users.findByEmail(email);
      const valid = await bcrypt.compare(password, user?.password_hash || dummyHash);
      assert(user && valid, 401, 'INVALID_LOGIN', 'Email or password is incorrect.');
      res.json({ success: true, data: await establish(req, user) });
    },
    async profile(req, res) {
      let user = req.session.userId ? await users.findById(req.session.userId) : null;
      if (!user) {
        delete req.session.userId;
        user = null;
      }
      res.json({ success: true, data: { user, csrfToken: csrfToken(req) } });
    },
    async logout(req, res) {
      await sessionCall(req, 'destroy');
      res.clearCookie(config.production ? '__Host-ziplink.sid' : 'ziplink.sid', {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: config.production,
      });
      res.json({ success: true, data: null });
    },
  };
}
