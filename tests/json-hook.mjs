// Lets tests import site code that reads JSON files. The site's own build bundles them without an
// import attribute (Cloudflare's build fails with one), but Node requires it. Used with
// node --import ./tests/json-hook.mjs; `npm test` does this.
import { registerHooks } from 'node:module';

registerHooks({
  load(url, context, next) {
    if (url.endsWith('.json')) return next(url, { ...context, importAttributes: { ...context.importAttributes, type: 'json' } });
    return next(url, context);
  },
});
