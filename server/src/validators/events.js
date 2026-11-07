import { UAParser } from 'ua-parser-js';
import { assert } from '../utils/errors.js';

export function safeMetadata(req) {
  const agent = String(req.get('user-agent') || '').slice(0, 512);
  const parsed = new UAParser(agent).getResult();
  const browserName = parsed.browser.name || '';
  const browser = /edge/i.test(browserName)
    ? 'Edge'
    : /firefox/i.test(browserName)
      ? 'Firefox'
      : /chrome|chromium/i.test(browserName)
        ? 'Chrome'
        : /safari/i.test(browserName)
          ? 'Safari'
          : 'Other';
  const device = ['mobile', 'tablet'].includes(parsed.device.type) ? parsed.device.type : 'desktop';
  let referrer = 'direct';
  try {
    referrer = new URL(req.get('referer')).hostname.slice(0, 253);
  } catch {
    /* No valid referrer. */
  }
  return { browser, device, referrer, isBot: /bot|crawler|spider|slurp|headless/i.test(agent) };
}
export function validateEvent(event) {
  assert(
    event &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        event.eventId,
      ) &&
      Number.isSafeInteger(event.linkId) &&
      event.linkId > 0 &&
      typeof event.timestamp === 'string' &&
      Number.isFinite(Date.parse(event.timestamp)),
    400,
    'INVALID_EVENT',
    'Invalid click event identity.',
  );
  assert(
    ['desktop', 'mobile', 'tablet'].includes(event.device) &&
      ['Chrome', 'Firefox', 'Safari', 'Edge', 'Other'].includes(event.browser) &&
      typeof event.referrer === 'string' &&
      event.referrer.length <= 253 &&
      typeof event.isBot === 'boolean',
    400,
    'INVALID_EVENT',
    'Invalid click metadata.',
  );
  return event;
}
