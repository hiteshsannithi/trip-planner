// ============================================================
// routes/plan.js — THE WORKFLOW (Session 2: Full Implementation)
// ============================================================
// WHAT: This is the orchestration layer — the code that controls WHEN
//       each agent runs and in what sequence. It receives the trip form
//       data, runs 8 agents in a specific order, and streams each result
//       to the frontend as it arrives.
//
// WHY THIS FILE EXISTS (SEPARATE FROM THE AGENTS):
//   The agents are specialists — each knows how to do ONE thing well.
//   This file is the CONDUCTOR. It knows:
//     - Which agents to run
//     - What ORDER to run them in
//     - What DATA to pass between them
//     - How to STREAM results to the client
//
//   This separation is the "workflow" pattern:
//   YOUR CODE controls the sequence. The LLM does not decide what runs next.
//   This is a critical distinction from fully autonomous agents.
//
// ── THE WORKFLOW SEQUENCE ─────────────────────────────────────
//
//  Step 1:  Receive + validate trip form data
//  Step 2:  Set SSE headers (streaming connection opened)
//  Step 3:  researchAgent — ALONE, first
//             WHY ALONE: Every other agent needs destination context.
//             Nothing can start until research is done.
//  Step 4:  5 agents IN PARALLEL via Promise.all:
//             flightsAgent, carRentalAgent, hotelsAgent,
//             itineraryAgent, budgetAgent
//             WHY PARALLEL: These 5 only need research output (done in Step 3).
//             They don't need each other. Running in parallel cuts wait
//             time from ~50 seconds to ~10 seconds.
//             STREAMING: Each one streams its result the INSTANT it finishes
//             via .then() — not after all 5 are done.
//  Step 5:  packingAgent — ALONE, after parallel group
//             WHY ALONE: Depends on itineraryAgent output (from Step 4).
//             Cannot start until itinerary is done.
//  Step 6:  orchestrator — synthesizes everything into final plan
//  Step 7:  Send 'complete' event → frontend closes the SSE connection
//
// ── SSE vs WEBSOCKETS ────────────────────────────────────────
//   SSE (Server-Sent Events):
//     - One-directional: server → client only
//     - Standard HTTP/1.1 — no extra protocol, no library
//     - Perfect for "server streams data, client just displays it"
//     - Browser has built-in EventSource API to receive SSE
//
//   WebSockets:
//     - Bidirectional: both sides can send at any time
//     - Requires a protocol upgrade and usually a library (socket.io)
//     - Better for real-time chat, multiplayer games, collaborative editing
//
//   CHOICE: SSE wins for this use case. The frontend never needs to
//   send messages after the initial POST. It only listens.
//   Simpler protocol = less complexity = fewer bugs.
//
// HOW DATA FLOWS THROUGH THIS FILE:
//   POST /api/plan (tripDetails from frontend)
//     → researchAgent(tripDetails) → research
//     → 5 agents in parallel, each .then() streams immediately:
//         flightsAgent  → flights  → stream "flights done"
//         carRentalAgent → cars    → stream "cars done"
//         hotelsAgent   → hotels  → stream "hotels done"
//         itineraryAgent → itinerary → stream "itinerary done"
//         budgetAgent   → budget  → stream "budget done"
//     → packingAgent(tripDetails, research, itinerary) → packing → stream "packing done"
//     → orchestrator({ all outputs }) → fullPlan → stream "complete"
// ============================================================

import { Router } from 'express';
import { researchAgent } from '../agents/researchAgent.js';
import { flightsAgent } from '../agents/flightsAgent.js';
import { carRentalAgent } from '../agents/carRentalAgent.js';
import { hotelsAgent } from '../agents/hotelsAgent.js';
import { itineraryAgent } from '../agents/itineraryAgent.js';
import { budgetAgent } from '../agents/budgetAgent.js';
import { packingAgent } from '../agents/packingAgent.js';
import { orchestrator } from '../agents/orchestrator.js';

const router = Router();

// ============================================================
// [STREAMING] SSE Helper — sends one event to the client
// ============================================================
// WHAT: Formats and writes a single Server-Sent Event to the response stream.
//
// WHY A HELPER FUNCTION:
//   We call sendEvent ~10 times in this file (once per agent status update).
//   A helper ensures the SSE format is consistent — the frontend's EventSource
//   will reject malformed events if format is wrong.
//
// SSE FORMAT (this is the exact wire format the browser expects):
//   data: {"agent":"research","status":"done","data":{...}}\n\n
//
//   Rules:
//   - Line must start with "data: "
//   - Must end with TWO newlines (\n\n) — this is how EventSource
//     knows where one event ends and the next begins
//   - Content after "data: " is any string (we use JSON)
//
// Parameters:
//   res    — the Express response object (the open HTTP connection)
//   agent  — which agent is reporting (e.g. "research", "flights")
//   status — "running" | "done" | "error"
//   data   — the agent's output object (or empty {} for "running" events)
// ============================================================
function sendEvent(res, agent, status, data = {}) {
  // [STREAMING] res.write() sends data WITHOUT closing the connection.
  // This is the core of SSE — the connection stays open, and we write
  // multiple times. Compare to res.json() which closes the connection.
  const event = JSON.stringify({ agent, status, data });
  res.write(`data: ${event}\n\n`);
}

// ============================================================
// [WORKFLOW] POST /api/plan — The main endpoint
// ============================================================
// The frontend calls: POST http://localhost:3001/api/plan
// With body: { destination, departureCity, startDate, endDate, travelers, budget, interests }
// Response: SSE stream of events, one per agent
// ============================================================
router.post('/plan', async (req, res) => {

  // ── Step 1: Set SSE Headers ────────────────────────────────
  // [STREAMING] These three headers transform this HTTP response into
  // a long-lived streaming connection.
  //
  // Content-Type: text/event-stream
  //   Tells the browser "this is an SSE stream, not regular JSON".
  //   The browser's built-in EventSource API expects this header.
  //
  // Cache-Control: no-cache
  //   Prevents proxies (Nginx, CDNs) from buffering the response.
  //   Without this, a proxy might wait to accumulate data before
  //   forwarding it — breaking the "live" feel of streaming.
  //
  // Connection: keep-alive
  //   Keeps the TCP connection open for the duration of the stream.
  //   Without this, the connection would close after the first write.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // [STREAMING] flushHeaders() sends the headers to the client IMMEDIATELY
  // without waiting for the first res.write() call.
  // WHY: The browser's EventSource won't start listening until it receives
  // the headers. Flushing them early opens the connection right away.
  res.flushHeaders();

  // ── Step 2: Extract and validate trip details ──────────────
  // [WORKFLOW] Pull trip data from the POST request body.
  // index.js has express.json() middleware, so req.body is already parsed.
  const tripDetails = req.body;

  // [WORKFLOW] Basic validation — fail fast before running any agents.
  // WHY HERE: Better to catch missing fields immediately than to fail
  // halfway through a 30-second agent run.
  const required = ['destination', 'departureCity', 'startDate', 'endDate', 'travelers', 'budget'];
  const missing = required.filter(field => !tripDetails[field]);

  if (missing.length > 0) {
    sendEvent(res, 'error', 'error', {
      message: `Missing required fields: ${missing.join(', ')}`
    });
    res.end();
    return;
  }

  console.log('\n' + '═'.repeat(60));
  console.log(`[workflow] Starting trip plan: ${tripDetails.destination}`);
  console.log(`[workflow] Travelers: ${tripDetails.travelers}, Budget: $${tripDetails.budget}`);
  console.log('═'.repeat(60));

  // ── Wrap everything in try/catch ───────────────────────────
  // [WORKFLOW] If any agent throws an unhandled error, we catch it here,
  // send an error event to the frontend, and close the SSE connection cleanly.
  // Without this, the SSE connection would hang open forever on a crash.
  try {

    // ── Step 3: researchAgent (ALONE, FIRST) ─────────────────
    // [WORKFLOW] Research must complete before ANYTHING else starts.
    // WHY: All 5 parallel agents in the next step depend on research
    // output (destination facts, weather, best areas, currency, etc.)
    // This is a hard sequential dependency — not a design choice.
    console.log('\n[workflow] Step 3: Running researchAgent...');

    // [STREAMING] Tell the frontend research is starting.
    // The UI shows a loading spinner for the research card.
    sendEvent(res, 'research', 'running', {});

    const research = await researchAgent(tripDetails);

    // [STREAMING] Research done — send results immediately.
    // Frontend displays the research card with weather, visa info, etc.
    sendEvent(res, 'research', 'done', research);
    console.log('[workflow] researchAgent complete ✓');

    // ── Step 4: 5 agents IN PARALLEL ─────────────────────────
    // [WORKFLOW] [STREAMING] This is the most important code block in the project.
    //
    // Promise.all([...]) starts ALL 5 promises at the same moment.
    // Each agent runs independently, in parallel.
    //
    // The .then() on EACH individual promise is the streaming trick:
    //   - When flightsAgent finishes (say, at t=8s), its .then() fires
    //     immediately and sends the flights event to the frontend.
    //   - When hotelsAgent finishes (say, at t=12s), its .then() fires.
    //   - The user sees results appearing one by one as each finishes.
    //   - We don't wait for ALL 5 to finish before showing anything.
    //
    // Promise.all itself waits for ALL 5, but only to get the return values
    // for the next step (packingAgent needs itinerary, orchestrator needs all).
    //
    // WITHOUT .then() (wrong approach):
    //   const [f, c, h, i, b] = await Promise.all([...]);
    //   sendEvent(res, 'flights', 'done', f);   // only sends AFTER all 5 done
    //   sendEvent(res, 'hotels', 'done', h);    // all arrive at once — not streaming
    //
    // WITH .then() (correct approach):
    //   Each .then() fires the INSTANT that specific agent finishes.
    //   Results trickle in one by one. That's the live streaming feel.

    console.log('\n[workflow] Step 4: Running 5 agents in parallel...');

    // [STREAMING] Notify frontend that all 5 are now running simultaneously.
    // The UI shows 5 loading spinners at once.
    sendEvent(res, 'flights', 'running', {});
    sendEvent(res, 'cars', 'running', {});
    sendEvent(res, 'hotels', 'running', {});
    sendEvent(res, 'itinerary', 'running', {});
    sendEvent(res, 'budget', 'running', {});

    // [WORKFLOW] Promise.all — fire all 5 simultaneously.
    // Each .then() streams results the instant THAT agent finishes.
    // The destructured variables [flights, cars, ...] are available only
    // AFTER all 5 complete — used in Steps 5 and 6 below.
    const [flights, cars, hotels, itinerary, budget] = await Promise.all([

      // [AGENT] flightsAgent — searches for flight options
      flightsAgent(tripDetails, research).then(result => {
        // [STREAMING] This fires the moment flightsAgent resolves —
        // regardless of what the other 4 agents are doing.
        sendEvent(res, 'flights', 'done', result);
        console.log('[workflow] flightsAgent complete ✓');
        return result; // must return result so Promise.all collects it
      }),

      // [AGENT] carRentalAgent — searches for car rental options
      carRentalAgent(tripDetails, research).then(result => {
        sendEvent(res, 'cars', 'done', result);
        console.log('[workflow] carRentalAgent complete ✓');
        return result;
      }),

      // [AGENT] hotelsAgent — searches for hotel options
      hotelsAgent(tripDetails, research).then(result => {
        sendEvent(res, 'hotels', 'done', result);
        console.log('[workflow] hotelsAgent complete ✓');
        return result;
      }),

      // [AGENT] itineraryAgent — builds day-by-day plan (no tools, pure reasoning)
      itineraryAgent(tripDetails, research).then(result => {
        sendEvent(res, 'itinerary', 'done', { text: result });
        console.log('[workflow] itineraryAgent complete ✓');
        return result;
      }),

      // [AGENT] budgetAgent — estimates cost breakdown (no tools, pure reasoning)
      budgetAgent(tripDetails, research).then(result => {
        sendEvent(res, 'budget', 'done', result);
        console.log('[workflow] budgetAgent complete ✓');
        return result;
      }),

    ]); // Promise.all resolves here — ALL 5 are done, we have all results

    console.log('[workflow] All 5 parallel agents complete ✓');

    // ── Step 5: packingAgent (ALONE, AFTER PARALLEL GROUP) ───
    // [WORKFLOW] packingAgent MUST wait for itineraryAgent (from Step 4).
    // WHY: It needs the itinerary text to pack for specific activities.
    // A hiking day → hiking boots. A formal dinner → dress clothes.
    //
    // Note how we use `itinerary` — the return value from itineraryAgent
    // captured in the Promise.all destructuring above.
    console.log('\n[workflow] Step 5: Running packingAgent...');
    sendEvent(res, 'packing', 'running', {});

    const packing = await packingAgent(tripDetails, research, itinerary);
    sendEvent(res, 'packing', 'done', packing);
    console.log('[workflow] packingAgent complete ✓');

    // ── Step 6: orchestrator (synthesizes everything) ─────────
    // [WORKFLOW] Runs last because it needs ALL other outputs.
    // Uses Sonnet (not Haiku) for better synthesis quality — see orchestrator.js.
    console.log('\n[workflow] Step 6: Running orchestrator...');
    sendEvent(res, 'orchestrator', 'running', {});

    const fullPlan = await orchestrator({
      tripDetails,
      research,
      flights,
      cars,
      hotels,
      itinerary,
      budget,
      packing,
    });

    console.log('[workflow] orchestrator complete ✓');

    // ── Step 7: Send final completion event ───────────────────
    // [STREAMING] The 'complete' event signals to the frontend:
    // "all agents are done, here is the full assembled plan."
    // The frontend closes its EventSource connection after receiving this.
    sendEvent(res, 'complete', 'done', { plan: fullPlan });

    console.log('\n' + '═'.repeat(60));
    console.log('[workflow] Trip plan complete! All agents finished.');
    console.log('═'.repeat(60) + '\n');

    // [STREAMING] Close the SSE connection cleanly.
    // res.end() tells the client "no more data will come on this connection."
    res.end();

  } catch (error) {
    // [WORKFLOW] If any agent throws, send an error event and close cleanly.
    // WHY: Without this, the SSE connection hangs open forever on a crash.
    // The frontend's EventSource would never receive a close signal.
    console.error('[workflow] Error in workflow:', error.message);
    sendEvent(res, 'error', 'error', {
      message: error.message || 'An unexpected error occurred'
    });
    res.end();
  }
});

export default router;
