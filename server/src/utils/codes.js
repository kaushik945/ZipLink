import { randomInt } from 'node:crypto';
export const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export function generateCode(length = 8, random = randomInt) {
  if (!Number.isInteger(length) || length < 1 || length > 40)
    throw new RangeError('Invalid code length');
  // crypto.randomInt uses rejection sampling internally, avoiding modulo bias.
  return Array.from({ length }, () => BASE62[random(62)]).join('');
}
