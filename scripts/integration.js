import { spawnSync } from 'node:child_process';
const kind = process.argv[2] || 'all';
if (!['all', 'mysql', 'redis'].includes(kind))
  throw new Error('Usage: npm run test:integration -- [all|mysql|redis]');
const files =
  kind === 'all'
    ? [
        'server/tests/mysql.integration.test.js',
        'server/tests/redis.integration.test.js',
        'server/tests/pipeline.integration.test.js',
      ]
    : [`server/tests/${kind}.integration.test.js`];
const result = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  env: {
    ...process.env,
    RUN_MYSQL_TESTS: kind !== 'redis' ? '1' : '0',
    RUN_REDIS_TESTS: kind !== 'mysql' ? '1' : '0',
  },
});
process.exitCode = result.status ?? 1;
