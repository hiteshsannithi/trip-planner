# Voyagr — Claude Code Instructions

## Project Overview
AI-powered travel planner with 8 specialist agents.
User fills a form → 8 agents run in a structured workflow → results stream live to the UI → user can chat to refine any section.

**Live URLs:**
- Frontend: https://trip-planner-ecru-tau.vercel.app
- Backend API: https://trip-planner-wpbe.onrender.com

## Dev Commands
```bash
# Backend (port 3001)
cd backend && npm run dev

# Frontend (port 5173)
cd frontend && npm run dev
```

Both servers must run together. Vite proxies `/api/*` to `localhost:3001` in dev.

## Stack
- **Backend:** Node.js + Express, ES modules (`"type": "module"`)
- **Frontend:** React 18 + Vite, plain CSS (no Tailwind)
- **LLM:** Claude Haiku 4.5 for all 7 specialist agents, Claude Sonnet 4.6 for orchestrator only
- **Search:** Tavily API (web search tool used by research/flights/cars/hotels agents)
- **Streaming:** SSE (Server-Sent Events) via `fetch` + `ReadableStream` (not EventSource — POST requests)

## Architecture
```
routes/plan.js        — WORKFLOW: coordinates all 8 agents
  researchAgent       — runs first (others depend on it)
  Promise.all([       — 5 agents in parallel
    flightsAgent,
    carRentalAgent,
    hotelsAgent,
    itineraryAgent,
    budgetAgent,
  ])
  packingAgent        — runs after itinerary (needs it as input)
  orchestrator        — synthesizes all 7 outputs into full plan

routes/chat.js        — PARTIAL RE-RUN: router → 1 specialist → orchestrator
  routerAgent         — classifies user message → targetAgent
```

## Comment Conventions (non-negotiable)
Every non-trivial code block must have a label comment:
- `[WORKFLOW]` — orchestration logic (plan.js, chat.js)
- `[AGENT]` — LLM call / agent loop
- `[AGENT LOOP]` — the while(true) loop pattern
- `[TOOL]` — tool definition + function
- `[STREAMING]` — SSE write, fetch stream read

Also add `// WHY:` comments explaining decisions that aren't obvious from the code.

## Code Rules
- **No Tailwind** — plain CSS in `frontend/src/App.css`
- **Haiku for agents, Sonnet for orchestrator only** — never flip this
- **ES modules everywhere** — `import/export`, never `require/module.exports`
- **dotenv loads via `loadEnv.js`** — first import in `index.js` (ES module hoisting fix)
- **No mock data** — all agent outputs come from real Tavily + Claude calls

## Key Files
| File | Purpose |
|------|---------|
| `backend/index.js` | Express server, CORS, routes |
| `backend/loadEnv.js` | Must be first import — ES module dotenv fix |
| `backend/routes/plan.js` | Full 8-agent workflow + SSE streaming |
| `backend/routes/chat.js` | Partial re-run: router → specialist → orchestrator |
| `backend/agents/routerAgent.js` | Classifies chat message → which agent to re-run |
| `backend/agents/orchestrator.js` | Sonnet synthesis of all agent outputs |
| `backend/tools/tavilySearch.js` | Shared web search tool |
| `frontend/src/App.jsx` | Root component: phases, state, SSE parsing |
| `frontend/src/components/TripForm.jsx` | Trip input form |
| `frontend/src/components/TripOutput.jsx` | Agent cards, full plan, chat UI |
| `frontend/.env.production` | VITE_API_URL for Vercel build |

## Environment Variables
**Backend (Render):**
- `ANTHROPIC_API_KEY`
- `TAVILY_API_KEY`
- `ALLOWED_ORIGINS` — comma-separated Vercel URLs for CORS

**Frontend (Vercel / .env.production):**
- `VITE_API_URL` — Render backend URL (empty in dev, Vite proxy handles it)

## Teaching Context
This is a learning project. The user is learning AI development.
- Always explain concepts before showing code
- Use `[WORKFLOW]`/`[AGENT]`/`[TOOL]`/`[STREAMING]` label comments in all code
- Add `// WHY:` explanations for non-obvious decisions
- Prefer clarity over cleverness
