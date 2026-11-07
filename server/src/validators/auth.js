import { assert } from '../utils/errors.js';
export function credentials(body) {
  assert(
    body && typeof body.email === 'string' && typeof body.password === 'string',
    400,
    'INVALID_CREDENTIALS',
    'Email and password are required.',
  );
  const email = body.email.trim().toLowerCase();
  assert(
    email.length <= 254 && /^[\x21-\x7e]+$/.test(email) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
    400,
    'INVALID_EMAIL',
    'Enter a valid ASCII email.',
  );
  assert(
    body.password.length >= 12 && Buffer.byteLength(body.password, 'utf8') <= 72,
    400,
    'INVALID_PASSWORD',
    'Password must contain at least 12 characters and at most 72 UTF-8 bytes.',
  );
  return { email, password: body.password };
}
