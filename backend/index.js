// ============================================================
// index.js — Express Server Entry Point
// ============================================================
// WHAT: Starts the HTTP server, wires up middleware, mounts routes.
// WHY:  Every backend project needs a single entry point that
//       configures the server before it starts accepting requests.
//       All "cross-cutting" concerns (CORS, JSON parsing, logging)
//       live here — not scattered across route files.
// PATTERN: This is pure infrastructure, not AI logic. Think of it
//          as the "receptionist" — it receives requests and directs
//          them to the right handler (routes/plan.js).
// ============================================================

// [TOOL] Load environment variables from .env into process.env
// WHY: We call this FIRST, before any other import that might read
//      process.env. If dotenv runs after those imports, the keys
//      would be undefined and all API calls would fail silently.
import 'dotenv/config';

import express from 'express';
import cors from 'cors';

// [WORKFLOW] Import the plan route — this is where all AI logic lives.
// We will create this file in Session 2. For Session 1, this import
// is here but the route isn't mounted yet (see the comment below).
import planRouter from './routes/plan.js';

// Create the Express application instance.
// Think of 'app' as the server object — everything gets attached to it.
const app = express();

// ── Middleware ────────────────────────────────────────────────
// Middleware runs on EVERY request, before it reaches any route handler.
// Order matters: add middleware in the order you want it to run.

// [TOOL] CORS — Cross-Origin Resource Sharing
// WHY: Browsers enforce a "same-origin policy" — by default, a page
//      served from localhost:5173 (React/Vite) CANNOT call an API at
//      localhost:3001. CORS headers tell the browser "this is allowed".
//      Without this, every fetch() from the frontend would be blocked.
//
// In production, replace the origin with your actual frontend URL:
// cors({ origin: 'https://your-app.vercel.app' })
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000'],
  methods: ['GET', 'POST'],
}));

// [TOOL] JSON body parser
// WHY: When the frontend sends a POST request with trip form data,
//      it sends JSON in the request body. Without this middleware,
//      req.body would be undefined. This parses the raw bytes into
//      a JavaScript object we can work with.
// limit: '10mb' prevents someone from sending a giant payload that
//        crashes the server (basic denial-of-service protection).
app.use(express.json({ limit: '10mb' }));

// ── Routes ───────────────────────────────────────────────────
// [WORKFLOW] Mount the plan router at /api/plan
// WHY: Separating routes into their own files keeps index.js clean.
//      All trip-planning logic lives in routes/plan.js. index.js
//      only knows "requests to /api go to planRouter".
//
// A POST to /api/plan → planRouter handles it → runs the 8-agent workflow
app.use('/api', planRouter);

// ── Health check ─────────────────────────────────────────────
// A simple GET / endpoint so you can verify the server is running
// without triggering any AI logic. Also used by Render.com to check
// if the deployment is healthy.
app.get('/', (req, res) => {
  res.json({ status: 'Trip Planner backend is running', version: '1.0.0' });
});

// ── Start server ──────────────────────────────────────────────
// process.env.PORT: Render.com sets this automatically in production.
// We fall back to 3001 for local development.
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  // This callback runs once, when the server is ready to accept connections.
  console.log(`\n🚀 Trip Planner backend running on http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/`);
  console.log(`   Plan endpoint: POST http://localhost:${PORT}/api/plan\n`);
});
