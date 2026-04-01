// ============================================================
// components/TripOutput.jsx — Streaming Results + Chat UI
// ============================================================
// WHAT: Displays all 7 agent result cards with live status updates,
//       the full assembled plan, and the chat interface for
//       post-plan refinements.
//
// RECEIVES FROM App.jsx (via props):
//   tripDetails      — original form data (shown in header)
//   agentStatuses    — { research: 'waiting'|'running'|'done', ... }
//   agentResults     — { research: {...}, flights: {...}, ... }
//   fullPlan         — complete markdown string from orchestrator
//   chatMessages     — [{ role: 'user'|'assistant', content }]
//   chatLoading      — bool: true while chat request is in progress
//   lastUpdatedAgent — which agent card was just updated by chat
//   planComplete     — bool: enables the chat section
//   onChatMessage    — function: App.jsx handles the chat API call
//   onReset          — function: go back to the form
//
// PATTERN: Pure display component.
//   This component has NO async logic, NO API calls.
//   It receives state from App.jsx and renders it. App.jsx does
//   all the streaming work; this component just displays the result.
//   This separation makes each component easier to understand and test.
//
// AGENT CARD STATES:
//   waiting  → grey status dot + "Waiting..."
//   running  → animated blue dot + agent-specific message
//   done     → green dot + formatted content
//   (highlighted) → card has a brief highlight animation if just updated by chat
// ============================================================

import { useState, useRef, useEffect } from 'react';

// ── Agent display configuration ──────────────────────────────
// WHAT: Metadata for each agent — display name and running message.
// WHY CENTRALIZED: If you add or rename an agent, you change it here once.
const AGENT_CONFIG = {
  research:   { label: 'Destination Research',  runningMsg: 'Researching destination...' },
  flights:    { label: 'Flights',               runningMsg: 'Searching for flights...' },
  cars:       { label: 'Car Rentals',           runningMsg: 'Finding car options...' },
  hotels:     { label: 'Hotels',                runningMsg: 'Searching for hotels...' },
  itinerary:  { label: 'Day-by-Day Itinerary',  runningMsg: 'Building itinerary...' },
  budget:     { label: 'Budget Breakdown',      runningMsg: 'Calculating costs...' },
  packing:    { label: 'Packing List',          runningMsg: 'Creating packing list...' },
};

// ── Agent card status indicator ───────────────────────────────
function StatusDot({ status }) {
  return <span className={`status-dot status-${status}`} />;
}

// ── Render each agent's data in a structured way ──────────────
// WHAT: Converts raw JSON data from each agent into readable UI.
// WHY A SWITCH: Each agent returns a different data shape.
//   flights returns { options: [...], cheapestPrice, bookingTip }
//   research returns { weather, bestAreas, visaInfo, ... }
//   We need different rendering for each.
function AgentContent({ agentId, data }) {
  if (!data) return null;

  switch (agentId) {

    case 'research':
      return (
        <div className="agent-content">
          {data.weather && <p><strong>Weather:</strong> {data.weather}</p>}
          {data.visaInfo && <p><strong>Visa:</strong> {data.visaInfo}</p>}
          {data.currency && <p><strong>Currency:</strong> {data.currency}</p>}
          {data.bestAreas?.length > 0 && (
            <div>
              <strong>Best Areas:</strong>
              <ul>{data.bestAreas.map((a, i) => <li key={i}>{a}</li>)}</ul>
            </div>
          )}
          {data.localTips?.length > 0 && (
            <div>
              <strong>Local Tips:</strong>
              <ul>{data.localTips.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </div>
          )}
        </div>
      );

    case 'flights':
      return (
        <div className="agent-content">
          {data.cheapestPrice && (
            <p className="price-highlight">From ${data.cheapestPrice} per person</p>
          )}
          {data.options?.map((opt, i) => (
            <div key={i} className="option-card">
              <strong>{opt.airline}</strong>
              <span className="option-price">${opt.price}</span>
              <p>{opt.departure} → {opt.arrival}</p>
              <p className="option-detail">{opt.duration} · {opt.stops}</p>
            </div>
          ))}
          {data.bestOption && <p><strong>Best option:</strong> {data.bestOption}</p>}
          {data.bookingTip && <p className="tip"><strong>Tip:</strong> {data.bookingTip}</p>}
        </div>
      );

    case 'cars':
      return (
        <div className="agent-content">
          {data.recommendation && <p>{data.recommendation}</p>}
          {data.options?.map((opt, i) => (
            <div key={i} className="option-card">
              <strong>{opt.company}</strong> — {opt.carType}
              <span className="option-price">${opt.pricePerDay}/day</span>
              <p className="option-detail">{opt.features}</p>
            </div>
          ))}
          {data.bookingTip && <p className="tip"><strong>Booking:</strong> {data.bookingTip}</p>}
          {data.drivingTip && <p className="tip"><strong>Driving:</strong> {data.drivingTip}</p>}
        </div>
      );

    case 'hotels':
      return (
        <div className="agent-content">
          {data.recommendation && <p>{data.recommendation}</p>}
          {data.options?.map((opt, i) => (
            <div key={i} className="option-card">
              <strong>{opt.name}</strong>
              <span className="option-price">${opt.pricePerNight}/night</span>
              <p className="option-detail">{opt.area} · {opt.rating}</p>
              <p>{opt.highlights}</p>
            </div>
          ))}
        </div>
      );

    case 'itinerary':
      // Itinerary is a markdown string — render as pre-formatted text
      return (
        <div className="agent-content">
          <pre className="itinerary-text">{typeof data === 'string' ? data : JSON.stringify(data)}</pre>
        </div>
      );

    case 'budget': {
      const statusClass = data.budgetStatus === 'within budget' ? 'budget-ok'
                        : data.budgetStatus === 'under budget' ? 'budget-under'
                        : 'budget-over';
      return (
        <div className="agent-content">
          <div className={`budget-status ${statusClass}`}>{data.budgetStatus}</div>
          <div className="budget-grid">
            {data.flights    !== undefined && <div className="budget-row"><span>Flights</span><span>${data.flights}</span></div>}
            {data.hotels     !== undefined && <div className="budget-row"><span>Hotels</span><span>${data.hotels}</span></div>}
            {data.carRental  !== undefined && data.carRental > 0 && <div className="budget-row"><span>Car Rental</span><span>${data.carRental}</span></div>}
            {data.food       !== undefined && <div className="budget-row"><span>Food</span><span>${data.food}</span></div>}
            {data.activities !== undefined && <div className="budget-row"><span>Activities</span><span>${data.activities}</span></div>}
            {data.miscellaneous !== undefined && <div className="budget-row"><span>Misc</span><span>${data.miscellaneous}</span></div>}
            {data.total      !== undefined && <div className="budget-row budget-total"><span>Total</span><span>${data.total}</span></div>}
          </div>
          {data.savingTips?.length > 0 && (
            <div>
              <strong>Saving tips:</strong>
              <ul>{data.savingTips.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </div>
          )}
        </div>
      );
    }

    case 'packing':
      return (
        <div className="agent-content packing-grid">
          {data.clothing?.length > 0 && (
            <div className="packing-category">
              <strong>Clothing</strong>
              <ul>{data.clothing.map((i, k) => <li key={k}>{i}</li>)}</ul>
            </div>
          )}
          {data.toiletries?.length > 0 && (
            <div className="packing-category">
              <strong>Toiletries</strong>
              <ul>{data.toiletries.map((i, k) => <li key={k}>{i}</li>)}</ul>
            </div>
          )}
          {data.documents?.length > 0 && (
            <div className="packing-category">
              <strong>Documents</strong>
              <ul>{data.documents.map((i, k) => <li key={k}>{i}</li>)}</ul>
            </div>
          )}
          {data.electronics?.length > 0 && (
            <div className="packing-category">
              <strong>Electronics</strong>
              <ul>{data.electronics.map((i, k) => <li key={k}>{i}</li>)}</ul>
            </div>
          )}
          {data.other?.length > 0 && (
            <div className="packing-category">
              <strong>Other</strong>
              <ul>{data.other.map((i, k) => <li key={k}>{i}</li>)}</ul>
            </div>
          )}
          {data.proTip && <p className="tip full-width"><strong>Pro tip:</strong> {data.proTip}</p>}
        </div>
      );

    default:
      return null;
  }
}

// ── Individual agent card ─────────────────────────────────────
function AgentCard({ agentId, status, data, isHighlighted }) {
  const config = AGENT_CONFIG[agentId];
  if (!config) return null;

  return (
    <div className={`agent-card ${isHighlighted ? 'card-highlighted' : ''}`}>
      <div className="card-header">
        <StatusDot status={status || 'waiting'} />
        <h3>{config.label}</h3>
      </div>

      <div className="card-body">
        {status === 'waiting' && (
          <p className="status-message waiting">Waiting...</p>
        )}
        {status === 'running' && (
          <p className="status-message running">{config.runningMsg}</p>
        )}
        {status === 'done' && (
          <AgentContent agentId={agentId} data={data} />
        )}
      </div>
    </div>
  );
}

// ── Chat section ──────────────────────────────────────────────
// WHAT: The interactive chat panel shown after plan is complete.
// PATTERN: Controlled input + scroll-to-bottom on new messages.
function ChatSection({ messages, loading, onSendMessage }) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);

  // [STREAMING] Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    setInput('');
    onSendMessage(trimmed);
  }

  function handleKeyDown(e) {
    // Send on Enter (but not Shift+Enter — that should allow newlines)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="chat-section">
      <div className="chat-header">
        <h2>Refine Your Plan</h2>
        <p>Ask me to change any part of the plan — hotels, flights, itinerary, budget, or packing.</p>
        <p className="chat-examples">
          Try: <em>"Find cheaper hotels under $100/night"</em> or <em>"Add a cooking class to the itinerary"</em> or <em>"My budget changed to $4000"</em>
        </p>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <p className="chat-empty">Your plan is ready. Ask me to change anything.</p>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`chat-message ${msg.role}`}>
            <span className="chat-role">{msg.role === 'user' ? 'You' : 'Assistant'}</span>
            <p>{msg.content}</p>
          </div>
        ))}
        {loading && (
          <div className="chat-message assistant">
            <span className="chat-role">Assistant</span>
            <p className="chat-thinking">Working on it...</p>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-row">
        <input
          type="text"
          className="chat-input"
          placeholder="Ask for any changes to your plan..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
        />
        <button
          className="chat-send-btn"
          onClick={handleSend}
          disabled={loading || !input.trim()}
        >
          {loading ? '...' : 'Send'}
        </button>
      </div>
    </div>
  );
}

// ── Main TripOutput component ─────────────────────────────────
export default function TripOutput({
  tripDetails,
  agentStatuses,
  agentResults,
  fullPlan,
  chatMessages,
  chatLoading,
  lastUpdatedAgent,
  planComplete,
  onChatMessage,
  onReset,
}) {
  const agentOrder = ['research', 'flights', 'cars', 'hotels', 'itinerary', 'budget', 'packing'];

  // Count how many agents are done (for progress display)
  const doneCount = agentOrder.filter(id => agentStatuses[id] === 'done').length;

  return (
    <div className="output-container">

      {/* Header */}
      <div className="output-header">
        <div>
          <h2>
            {tripDetails?.destination}
            {tripDetails?.startDate && (
              <span className="header-dates">
                {' '}— {tripDetails.startDate} to {tripDetails.endDate}
              </span>
            )}
          </h2>
          <p>
            {planComplete
              ? `Plan complete · ${tripDetails?.travelers} traveler(s) · $${tripDetails?.budget} budget`
              : `Building your plan... ${doneCount} / ${agentOrder.length} agents done`}
          </p>
        </div>
        {planComplete && (
          <button className="reset-btn" onClick={onReset}>Plan a New Trip</button>
        )}
      </div>

      {/* Agent cards grid */}
      <div className="agents-grid">
        {agentOrder.map(agentId => (
          <AgentCard
            key={agentId}
            agentId={agentId}
            status={agentStatuses[agentId] || 'waiting'}
            data={agentResults[agentId]}
            isHighlighted={lastUpdatedAgent === agentId}
          />
        ))}
      </div>

      {/* Full plan — shown after orchestrator finishes */}
      {fullPlan && (
        <div className="full-plan">
          <h2>Complete Travel Plan</h2>
          <pre className="plan-text">{fullPlan}</pre>
        </div>
      )}

      {/* Chat section — shown only when plan is complete */}
      {planComplete && (
        <ChatSection
          messages={chatMessages}
          loading={chatLoading}
          onSendMessage={onChatMessage}
        />
      )}
    </div>
  );
}
