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

// [TOOL] Load environment variables FIRST — before any other import.
// WHY a separate file: ES modules hoist all imports and execute them
// before the module body. If we called dotenv.config() in this file's
// body, it would run AFTER all agents are already imported and have
// called new Anthropic() with a missing key. loadEnv.js is a module
// whose body IS the dotenv.config() call — so it runs at import time.
// See loadEnv.js for the full explanation.
import './loadEnv.js';

import express from 'express';
import cors from 'cors';

// [WORKFLOW] Import routes — each file handles a different endpoint.
// plan.js  → POST /api/plan  — runs the full 8-agent workflow
// chat.js  → POST /api/chat  — re-runs ONE agent based on user's message
import planRouter from './routes/plan.js';
import chatRouter from './routes/chat.js';

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
// POST /api/plan → 8-agent workflow (full plan generation)
app.use('/api', planRouter);

// [WORKFLOW] POST /api/chat → partial re-run workflow (chat refinement)
// WHY separate router: Keeps plan.js and chat.js self-contained.
// Each route file owns its own logic. index.js just wires them together.
app.use('/api', chatRouter);

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
