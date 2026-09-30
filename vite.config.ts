import { sites } from '@openai/sites-vite-plugin';
import vinext from 'vinext';
import { defineConfig } from 'vite';
import hostingConfig from './.openai/hosting.json';

const SITE_CREATOR_DATABASE_ID = 'cd1b13e7-b85b-4023-88a6-8522153c5a82';

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

const d1Databases = d1
  ? [
      {
        binding: d1,
        database_name: 'site-creator-d1',
        database_id: SITE_CREATOR_DATABASE_ID,
      },
    ]
  : [];
const r2Buckets = r2
  ? [
      {
        binding: r2,
        bucket_name: 'site-creator-r2',
      },
    ]
  : [];

const localBindingConfig = {
  main: 'vinext/server/app-router-entry',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: d1Databases,
  r2_buckets: r2Buckets,
  // Worker Previews (branch preview URLs) inherit nothing from production, so they get the same
  // database and bucket here: the preview shows the real portfolio, and art uploaded there is the
  // art production uses. Secrets for Previews are set separately (wrangler preview secret).
  previews: {
    d1_databases: d1Databases,
    r2_buckets: r2Buckets,
  },
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: localBindingConfig,
      }),
    ],
  };
});
