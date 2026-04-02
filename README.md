# ✈️ Voyagr — AI Multi-Agent Travel Planner

> A learning project: build a real AI application while deeply understanding
> every pattern — workflows, agents, tools, and streaming.

**Live app:** https://trip-planner-ecru-tau.vercel.app
**Backend API:** https://trip-planner-wpbe.onrender.com

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [How to Run](#2-how-to-run)
3. [Architecture: Workflow vs Multi-Agent](#3-architecture-workflow-vs-multi-agent)
4. [File-by-File Guide](#4-file-by-file-guide)
5. [Key Concepts Glossary](#5-key-concepts-glossary)
6. [Note on Flights & Car Rentals](#6-note-on-flights--car-rentals)
7. [Session Log](#7-session-log)

---

## 1. Project Overview

**What it does:**
The user fills a form with destination, dates, travelers, budget, departure city,
and interests. The backend runs 8 AI agents in a structured sequence, each a
specialist. Results stream back to the UI section by section as each agent
finishes — the user sees the plan building live.

**The 8 agents:**

| # | Agent | Role | Tool |
|---|-------|------|------|
| 1 | researchAgent | Destination facts, weather, visa info | Tavily search |
| 2 | flightsAgent | Flight options and prices | Tavily search |
| 3 | carRentalAgent | Car rental options | Tavily search |
| 4 | hotelsAgent | Hotel recommendations | Tavily search |
| 5 | itineraryAgent | Day-by-day plan | None (pure reasoning) |
| 6 | budgetAgent | Full cost breakdown in USD | None |
| 7 | packingAgent | Packing list | None |
| 8 | orchestrator | Synthesizes all outputs into final plan | None |

**Tech stack:**
- Backend: Node.js + Express + Anthropic SDK
- Frontend: React 18 + Vite + plain CSS
- LLM: Claude Haiku 4.5 (agents), Claude Sonnet 4.5 (orchestrator)
- Search: Tavily API

---

## 2. How to Run

### Prerequisites
- Node.js 18+
- Anthropic API key (from [console.anthropic.com](https://console.anthropic.com))
- Tavily API key (from [tavily.com](https://tavily.com) — free tier)

### Backend

```bash
cd backend
npm install
cp .env.example .env
# Edit .env and fill in your API keys
npm run dev
```

Server starts at `http://localhost:3001`

### Test a single agent (no frontend needed)

```bash
cd backend
node test-research.js
```

Expected output: research JSON printed to terminal with weather, visa info,
best areas, local tips, currency.

### Frontend (Session 3)

```bash
cd frontend
npm install
npm run dev
```

Opens at `http://localhost:5173`

### Environment Variables

| Variable | Where to get it | Required |
|----------|----------------|----------|
| `ANTHROPIC_API_KEY` | console.anthropic.com | Yes |
| `TAVILY_API_KEY` | tavily.com | Yes |
| `PORT` | Set to 3001 | No (defaults to 3001) |

---

## 3. Architecture: Workflow vs Multi-Agent

### The key distinction

There are two layers in this app that are easy to confuse:

**WORKFLOW LAYER** — your JavaScript code in `routes/plan.js`
  - Decides the ORDER agents run
  - Decides WHICH agents run in parallel
  - Passes data between agents
  - This is deterministic — it always runs the same way
  - The LLM does NOT control this

**MULTI-AGENT LAYER** — the individual agent files in `agents/`
  - Each agent is one or more calls to Claude
  - Claude decides what to search and when it has enough info
  - Each agent has its own system prompt (its "specialty")
  - This is where LLM intelligence lives

### Full system diagram

```
┌─────────────────────────────────────────────────────────────┐
│              WORKFLOW LAYER (routes/plan.js)                 │
│              YOUR CODE CONTROLS THIS SEQUENCE               │
│                                                             │
│  [Step 1] Receive & validate form data from frontend        │
│                          │                                  │
│                          ▼                                  │
│  [Step 2] researchAgent ──────────────────────────────────► │
│           Runs ALONE first. All other agents need its       │
│           output. Cannot parallelize this step.             │
│                          │                                  │
│                 research output                             │
│                          │                                  │
│                          ▼                                  │
│  [Step 3] Promise.all — 5 agents run IN PARALLEL ─────────► │
│                                                             │
│      ┌──────────┐  ┌──────────┐  ┌──────────┐             │
│      │ flights  │  │   car    │  │  hotels  │             │
│      │  Agent   │  │ Rental   │  │  Agent   │             │
│      │[AGENT]   │  │  Agent   │  │[AGENT]   │             │
│      │[TOOL]    │  │[AGENT]   │  │[TOOL]    │             │
│      └──────────┘  │[TOOL]    │  └──────────┘             │
│                    └──────────┘                            │
│      ┌──────────┐  ┌──────────┐                           │
│      │itinerary │  │  budget  │                           │
│      │  Agent   │  │  Agent   │                           │
│      │[AGENT]   │  │[AGENT]   │                           │
│      │(no tool) │  │(no tool) │                           │
│      └──────────┘  └──────────┘                           │
│                                                             │
│       Each streams its result to frontend AS IT FINISHES   │
│       Don't wait for all 5 — send each one immediately     │
│                          │                                  │
│              itinerary output                               │
│                          │                                  │
│                          ▼                                  │
│  [Step 4] packingAgent ────────────────────────────────────►│
│           Needs itinerary (activities) + research (weather) │
│           Runs ALONE after itinerary completes              │
│                          │                                  │
│                          ▼                                  │
│  [Step 5] orchestrator ────────────────────────────────────►│
│           Synthesizes ALL 7 outputs into final plan         │
│           Uses Sonnet (stronger reasoning for synthesis)    │
│                          │                                  │
│                          ▼                                  │
│  [Step 6] Send completion event → frontend closes stream   │
└─────────────────────────────────────────────────────────────┘

Inside each [AGENT] block — the Agent Loop:
┌──────────────────────────────────────────┐
│           AGENT LOOP (while loop)        │
│                                          │
│  messages = [{ role: 'user', ... }]      │
│                                          │
│  while (true) {                          │
│    response = Claude.messages.create()   │
│                                          │
│    if stop_reason == 'end_turn' → break  │
│                                          │
│    if stop_reason == 'tool_use':         │
│      result = tavilySearch(query)  ────► Tavily API
│      messages.push(tool_result)          │
│    // loop again ↑                       │
│  }                                       │
│                                          │
│  return JSON.parse(final response)       │
└──────────────────────────────────────────┘

Tools layer:
┌──────────────────────────────────────────┐
│         tools/tavilySearch.js            │
│                                          │
│  tavilySearch(query) ──► Tavily API ──► results
│                                          │
│  Used by: research, flights,             │
│           carRental, hotels agents       │
└──────────────────────────────────────────┘
```

### Why parallel execution matters

Sequential (without Promise.all):
```
researchAgent:  10s
flightsAgent:   10s
carRentalAgent:  8s
hotelsAgent:     8s
itineraryAgent: 12s
budgetAgent:     5s
packingAgent:    5s
orchestrator:   10s
─────────────────────
Total:          ~68s  ← user stares at blank screen
```

Parallel (with Promise.all for steps 2-6):
```
researchAgent:               10s
flights + car + hotels
+ itinerary + budget:        12s  (longest of the 5, in parallel)
packingAgent:                 5s
orchestrator:                10s
─────────────────────────────────
Total:                       ~37s  ← and user sees results appearing live!
```

The workflow pattern cuts total time roughly in half. The streaming pattern
means the user sees results appearing WHILE agents are still running.

---

## 4. File-by-File Guide

### `backend/package.json`
- **Purpose:** Declares the Node.js project and its dependencies
- **Pattern:** Project scaffolding
- **Key concept:** `"type": "module"` — enables ES Module `import/export` syntax
- **Data flow:** npm reads this → installs packages → your code can import them

### `backend/.env.example`
- **Purpose:** Template showing which environment variables are required
- **Pattern:** Security convention (secrets never in code)
- **Key concept:** Real values go in `.env` (gitignored). This template goes in git.
- **Data flow:** Developer copies to `.env`, fills values, dotenv loads into `process.env`

### `backend/index.js`
- **Purpose:** Express server entry point — starts the server, wires middleware and routes
- **Pattern:** Server setup / middleware pipeline
- **Key concepts:**
  - Middleware: functions that run on every request (CORS, JSON parsing)
  - Routing: `app.use('/api', planRouter)` directs requests to the right handler
- **Data flow:** Browser request → CORS check → JSON parse → route handler → response

### `backend/tools/tavilySearch.js`
- **Purpose:** Shared web search function used by 4 agents
- **Pattern:** `[TOOL]` — implements both the function AND the tool definition object
- **Key concepts:**
  - The function: does the actual HTTP call to Tavily
  - The definition object: the schema Claude reads to know the tool exists
  - Both must exist for Claude tool-calling to work
- **Data flow:** agent calls `tavilySearch(query)` → HTTP POST to Tavily → `[{title, content, url}]`

### `backend/agents/researchAgent.js`
- **Purpose:** Agent 1. Researches destination facts, weather, visa info, best areas
- **Pattern:** `[AGENT]` + `[AGENT LOOP]` — the core agentic pattern
- **Key concepts:**
  - System prompt: defines the agent's role and output format
  - Agent loop: while loop that continues until `stop_reason === 'end_turn'`
  - Tool call handling: detects `tool_use` blocks, executes functions, sends results back
  - JSON parsing: extracts structured data from Claude's final text response
- **Data flow:** `tripDetails` → [agent loop: 2-3 Tavily searches] → `{ weather, bestAreas, visaInfo, localTips, currency, highlights }`

### `backend/agents/flightsAgent.js` *(Session 2)*
- **Purpose:** Searches for flight options using Tavily
- **Pattern:** `[AGENT]` + `[TOOL]` — same agent loop as research, different system prompt
- **Key concept:** Swappability — replace Tavily with Amadeus API here and nothing else changes

### `backend/agents/carRentalAgent.js` *(Session 2)*
- **Purpose:** Searches for car rental options using Tavily
- **Pattern:** `[AGENT]` + `[TOOL]`

### `backend/agents/hotelsAgent.js` *(Session 2)*
- **Purpose:** Searches for hotel options using Tavily
- **Pattern:** `[AGENT]` + `[TOOL]`

### `backend/agents/itineraryAgent.js` *(Session 2)*
- **Purpose:** Builds a day-by-day itinerary — pure Claude reasoning, no tool calls
- **Pattern:** `[AGENT]` — single LLM call (no loop needed)
- **Key concept:** Not every agent needs tools. If the agent already has all the info
  it needs (from researchAgent output), it just needs to THINK, not SEARCH.

### `backend/agents/budgetAgent.js` *(Session 2)*
- **Purpose:** Calculates full cost breakdown in USD
- **Pattern:** `[AGENT]` — single LLM call, uses flights + hotels outputs for real prices

### `backend/agents/packingAgent.js` *(Session 2)*
- **Purpose:** Creates packing list from weather + itinerary
- **Pattern:** `[AGENT]` — single LLM call, runs last because it needs itinerary output

### `backend/agents/orchestrator.js` *(Session 2)*
- **Purpose:** Synthesizes all 7 agent outputs into one formatted travel plan
- **Pattern:** `[AGENT]` — single LLM call with Sonnet (stronger synthesis)
- **Key concept:** Model choice tradeoff — Haiku for simple tasks, Sonnet for complex synthesis

### `backend/routes/plan.js` *(Session 2)*
- **Purpose:** THE WORKFLOW — coordinates all 8 agents in the right sequence
- **Pattern:** `[WORKFLOW]` — your JavaScript decides the order, not the LLM
- **Key concepts:**
  - Sequential steps: some agents MUST wait for others
  - Parallel steps: `Promise.all` for independent agents
  - SSE streaming: sends each result to frontend as it arrives

### `frontend/src/components/TripForm.jsx` *(Session 3)*
- **Purpose:** The input form — destination, dates, budget, travelers, interests
- **Pattern:** React controlled form with validation

### `frontend/src/components/TripOutput.jsx` *(Session 3)*
- **Purpose:** Streaming results display — shows each agent's output as it arrives
- **Pattern:** `[STREAMING]` — uses EventSource API to receive SSE events
- **Key concept:** Each agent gets its own card. Card appears when that agent finishes.
  User sees the plan BUILD in real time.

---

## 5. Key Concepts Glossary

### What is a Workflow?
**Definition:** A sequence of steps that YOUR CODE controls. The LLM does not decide
what happens next — your JavaScript does.

**In this codebase:** `backend/routes/plan.js` (Session 2)
```javascript
// This sequence is deterministic — your code, not the LLM
const research = await researchAgent(tripDetails);          // Step 1
const [flights, cars, hotels, itinerary, budget] =
  await Promise.all([...]);                                  // Step 2 (parallel)
const packing = await packingAgent(tripDetails, itinerary); // Step 3
const plan = await orchestrator(allResults);                // Step 4
```

**Why it matters:** Workflows give you control. You can guarantee ordering,
handle errors, retry steps, and parallelize work. Pure LLM prompting can't do this.

---

### What is an Agent?
**Definition:** A program that uses an LLM to make decisions, can call tools to
interact with the world, and loops until it achieves its goal.

**In this codebase:** Every file in `backend/agents/`. For example:
`backend/agents/researchAgent.js` — line 82 starts the agent loop:
```javascript
while (true) {
  response = await client.messages.create({ tools: [tavilySearchTool] });
  if (response.stop_reason === 'end_turn') break;
  // handle tool calls...
}
```

**The three components of an agent:**
1. An LLM (Claude) that reasons about what to do
2. Tools it can call (tavilySearch)
3. A loop that continues until the goal is achieved

---

### What is a Tool?
**Definition:** A function that an agent can call to interact with the outside world.
Tools bridge the gap between the LLM (which only processes text) and reality
(APIs, databases, filesystems).

**In this codebase:** `backend/tools/tavilySearch.js`
```javascript
// The function — does the actual work
export async function tavilySearch(query) { ... }

// The definition — tells Claude the tool exists
export const tavilySearchTool = {
  name: 'tavilySearch',
  description: 'Search the web...',
  input_schema: { ... }
};
```

**How it works:** Claude doesn't call the function directly. Claude outputs
a `tool_use` block saying "call tavilySearch with query='...'". Your code
detects this, calls the function, sends the result back. Claude reads the
result and continues.

---

### What is the Agent Loop?
**Definition:** The while loop that drives an agent. It alternates between
calling the LLM and executing tools until the LLM says it's done.

**In this codebase:** `backend/agents/researchAgent.js` — the `while (true)` block
```javascript
while (true) {                                    // keep going until done
  response = await client.messages.create(...);   // ask Claude
  messages.push({ role: 'assistant', ... });      // remember what Claude said

  if (response.stop_reason === 'end_turn') break; // Claude is done → exit

  if (response.stop_reason === 'tool_use') {      // Claude wants to search
    const results = await tavilySearch(query);    // actually search
    messages.push({ role: 'user', content: results }); // tell Claude the results
    // loop continues — Claude reads results and decides what to do next
  }
}
```

**The conversation that happens inside the loop:**
```
You: research Paris for this trip
Claude: let me search for weather [tool_use: query="Paris weather June"]
You: [search results: sunny, 25°C average...]
Claude: let me search for visa info [tool_use: query="France visa Indian passport"]
You: [search results: Schengen visa required, apply 3 months in advance...]
Claude: I have enough info. Here's the JSON: { weather: "...", visaInfo: "..." }
You: [break out of loop, parse JSON]
```

---

### What is Streaming?
**Definition:** Sending data to the client incrementally as it's produced,
rather than waiting for everything to be ready and sending it all at once.

**In this codebase:** `backend/routes/plan.js` (Session 2) + `frontend/src/components/TripOutput.jsx` (Session 3)

**Backend (SSE — Server-Sent Events):**
```javascript
// Set headers that tell the browser to expect a stream
res.setHeader('Content-Type', 'text/event-stream');

// After researchAgent finishes, send immediately — don't wait for others
res.write(`data: ${JSON.stringify({ agent: 'research', data: research })}\n\n`);

// Later, after flightsAgent finishes
res.write(`data: ${JSON.stringify({ agent: 'flights', data: flights })}\n\n`);
```

**Frontend (EventSource):**
```javascript
const eventSource = new EventSource('/api/plan');
eventSource.onmessage = (event) => {
  const { agent, data } = JSON.parse(event.data);
  // Update just that agent's card in the UI — others stay loading
  setResults(prev => ({ ...prev, [agent]: data }));
};
```

**SSE vs WebSockets:** SSE is one-way (server → client). WebSockets are two-way.
For streaming AI results, one-way is all you need and SSE is much simpler.

---

### What is an Orchestrator?
**Definition:** An agent whose job is to COMBINE outputs from other agents
into a coherent final result. It doesn't search or plan — it edits and synthesizes.

**In this codebase:** `backend/agents/orchestrator.js` (Session 2)
```javascript
// Receives ALL 7 agent outputs
const prompt = `Here are the specialist reports:
Research: ${JSON.stringify(research)}
Flights: ${JSON.stringify(flights)}
...
Combine these into one cohesive, well-formatted travel plan.`;
```

**Why Sonnet instead of Haiku:**
The orchestrator needs to read 7 large inputs and produce coherent prose.
This is harder than a focused task like "search for weather". Sonnet is more
capable at synthesis. The cost difference is worth the quality improvement.

---

### What is Parallel Execution?
**Definition:** Running multiple operations simultaneously instead of one after another.
In JavaScript, `Promise.all([a, b, c])` starts all three at the same time and
waits for ALL of them to complete.

**In this codebase:** `backend/routes/plan.js` (Session 2)
```javascript
// [WORKFLOW] Step 3: Run 5 agents simultaneously using Promise.all
// WHY: These 5 agents only need research output — not each other's output.
// Running in parallel saves ~30 seconds of wait time.
const [flights, cars, hotels, itinerary, budget] = await Promise.all([
  flightsAgent(tripDetails, research),
  carRentalAgent(tripDetails, research),
  hotelsAgent(tripDetails, research),
  itineraryAgent(tripDetails, research),
  budgetAgent(tripDetails, research),
]);
```

**The rule for parallelization:** If agent B does NOT need agent A's output
as an input, they can run in parallel. Map out the dependencies first.

---

### What is a System Prompt?
**Definition:** Instructions sent to Claude before the conversation begins.
It defines the agent's role, behavior, and output format.

**Why each agent has its own system prompt:** Specialization. A packing list
expert and a budget analyst need different instructions. Separate system prompts
mean each agent stays focused on its job and doesn't "drift" into doing something else.

**In this codebase:** Every agent file has a `const SYSTEM_PROMPT = \`...\`` block at the top.

For `researchAgent.js`:
```javascript
const SYSTEM_PROMPT = `You are a travel research specialist...
Return ONLY a JSON object in this exact format: { weather: "...", ... }`;
```

The JSON instruction is critical: it makes the output machine-readable,
so the workflow can pass it as structured data to the next agent.

---

## 6. Note on Flights & Car Rentals

This app uses Tavily web search to find flight and car rental information
instead of dedicated APIs like Amadeus or Skyscanner.

**Why:** Amadeus requires payment. Skyscanner's API is by invitation only.
Both have complex OAuth flows that would be a distraction from learning the
agent patterns. Tavily searches travel sites (MakeMyTrip, Yatra, Goibibo,
Google Flights) and returns real pricing information.

**The important lesson — agent swappability:**

The `flightsAgent.js` and `carRentalAgent.js` files have this structure:
```
[system prompt] → [agent loop] → [call tavilySearch] → [return structured JSON]
```

If you wanted to swap Tavily for the real Amadeus API:
1. Change the function call inside the agent loop from `tavilySearch()` to `amadeusSearch()`
2. Update the tool definition object
3. Everything else stays identical — the agent loop, the JSON output format, the workflow

**This is the key architectural lesson:** Agent patterns are API-agnostic.
The structure (loop → tool → parse → return) stays the same regardless of
which external service the tool calls.

---

## 7. Session Log

Use this section to record what you learned after each session.

### Session 1 — Backend Foundation
*Date: [fill in]*
*What I built:* package.json, .env.example, .gitignore, index.js, tavilySearch.js, researchAgent.js, test-research.js

**What I learned:**
- [fill in]

**What surprised me:**
- [fill in]

**Questions I still have:**
- [fill in]

---

### Session 2 — All Agents + Workflow
*Date: [fill in]*
*What I built:* 6 more agents + orchestrator + plan.js workflow

**What I learned:**
- [fill in]

---

### Session 3 — Frontend + Full Integration
*Date: [fill in]*
*What I built:* React app with form + streaming output

**What I learned:**
- [fill in]

---

### Session 4 — Deploy
*Date: [fill in]*
*What I built:* Deployed to Render (backend) + Vercel (frontend)

**Live URLs:**
- Frontend: https://trip-planner-ecru-tau.vercel.app
- Backend: https://trip-planner-wpbe.onrender.com

**What I learned:**
- [fill in]
