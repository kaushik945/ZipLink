// Preserve the original start command while the modular backend uses ES modules.
import('./src/index.js').catch((error) => {
  console.error(
    JSON.stringify({
      level: 'fatal',
      message: 'API startup failed',
      code: error.code,
      error: error.message,
    }),
  );
  process.exit(1);
});
