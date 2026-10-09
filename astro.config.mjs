import { defineConfig } from 'astro/config';
import postbuild from './integrations/postbuild.mjs';

export default defineConfig({
  output: 'static',
  site: 'https://lobistarsfc.com',
  integrations: [postbuild()],
  // Inline page CSS so it doesn't cost extra round trips on slow mobile data.
  build: { inlineStylesheets: 'always' },
});
