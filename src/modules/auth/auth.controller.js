import crypto from 'crypto';
import { AuthService } from './auth.service.js';
import { securityConfig } from '../../config/index.js';
import { sendSuccess, sendError } from '../../utils/response.js';
import { z } from 'zod';

const loginSchema = z.object({
  email: z.string().optional(),
  username: z.string().optional(),
  identifier: z.string().optional(),
  password: z.string().min(1, 'Password is required')
}).refine((data) => Boolean(data.email || data.username || data.identifier), {
  message: 'Email or username is required'
});

export class AuthController {
  constructor() {
    this.authService = new AuthService();
  }

  login = async (req, res) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(res, 'VALIDATION_ERROR', 'Invalid email or password format', parsed.error.errors, 400);
      }

      const identifier = (parsed.data.email || parsed.data.username || parsed.data.identifier || '').trim();
      const password = parsed.data.password;

      const clientMeta = {
        ip: req.ip || req.connection.remoteAddress,
        userAgent: req.headers['user-agent']
      };

      const user = await this.authService.login(identifier, password, clientMeta);

      // Session regeneration on login to prevent session fixation
      req.session.regenerate((err) => {
        if (err) {
          return sendError(res, 'SESSION_ERROR', 'Failed to establish session', [], 500);
        }

        req.session.userId = user.id;
        req.session.userRole = user.role;
        req.session.csrfToken = crypto.randomBytes(24).toString('hex');

        // Persist the session BEFORE responding. express-session owns cookie
        // creation and signing: session.save() writes the SQLite store and
        // emits the signed `bvo_session` cookie (s:<sid>.<hmac>) with the
        // security flags configured in app.js (httpOnly, sameSite=lax,
        // secure in production). NEVER set a second manual cookie here — an
        // unsigned duplicate overrides the signed one and breaks session
        // recognition in both cookieParser and the WebSocket auth handshake.
        req.session.save((saveErr) => {
          if (saveErr) {
            return sendError(res, 'SESSION_ERROR', 'Failed to save session', [], 500);
          }
          return sendSuccess(res, { user, csrfToken: req.session.csrfToken }, 'Login successful');
        });
      });
    } catch (err) {
      return sendError(res, 'AUTH_FAILED', err.message, [], 401);
    }
  };

  logout = (req, res) => {
    if (req.session) {
      req.session.destroy((err) => {
        if (err) {
          return sendError(res, 'LOGOUT_ERROR', 'Failed to logout cleanly', [], 500);
        }
        res.clearCookie(securityConfig.sessionCookieName, { path: '/' });
        return sendSuccess(res, null, 'Logged out successfully');
      });
    } else {
      return sendSuccess(res, null, 'Already logged out');
    }
  };

  getMe = (req, res) => {
    if (!req.user) {
      return sendSuccess(res, {
        user: null,
        isAuthenticated: false,
        csrfToken: req.session ? req.session.csrfToken : null
      });
    }
    return sendSuccess(res, {
      user: req.user,
      isAuthenticated: true,
      csrfToken: req.session ? req.session.csrfToken : null
    });
  };

  getCsrf = (req, res) => {
    return sendSuccess(res, {
      csrfToken: req.session ? req.session.csrfToken : null
    });
  };
}

export const authController = new AuthController();
export default authController;
