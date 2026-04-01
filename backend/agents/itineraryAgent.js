// ============================================================
// agents/itineraryAgent.js — Itinerary Agent (Agent 5 of 8)
// ============================================================
// WHAT: Builds a detailed day-by-day travel itinerary as a formatted
//       markdown string. Morning, afternoon, and evening activities
//       for each day of the trip.
//
// WHY IT EXISTS:
//   The user wants to know what to DO each day. This agent uses the
//   destination research + user interests to create a practical,
//   logically-ordered plan (not just a list of attractions).
//
// ── KEY PATTERN DIFFERENCE: NO TOOL LOOP ────────────────────
//
//   Every agent you've seen so far (research, flights, carRental, hotels)
//   uses an agent loop with tools. THIS agent does NOT.
//
//   WHY: The agent loop exists to let Claude gather information it DOESN'T
//   have yet. But by the time itineraryAgent runs, it already has:
//     ✅ The destination (from tripDetails)
//     ✅ The travel dates (from tripDetails)
//     ✅ The traveler's interests (from tripDetails)
//     ✅ Top attractions (from research.highlights)
//     ✅ Best areas (from research.bestAreas)
//     ✅ Local tips (from research.localTips)
//     ✅ Weather context (from research.weather)
//
//   There is NOTHING LEFT TO SEARCH FOR. Claude has all the context
//   it needs to think and plan. Searching would be wasted time and money.
//
//   RULE: Use a tool loop when the agent needs to GATHER information.
//         Use a single call when the agent needs to REASON with existing information.
//
// PATTERN [AGENT] — single LLM call:
//   1. Build a rich user message with ALL the context
//   2. Call client.messages.create() ONCE (no tools, no loop)
//   3. Extract the text response
//   4. Return it as-is (it's already markdown, not JSON)
//
// WHY MARKDOWN NOT JSON:
//   Itinerary is prose — "After breakfast at a local café, walk to the
//   Eiffel Tower...". Forcing it into JSON would make it awkward.
//   The orchestrator receives this as a string and includes it in the
//   final markdown plan. The frontend displays it as formatted text.
//
// HOW DATA FLOWS:
//   tripDetails + research (from plan.js) →
//     [single Claude call, no tools] →
//     Claude reasons: dates → number of days → attractions from research
//                  → interests filter → logical daily grouping by area →
//     Returns markdown string like:
//       "## Day 1 — Arrival & Central Paris\n..."
//   output: markdown string (day-by-day plan)
//     → packingAgent uses this to know what activities to pack for
//     → orchestrator includes this in the final plan
// ============================================================

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

// [AGENT] System prompt — itinerary planner specialist.
// KEY: We ask for markdown format directly (not JSON) because itinerary
// content is naturally prose, not structured data.
// We also ask Claude to group activities by AREA — this reduces
// travel time between spots (a genuinely useful travel planning technique).
const SYSTEM_PROMPT = `You are an expert travel itinerary planner who creates
practical, well-paced day-by-day travel plans.

Create a detailed itinerary that:
- Groups activities by area each day (minimize cross-city travel)
- Balances sightseeing, meals, rest, and the traveler's specific interests
- Includes practical timing (morning/afternoon/evening)
- Mentions specific neighborhoods, landmarks, and local restaurants
- Accounts for travel time between attractions
- Includes at least one local food experience per day

Format as clean markdown with this structure for each day:
## Day N — [Theme or Main Area]
**Morning:** [activities]
**Afternoon:** [activities]
**Evening:** [activities + dinner recommendation]

Be specific and practical, not generic. Use the research data provided.`;

// ============================================================
// [AGENT] Exported function — called by routes/plan.js
// ============================================================
// INPUT:
//   tripDetails — { destination, startDate, endDate, travelers, budget, interests }
//   research    — { weather, bestAreas, visaInfo, localTips, currency, highlights }
//
// OUTPUT: markdown string (day-by-day itinerary)
//   "## Day 1 — Arrival & [Area]\n**Morning:** ...\n..."
//   → NOT JSON. Plain markdown text.
// ============================================================
export async function itineraryAgent(tripDetails, research) {
  console.log(`\n[itineraryAgent] Building itinerary for: ${tripDetails.destination}`);

  // [AGENT] Calculate trip duration — Claude needs this to know how many
  // days to plan for. We compute it here instead of sending raw dates and
  // hoping Claude does the math correctly.
  const startDate = new Date(tripDetails.startDate);
  const endDate = new Date(tripDetails.endDate);
  const nights = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
  const days = nights + 1; // include arrival and departure days

  // [AGENT] Build a rich user message.
  // WHY SO DETAILED: The more context Claude has, the better the itinerary.
  // We include ALL the research output so Claude can reference it directly —
  // e.g. "Day 3: Visit the Louvre (mentioned in highlights) in the Marais
  // area (mentioned in bestAreas), and try a patisserie (from localTips)".
  const userMessage = `Create a day-by-day itinerary for this trip:

TRIP DETAILS:
- Destination: ${tripDetails.destination}
- Dates: ${tripDetails.startDate} to ${tripDetails.endDate} (${days} days, ${nights} nights)
- Travelers: ${tripDetails.travelers} person(s)
- Budget: $${tripDetails.budget} USD total
- Interests: ${tripDetails.interests}

DESTINATION RESEARCH:
- Weather during dates: ${research.weather}
- Top highlights: ${research.highlights?.join(', ') || 'major attractions'}
- Best areas to explore: ${research.bestAreas?.join('; ') || 'city center'}
- Local tips: ${research.localTips?.join('; ') || ''}
- Currency: ${research.currency}

Create a complete ${days}-day itinerary. Day 1 should account for arrival and
settling in. The last day should be lighter to allow for packing and departure.
Use the specific highlights and areas from the research above.`;

  // [AGENT] Single LLM call — NO tools, NO loop.
  // WHY NO tools array: We don't pass tools at all. Claude cannot call
  // tavilySearch even if it wanted to. This forces it into pure reasoning mode.
  //
  // Compare to flightsAgent where we pass tools: [tavilySearchTool].
  // Removing that array is the entire difference between a tool-loop agent
  // and a single-call agent.
  console.log(`[itineraryAgent] Calling Claude (single call, no tools)`);

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',

    // [AGENT] max_tokens: 4096 because itinerary text is long.
    // A 7-day itinerary with morning/afternoon/evening details can be
    // 1500-2500 words. We need enough tokens for the full output.
    max_tokens: 4096,

    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],

    // [AGENT] No tools array — this is intentionally absent.
    // Absence = pure reasoning, no searching.
  });

  console.log(`[itineraryAgent] stop_reason: ${response.stop_reason}`);

  // [AGENT] Extract the text response.
  // For single-call agents, stop_reason is always 'end_turn' (no tool loops).
  // We just find the text block and return it directly as a string.
  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock) {
    throw new Error('itineraryAgent: Claude returned no text');
  }

  console.log(`[itineraryAgent] Itinerary generated (${textBlock.text.length} characters)`);

  // Return the markdown string directly — no JSON parsing needed.
  // The caller (plan.js) stores this as a string and passes it to
  // packingAgent and orchestrator.
  return textBlock.text;
}
