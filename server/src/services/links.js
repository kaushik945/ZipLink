import { generateCode } from '../utils/codes.js';
import { AppError, assert } from '../utils/errors.js';
import { RESERVED, sqlTime } from '../validators/links.js';

export function linkService({ repository, cache, config, codeGenerator = generateCode }) {
  async function owned(userId, id) {
    const row = await repository.owned(userId, id);
    assert(row, 404, 'NOT_FOUND', 'Link not found.');
    return row;
  }
  return {
    owned,
    list: (userId, options) => repository.list(userId, options),
    async create(userId, item) {
      for (let attempt = 0; attempt < config.collisionRetries; attempt++) {
        const code = item.short_code || codeGenerator(config.codeLength);
        if (RESERVED.has(code.toLowerCase())) continue;
        try {
          const row = await repository.insert(userId, { ...item, short_code: code });
          await cache.invalidate(code);
          return row;
        } catch (error) {
          if (error.code !== 'ER_DUP_ENTRY') throw error;
          if (item.short_code)
            throw new AppError(409, 'ALIAS_TAKEN', 'This alias is already in use.');
        }
      }
      throw new AppError(
        503,
        'CODE_EXHAUSTED',
        'Could not allocate a short code. Please try again.',
      );
    },
    async update(userId, id, item) {
      const row = await owned(userId, id);
      await repository.update(userId, id, item);
      await cache.invalidate(row.short_code);
      return owned(userId, id);
    },
    async remove(userId, id) {
      const row = await owned(userId, id);
      assert(await repository.remove(userId, id), 404, 'NOT_FOUND', 'Link not found.');
      await cache.invalidate(row.short_code);
    },
    async resolve(code) {
      const row = await cache.resolve(code, () => repository.byCode(code));
      assert(row, 404, 'NOT_FOUND', 'Short link not found.');
      assert(
        !row.deleted_at && row.enabled && (!row.expires_at || sqlTime(row.expires_at) > Date.now()),
        410,
        'LINK_UNAVAILABLE',
        'This link is expired, disabled or deleted.',
      );
      let destination;
      try {
        destination = new URL(row.original_url);
      } catch {
        /* Legacy invalid rows are unavailable, not fetched or rewritten. */
      }
      assert(
        destination &&
          ['http:', 'https:'].includes(destination.protocol) &&
          !destination.username &&
          !destination.password,
        410,
        'UNSAFE_DESTINATION',
        'This legacy destination is no longer permitted.',
      );
      return row;
    },
  };
}
