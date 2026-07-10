import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { execSync } from 'node:child_process';

// stamp the exact commit into the bundle so the footer can prove which
// source the judges are looking at
let buildSha = 'dev';
try {
  buildSha = execSync('git rev-parse --short HEAD').toString().trim();
} catch {
  /* not a git checkout */
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __BUILD_SHA__: JSON.stringify(buildSha),
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:4033',
    },
  },
  build: {
    chunkSizeWarningLimit: 1200,
  },
});
