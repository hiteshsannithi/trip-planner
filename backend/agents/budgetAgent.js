// ============================================================
// agents/budgetAgent.js — Budget Agent (Agent 6 of 8)
// ============================================================
// WHAT: Produces a complete cost breakdown in USD for the trip:
//       flights, hotels, car rental, food, activities, and miscellaneous.
//       Calculates total and compares to the user's stated budget.
//
// WHY IT EXISTS:
//   The user gave a budget but doesn't know if it's enough.
//   This agent answers: "Can I actually afford this trip?"
//   and "Where will my money go?"
//
// PATTERN [AGENT] — single LLM call (no tool loop):
//   Same as itineraryAgent. One call, no tools.
//   WHY: Budget estimation is pure math + reasoning. Claude can:
//     - Use research.currency to understand cost of living
//     - Use research.localTips for price expectations
//     - Apply known ranges for flights, hotels, food
//     - Do the arithmetic to total everything up
//   There's nothing to search for — all the data it needs is in the
//   research output and the tripDetails.
//
// NOTE ON FLIGHTS + HOTELS DATA:
//   The spec mentions budgetAgent should use actual flightsAgent and
//   hotelsAgent outputs. In our workflow, all 5 parallel agents
//   (including budgetAgent) run at the same time, so those outputs
//   aren't available yet when budgetAgent starts.
//
//   We resolve this by giving budgetAgent rich research context so it
//   can make realistic estimates. In a production app where accuracy
//   is critical, you'd run flights + hotels first, then budgetAgent.
//   The agent structure would stay identical — only the order changes.
//
// HOW DATA FLOWS:
//   tripDetails + research →
//     [single Claude call, no tools] →
//     Claude estimates each cost category based on:
//       - Trip duration (from tripDetails dates)
//       - Number of travelers (from tripDetails.travelers)
//       - Local cost of living (from research.currency + localTips)
//       - User's budget (from tripDetails.budget)
//     Returns structured JSON with per-category breakdown →
//   output: { flights, hotels, carRental, food, activities,
//             miscellaneous, total, budgetStatus, savingTips }
//     → orchestrator includes this in the final plan
// ============================================================

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

// [AGENT] System prompt — budget analyst role.
// KEY INSTRUCTION: Return actual USD numbers (not ranges like "$50-$80").
// We need numbers the frontend can display clearly.
// Also ask for budgetStatus: "within/over/under" — this drives UI color
// (green = under budget, red = over budget).
const SYSTEM_PROMPT = `You are a travel budget specialist for Indian travelers.
Your job is to create a realistic cost breakdown for a trip in USD.

Based on the trip details and destination research provided, estimate costs for:
- Flights (round trip per person × number of travelers)
- Hotels (per night rate × number of nights × rooms needed)
- Car rental (if applicable, daily rate × number of days)
- Food (daily per person budget × days × travelers)
- Activities and entrance fees (based on itinerary interests)
- Miscellaneous (transport within city, tips, sim card, etc.)

Use the local cost context from the research to make estimates realistic.

Respond with ONLY a JSON object in this exact format:
{
  "flights": 1600,
  "hotels": 840,
  "carRental": 0,
  "food": 420,
  "activities": 200,
  "miscellaneous": 150,
  "total": 3210,
  "budgetStatus": "over budget",
  "savingTips": [
    "Book flights 6-8 weeks ahead to save ~20%",
    "Choose a mid-range hotel in [area] instead of city center to save $30/night",
    "Eat lunch at local markets instead of tourist restaurants"
  ]
}

budgetStatus must be exactly one of: "within budget", "over budget", or "under budget"
All values in USD. savingTips should be specific to this destination.
Do not include any text before or after the JSON. Return only the JSON object.`;

// ============================================================
// [AGENT] Exported function — called by routes/plan.js
// ============================================================
// INPUT:
//   tripDetails — { destination, startDate, endDate, travelers, budget, interests }
//   research    — { weather, bestAreas, visaInfo, localTips, currency, highlights }
//
// OUTPUT:
//   {
//     flights: number,
//     hotels: number,
//     carRental: number,
//     food: number,
//     activities: number,
//     miscellaneous: number,
//     total: number,
//     budgetStatus: "within budget" | "over budget" | "under budget",
//     savingTips: string[]
//   }
// ============================================================
export async function budgetAgent(tripDetails, research) {
  console.log(`\n[budgetAgent] Estimating budget for: ${tripDetails.destination}`);

  // [AGENT] Pre-compute trip duration so Claude doesn't have to.
  const startDate = new Date(tripDetails.startDate);
  const endDate = new Date(tripDetails.endDate);
  const nights = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
  const rooms = Math.ceil(tripDetails.travelers / 2);

  // [AGENT] Build the user message.
  // WHY include budget explicitly: Claude needs to know the user's target
  // to classify budgetStatus as within/over/under.
  const userMessage = `Create a cost breakdown for this trip:

TRIP DETAILS:
- Destination: ${tripDetails.destination}
- Departure city: ${tripDetails.departureCity}
- Duration: ${tripDetails.startDate} to ${tripDetails.endDate} (${nights} nights)
- Travelers: ${tripDetails.travelers} person(s) — ${rooms} room(s) needed
- USER'S TOTAL BUDGET: $${tripDetails.budget} USD (compare your total against this)
- Interests: ${tripDetails.interests}

DESTINATION COST CONTEXT:
- Currency and costs: ${research.currency}
- Local tips with price context: ${research.localTips?.join('; ') || ''}
- Best areas (affects hotel pricing): ${research.bestAreas?.slice(0, 2).join(', ') || ''}

Estimate all cost categories realistically. Remember to multiply per-person
costs by ${tripDetails.travelers} traveler(s). Then compare total to the
user's budget of $${tripDetails.budget} and set budgetStatus accordingly.`;

  console.log(`[budgetAgent] Calling Claude (single call, no tools)`);

  // [AGENT] Single LLM call — same pattern as itineraryAgent.
  // No tools: Claude has all the data it needs in the message above.
  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024, // Budget JSON is compact — 1024 tokens is plenty
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  console.log(`[budgetAgent] stop_reason: ${response.stop_reason}`);

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock) throw new Error('budgetAgent: No text in final response');

  // [AGENT] Parse JSON — same two-step pattern as all other agents.
  try {
    return JSON.parse(textBlock.text);
  } catch {
    const jsonMatch = textBlock.text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) return JSON.parse(jsonMatch[1]);
    throw new Error(`budgetAgent: Could not parse JSON: ${textBlock.text.substring(0, 200)}`);
  }
}
