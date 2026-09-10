import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * Remote functions (T004) need BOTH opt-ins — neither works alone:
 *   kit.experimental.remoteFunctions      enables *.remote.ts
 *   compilerOptions.experimental.async    enables await in components
 * The API is experimental (research.md risk 1), so the SvelteKit version
 * is pinned exactly and remote functions stay thin.
 *
 * @type {import('@sveltejs/kit').Config}
 */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    alias: { $components: 'src/components' },
    experimental: {
      remoteFunctions: true,
    },
  },
  compilerOptions: {
    experimental: {
      async: true,
    },
  },
};

export default config;
