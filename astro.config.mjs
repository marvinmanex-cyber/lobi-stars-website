import { defineConfig } from 'astro/config';
import postbuild from './integrations/postbuild.mjs';

export default defineConfig({
  output: 'static',
  site: 'https://lobistarsfc.com',
  integrations: [postbuild()],
});
