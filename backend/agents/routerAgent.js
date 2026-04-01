// ============================================================
// agents/routerAgent.js — Router Agent (Chat Feature)
// ============================================================
// WHAT: Reads the user's plain-English chat message and decides
//       which specialist agent to re-run, plus extracts any
//       parameter changes the user implied.
//
// WHY IT EXISTS:
//   After the plan is generated, the user can ask for changes:
//     "find cheaper hotels"
//     "I want more outdoor activities on Day 3"
//     "my budget changed to $2000"
//     "show me business class flights"
//
//   Without a router, the frontend would need a dropdown asking
//   "which section do you want to change?" — bad UX.
//   With a router, the user types naturally and Claude reads intent.
//
// PATTERN [AGENT] — single LLM call, no tools:
//   One call, no loop. This agent is a CLASSIFIER, not a researcher.
//   It reads the user's message → decides which specialist to delegate to.
//   Think of it as a receptionist who routes incoming requests.
//
// ── THE ROUTER PATTERN ───────────────────────────────────────
//   This is a common pattern in multi-agent systems:
//
//   User message → routerAgent → { targetAgent, modifiedParams }
//                                       ↓
//                          re-run that ONE specialist
//                                       ↓
//                          stream updated section to UI
//
//   The router keeps the user experience simple (just type anything)
//   while keeping the backend efficient (only one agent re-runs).
//
// OUTPUT SCHEMA:
//   {
//     targetAgent: 'hotels' | 'flights' | 'cars' |
//                  'itinerary' | 'budget' | 'packing' | 'general',
//     explanation: "why I chose this agent",
//     modifiedParams: {
//       budget: 2000,          // if user mentioned a new budget
//       interests: "...",      // if user mentioned new interests
//       travelers: 3,          // if user changed traveler count
//       // any other tripDetails field the user changed
//     }
//   }
//
//   modifiedParams: only includes fields the user explicitly changed.
//   Empty object {} if the user didn't change any parameters.
//   The chat route merges these into tripDetails before re-calling
//   the agent, so the agent runs with the user's updated constraints.
//
//   targetAgent: 'general' means the message doesn't map to one agent
//   (e.g. "what's the visa process again?") — the chat route handles
//   this differently (answers from existing context, no re-run).
//
// HOW DATA FLOWS:
//   { message, tripDetails, agentResults } →
//     [single Haiku call] →
//     Claude reads message, identifies intent, extracts params →
//   output: { targetAgent, explanation, modifiedParams }
//     → used by routes/chat.js to decide which agent to re-run
// ============================================================

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

// [AGENT] System prompt — router/classifier role.
// KEY: Give Claude a clear list of available agents and what triggers each.
// The more specific the descriptions, the more accurate the routing.
const SYSTEM_PROMPT = `You are a routing agent for a travel planning assistant.
The user has received a travel plan and wants to modify part of it.
Your job is to read their message and decide which specialist agent to re-run.

Available agents and when to use them:
- "flights": User wants different flights, airlines, prices, or travel times
- "cars": User wants different car rental options or transport advice
- "hotels": User wants different hotels, cheaper options, different areas, or amenities
- "itinerary": User wants to change activities, add/remove days, change schedule
- "budget": User wants a new cost breakdown, changed spending estimates
- "packing": User wants a different or updated packing list
- "general": User is asking a question (not requesting a change), or the message
             doesn't clearly map to one agent

Also extract any parameters the user explicitly changed:
- If they mention a new budget amount → modifiedParams.budget = number
- If they mention new interests → modifiedParams.interests = string
- If they mention different number of travelers → modifiedParams.travelers = number

Respond with ONLY a JSON object in this exact format:
{
  "targetAgent": "hotels",
  "explanation": "User wants cheaper hotel options",
  "modifiedParams": {
    "budget": 2000
  }
}

modifiedParams should only include fields the user explicitly mentioned changing.
If nothing changed, use an empty object: "modifiedParams": {}
Do not include any text before or after the JSON. Return only the JSON object.`;

// ============================================================
// [AGENT] Exported function — called by routes/chat.js
// ============================================================
// INPUT:
//   message       — user's plain-English chat message
//   tripDetails   — the original form data (for context)
//   agentResults  — current results from all agents (for context)
//
// OUTPUT:
//   {
//     targetAgent: string,
//     explanation: string,
//     modifiedParams: object
//   }
// ============================================================
export async function routerAgent(message, tripDetails, agentResults) {
  console.log(`\n[routerAgent] Routing message: "${message}"`);

  // [AGENT] Build the user message.
  // WHY include tripDetails + agentResults summary: Claude needs context
  // to understand what the user is referring to. "Find cheaper hotels"
  // only makes sense if Claude knows what hotels were found.
  const userMessage = `The user has received a travel plan for:
- Destination: ${tripDetails.destination}
- Departure: ${tripDetails.departureCity}
- Dates: ${tripDetails.startDate} to ${tripDetails.endDate}
- Travelers: ${tripDetails.travelers}
- Budget: $${tripDetails.budget} USD
- Interests: ${tripDetails.interests}

Current plan sections available:
${agentResults.flights ? '- Flights: found options starting at $' + (agentResults.flights.cheapestPrice || 'unknown') : ''}
${agentResults.hotels ? '- Hotels: found options in ' + (agentResults.hotels.options?.length || 0) + ' properties' : ''}
${agentResults.cars ? '- Car rentals: recommendation = ' + (agentResults.cars.recommendation?.substring(0, 80) || '') : ''}
${agentResults.itinerary ? '- Itinerary: day-by-day plan generated' : ''}
${agentResults.budget ? '- Budget: total estimated $' + (agentResults.budget.total || 'unknown') + ', status: ' + (agentResults.budget.budgetStatus || '') : ''}
${agentResults.packing ? '- Packing list: generated' : ''}

The user's new message:
"${message}"

Route this message to the most appropriate specialist agent and extract any changed parameters.`;

  // [AGENT] Single Haiku call — classification doesn't need Sonnet.
  // Haiku is accurate enough for intent classification at 1/5 the cost.
  console.log(`[routerAgent] Calling Claude to classify intent`);

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 512, // routing response is tiny — just a small JSON object
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock) throw new Error('routerAgent: No text in response');

  try {
    const routing = JSON.parse(textBlock.text);
    console.log(`[routerAgent] Routing to: ${routing.targetAgent} — ${routing.explanation}`);
    if (Object.keys(routing.modifiedParams || {}).length > 0) {
      console.log(`[routerAgent] Modified params:`, routing.modifiedParams);
    }
    return routing;
  } catch {
    const jsonMatch = textBlock.text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) return JSON.parse(jsonMatch[1]);
    throw new Error(`routerAgent: Could not parse JSON: ${textBlock.text.substring(0, 200)}`);
  }
}
