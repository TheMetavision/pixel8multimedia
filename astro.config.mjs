// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import netlify from '@astrojs/netlify';
import sitemap from '@astrojs/sitemap';

import react from '@astrojs/react';

export default defineConfig({
  site: 'https://pixel8multimedia.co.uk',
  integrations: [tailwind(), sitemap(), react()],
  output: 'static',
  adapter: netlify(),
});