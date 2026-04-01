// ============================================================
// vite.config.js — Vite Build Tool Configuration
// ============================================================
// WHAT: Configures Vite — the frontend build tool and dev server.
//
// WHY THIS FILE EXISTS:
//   Two jobs in development:
//   1. Enable React JSX support (the @vitejs/plugin-react plugin)
//   2. Proxy API requests to the backend during development
//
// ── THE PROXY EXPLAINED ──────────────────────────────────────
//   Problem: React dev server runs on localhost:5173.
//            Backend runs on localhost:3001.
//            When the frontend calls fetch('/api/plan'), the browser
//            sends that to localhost:5173/api/plan — wrong port!
//
//   Solution: The Vite proxy intercepts requests to /api/* and
//            forwards them to http://localhost:3001.
//
//   So: fetch('/api/plan') in the browser
//     → Vite dev server sees /api/plan
//     → Vite forwards it to http://localhost:3001/api/plan
//     → Express handles it, streams back
//     → Vite forwards the stream back to the browser
//
//   This also solves CORS in development — the browser only ever
//   talks to localhost:5173 (Vite), not localhost:3001 directly.
//   No CORS headers needed for dev. In production, the actual
//   Vercel domain talks to the actual Render domain, and the
//   CORS headers in index.js handle that.
// ============================================================

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    // [TOOL] React plugin: enables JSX transformation and React Fast Refresh
    // WHY: Without this, Vite doesn't know how to compile .jsx files.
    // Fast Refresh = hot module reload for React components (changes
    // show in the browser instantly without losing state).
    react(),
  ],

  server: {
    port: parseInt(process.env.PORT || '5173'),
    // host: true binds to all network interfaces (not just 127.0.0.1).
    // WHY: Required so the Claude preview tool's browser can reach the server.
    host: true,
    proxy: {
      // [TOOL] Proxy: any request starting with /api goes to the backend.
      // This is development-only — in production, you configure the
      // actual domain-to-domain connection via CORS headers.
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
