// ============================================================
// src/App.jsx — Root Component (State + Streaming Logic)
// ============================================================
// WHAT: The root React component. Controls which phase the app
//       is in, owns all state, and handles both SSE streams
//       (plan generation and chat refinement).
//
// WHY ALL STATE LIVES HERE:
//   React data flows DOWN (parent → child via props).
//   State that multiple children need must live in their common parent.
//   Both TripOutput and the chat feature need agentResults and tripDetails,
//   so App.jsx is the right home for all of it.
//
// APP PHASES:
//   'form'     → show TripForm (user fills in trip details)
//   'planning' → show TripOutput streaming (agents running)
//   'done'     → show TripOutput with chat enabled
//
// ── KEY PATTERN: fetch + ReadableStream for POST SSE ─────────
//   EventSource (browser built-in SSE) only supports GET requests.
//   Our /api/plan endpoint is POST (sends trip form data).
//   Solution: use fetch() and read response.body as a ReadableStream.
//
//   HOW IT WORKS:
//     const response = await fetch('/api/plan', { method: 'POST', ... })
//     const reader = response.body.getReader()
//     while (true) {
//       const { done, value } = await reader.read()  // reads chunks
//       if (done) break
//       // decode the bytes, parse SSE events, update state
//     }
//
//   WHY BUFFERING IS NEEDED:
//     Network chunks don't align with SSE event boundaries.
//     One chunk might contain half an event. The next chunk has the rest.
//     We accumulate chunks in a buffer string and split on '\n\n'
//     (the SSE event separator) to get complete events.
//
// HOW DATA FLOWS:
//   User submits form → handlePlanSubmit(tripDetails)
//     → fetch POST /api/plan
//     → ReadableStream reader loop
//     → each SSE event → updateAgentStatus() / updateAgentResult()
//     → React re-renders the relevant card
//   User sends chat message → handleChatMessage(message)
//     → fetch POST /api/chat { message, tripDetails, agentResults }
//     → same ReadableStream loop
//     → targeted card updates, full plan updates
// ============================================================

import { useState, useCallback } from 'react';
import TripForm from './components/TripForm.jsx';
import TripOutput from './components/TripOutput.jsx';

export default function App() {

  // ── App phase ───────────────────────────────────────────────
  // [WORKFLOW] Controls which screen the user sees.
  const [phase, setPhase] = useState('form'); // 'form' | 'planning' | 'done'

  // ── Trip data ────────────────────────────────────────────────
  // The form data submitted by the user. Kept here because:
  // 1. TripOutput displays it (destination name in the header)
  // 2. Chat sends it back to the server with every request
  const [tripDetails, setTripDetails] = useState(null);

  // ── Agent state ──────────────────────────────────────────────
  // agentStatuses: tracks each agent's current state
  //   { research: 'waiting' | 'running' | 'done', flights: 'waiting', ... }
  const [agentStatuses, setAgentStatuses] = useState({});

  // agentResults: stores each agent's output when it completes
  //   { research: { weather, bestAreas, ... }, flights: { options, ... }, ... }
  const [agentResults, setAgentResults] = useState({});

  // fullPlan: the complete markdown plan from the orchestrator
  const [fullPlan, setFullPlan] = useState('');

  // ── Chat state ───────────────────────────────────────────────
  // chatMessages: the visible chat history shown in the chat panel
  //   [{ role: 'user'|'assistant', content: string }]
  const [chatMessages, setChatMessages] = useState([]);

  // chatLoading: true while a chat request is in progress
  const [chatLoading, setChatLoading] = useState(false);

  // lastUpdatedAgent: highlights which card was just updated by chat
  const [lastUpdatedAgent, setLastUpdatedAgent] = useState(null);

  // ── SSE stream parser ─────────────────────────────────────────
  // [STREAMING] Shared helper that reads a fetch() response as an SSE stream.
  // Used by both handlePlanSubmit and handleChatMessage — same stream format.
  //
  // Parameters:
  //   response   — the fetch() Response object (with .body readable stream)
  //   onEvent    — callback called for each parsed SSE event object
  const readSSEStream = useCallback(async (response, onEvent) => {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    // [STREAMING] Buffer accumulates partial chunks.
    // WHY: TCP/network delivers data in arbitrary-size chunks.
    // An SSE event (ending in \n\n) might be split across two chunks.
    // We concatenate chunks until we have a complete event.
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // [STREAMING] Decode the binary chunk to a string and add to buffer.
      // { stream: true } tells TextDecoder this might not be the last chunk
      // (handles multi-byte characters like emoji split across chunks).
      buffer += decoder.decode(value, { stream: true });

      // [STREAMING] Split buffer on \n\n — the SSE event separator.
      // Example buffer after two chunks:
      //   'data: {"agent":"research"...}\n\ndata: {"agent":"flights"...'
      // After split('\n\n'):
      //   ['data: {"agent":"research"...}', 'data: {"agent":"flights"...']
      // The last element might be incomplete, so we put it back in the buffer.
      const parts = buffer.split('\n\n');
      buffer = parts.pop(); // last part may be incomplete — keep in buffer

      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed.startsWith('data: ')) continue;

        // [STREAMING] Parse the JSON payload after "data: "
        try {
          const event = JSON.parse(trimmed.slice(6)); // remove "data: " prefix
          onEvent(event);
        } catch {
          // Malformed event — skip it. Don't crash the whole stream.
          console.warn('Could not parse SSE event:', trimmed.substring(0, 100));
        }
      }
    }
  }, []);

  // ── Plan submission handler ───────────────────────────────────
  // [WORKFLOW] Called when user submits the TripForm.
  // Transitions phase to 'planning', starts the SSE stream.
  const handlePlanSubmit = useCallback(async (formData) => {
    // Save trip details — needed later for chat requests
    setTripDetails(formData);

    // Initialize all agent statuses to 'waiting'
    setAgentStatuses({
      research: 'waiting', flights: 'waiting', cars: 'waiting',
      hotels: 'waiting', itinerary: 'waiting', budget: 'waiting',
      packing: 'waiting', orchestrator: 'waiting',
    });
    setAgentResults({});
    setFullPlan('');
    setChatMessages([]);
    setLastUpdatedAgent(null);

    // [WORKFLOW] Switch to the results screen before the stream starts.
    // WHY: The user should see the output panel immediately (with all
    // agents in 'waiting' state), not stare at the form while waiting.
    setPhase('planning');

    try {
      // [STREAMING] POST to /api/plan — Vite proxy forwards to localhost:3001
      const response = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      // [STREAMING] Process the SSE stream
      await readSSEStream(response, (event) => {
        const { agent, status, data } = event;

        if (agent === 'error') {
          console.error('Plan error:', data.message);
          setPhase('done'); // show what we have so far
          return;
        }

        if (agent === 'complete') {
          // [WORKFLOW] All agents done — store the full plan, enable chat
          setFullPlan(data.plan);
          setPhase('done');
          return;
        }

        // [STREAMING] Update the agent's status in state.
        // WHY functional update (prev => ...): We're inside an async callback.
        // React batches state updates. Using the functional form ensures we're
        // always working with the latest state, not a stale closure capture.
        if (status === 'running') {
          setAgentStatuses(prev => ({ ...prev, [agent]: 'running' }));
        }

        if (status === 'done') {
          setAgentStatuses(prev => ({ ...prev, [agent]: 'done' }));

          // Store the agent's result data
          if (agent === 'itinerary') {
            // itinerary is a string wrapped in { text: "..." } by plan.js
            setAgentResults(prev => ({ ...prev, itinerary: data.text || data }));
          } else if (Object.keys(data).length > 0) {
            setAgentResults(prev => ({ ...prev, [agent]: data }));
          }
        }
      });

    } catch (error) {
      console.error('Plan stream error:', error);
      setPhase('done');
    }
  }, [readSSEStream]);

  // ── Chat message handler ──────────────────────────────────────
  // [WORKFLOW] Called when user sends a chat message.
  // Re-runs ONE agent and updates its card + full plan.
  const handleChatMessage = useCallback(async (message) => {
    if (chatLoading) return;

    // Add user's message to chat history immediately (optimistic UI)
    setChatMessages(prev => [...prev, { role: 'user', content: message }]);
    setChatLoading(true);
    setLastUpdatedAgent(null);

    try {
      // [STREAMING] POST to /api/chat with message + full context
      // WHY send agentResults: The server needs current plan data to
      // pass to routerAgent (for context) and to orchestrator (to rebuild plan)
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, tripDetails, agentResults }),
      });

      let routingInfo = null;

      // [STREAMING] Process the chat SSE stream
      await readSSEStream(response, (event) => {
        const { agent, status, data } = event;

        if (agent === 'error') {
          setChatMessages(prev => [...prev, {
            role: 'assistant',
            content: `Sorry, something went wrong: ${data.message}`
          }]);
          return;
        }

        if (agent === 'router' && status === 'done') {
          // Router told us which agent will be re-run
          routingInfo = data;
        }

        // Update targeted agent status while it re-runs
        if (status === 'running' && agent !== 'router' && agent !== 'orchestrator') {
          setAgentStatuses(prev => ({ ...prev, [agent]: 'running' }));
        }

        if (status === 'done' && agent !== 'router' && agent !== 'orchestrator' && agent !== 'complete') {
          // Update the targeted agent's card with new data
          setAgentStatuses(prev => ({ ...prev, [agent]: 'done' }));
          if (agent === 'itinerary') {
            setAgentResults(prev => ({ ...prev, itinerary: data.text || data }));
          } else {
            setAgentResults(prev => ({ ...prev, [agent]: data }));
          }
          setLastUpdatedAgent(agent);
        }

        if (agent === 'complete') {
          // Full plan updated — replace it
          setFullPlan(data.plan);

          // Add assistant's response to chat history
          const targetAgent = data.targetAgent || routingInfo?.targetAgent || 'the plan';
          setChatMessages(prev => [...prev, {
            role: 'assistant',
            content: `Done! I've updated the ${targetAgent} section based on your request. The full plan has been refreshed.`
          }]);
        }
      });

    } catch (error) {
      console.error('Chat error:', error);
      setChatMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, something went wrong. Please try again.'
      }]);
    } finally {
      setChatLoading(false);
    }
  }, [chatLoading, tripDetails, agentResults, readSSEStream]);

  // ── Reset handler ─────────────────────────────────────────────
  const handleReset = useCallback(() => {
    setPhase('form');
    setTripDetails(null);
    setAgentStatuses({});
    setAgentResults({});
    setFullPlan('');
    setChatMessages([]);
  }, []);

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="app">
      <header className="app-header">
        <h1>✈️ Voyagr</h1>
        <p>AI-powered travel planning with 8 specialist agents</p>
      </header>

      <main className="app-main">
        {phase === 'form' && (
          // [WORKFLOW] Phase 1: show the form
          <TripForm onSubmit={handlePlanSubmit} />
        )}

        {(phase === 'planning' || phase === 'done') && (
          // [WORKFLOW] Phase 2 + 3: show streaming results + chat
          <TripOutput
            tripDetails={tripDetails}
            agentStatuses={agentStatuses}
            agentResults={agentResults}
            fullPlan={fullPlan}
            chatMessages={chatMessages}
            chatLoading={chatLoading}
            lastUpdatedAgent={lastUpdatedAgent}
            planComplete={phase === 'done'}
            onChatMessage={handleChatMessage}
            onReset={handleReset}
          />
        )}
      </main>
    </div>
  );
}
