// ============================================================
// agents/packingAgent.js — Packing Agent (Agent 7 of 8)
// ============================================================
// WHAT: Creates a categorized packing list tailored to the destination's
//       weather and the specific activities in the itinerary.
//
// WHY IT EXISTS:
//   A generic "what to pack for Europe" list is unhelpful.
//   This agent builds a list specific to:
//     - THIS destination's weather (hot/cold/rainy)
//     - THESE specific activities (beach → swimwear, museums → smart-casual)
//     - THIS traveler's profile (number of travelers, interests)
//
// WHY IT RUNS LAST (after itinerary is done):
//   packingAgent receives the itinerary as input.
//   WHY: It needs to know what activities are planned to pack correctly.
//   If the itinerary includes hiking, pack hiking boots.
//   If it includes a formal dinner, pack dress clothes.
//   It CANNOT run in parallel with itineraryAgent because it DEPENDS on
//   itineraryAgent's output.
//
//   This is the key reason packingAgent is in Step 4, not Step 3.
//   DEPENDENCY DETERMINES SEQUENCE in a workflow.
//
// PATTERN [AGENT] — single LLM call (no tool loop):
//   One call, no tools. Same as itineraryAgent and budgetAgent.
//   Claude has weather + itinerary + interests. No searching needed.
//
// HOW DATA FLOWS:
//   tripDetails + research + itinerary →
//     [single Claude call] →
//     Claude reads weather to decide clothing weight →
//     Claude reads itinerary to decide activity-specific gear →
//     Claude reads interests to add specialty items →
//     Returns categorized packing list JSON →
//   output: { clothing, toiletries, documents, electronics, other, proTip }
//     → orchestrator includes this in the final plan
// ============================================================

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

// [AGENT] System prompt — packing specialist role.
// KEY: Categories match what the frontend displays as separate list sections.
// documents is important — many travelers forget visa printouts, travel insurance, etc.
const SYSTEM_PROMPT = `You are a travel packing expert who creates practical,
specific packing lists based on destination, weather, and planned activities.

Create a packing list that is:
- Specific to the destination's weather (not generic)
- Tailored to the activities in the itinerary (if hiking is planned, include boots)
- Practical (what travelers actually forget, not obvious items)
- Organized by category

Respond with ONLY a JSON object in this exact format:
{
  "clothing": [
    "3x lightweight t-shirts (weather is hot and humid)",
    "1x smart casual outfit (restaurant dinners)",
    "1x light rain jacket (afternoon showers common in June)"
  ],
  "toiletries": [
    "Sunscreen SPF 50 (strong sun in summer)",
    "Insect repellent (parks and outdoor areas)"
  ],
  "documents": [
    "Passport (valid 6+ months beyond travel dates)",
    "Visa approval letter (print 2 copies)",
    "Travel insurance certificate",
    "Hotel booking confirmations"
  ],
  "electronics": [
    "Universal power adapter (Type C/E sockets in France)",
    "Portable charger (full day of sightseeing)"
  ],
  "other": [
    "Reusable water bottle",
    "Comfortable walking shoes (cobblestone streets)"
  ],
  "proTip": "One practical tip specific to this destination — e.g. 'Paris streets have cobblestones — avoid suitcases with small wheels'"
}

Each item should have a reason in parentheses explaining WHY to pack it.
Do not include any text before or after the JSON. Return only the JSON object.`;

// ============================================================
// [AGENT] Exported function — called by routes/plan.js AFTER itinerary
// ============================================================
// INPUT:
//   tripDetails — { destination, startDate, endDate, travelers, interests }
//   research    — { weather, bestAreas, visaInfo, localTips, currency, highlights }
//   itinerary   — markdown string from itineraryAgent (day-by-day plan)
//
// OUTPUT:
//   {
//     clothing: string[],
//     toiletries: string[],
//     documents: string[],
//     electronics: string[],
//     other: string[],
//     proTip: string
//   }
// ============================================================
export async function packingAgent(tripDetails, research, itinerary) {
  console.log(`\n[packingAgent] Building packing list for: ${tripDetails.destination}`);

  // [AGENT] User message passes three contexts:
  // 1. Trip basics (destination, dates, travelers)
  // 2. Weather from research (what to pack clothing-wise)
  // 3. The actual itinerary text (what activities to pack FOR)
  //
  // WHY PASS THE FULL ITINERARY TEXT:
  // Claude can read "Day 3 — Hiking in Versailles gardens" and deduce
  // "pack comfortable walking shoes and a water bottle for Day 3."
  // It's using itinerary as context, not just a summary.
  const userMessage = `Create a packing list for this trip:

TRIP DETAILS:
- Destination: ${tripDetails.destination}
- Travel dates: ${tripDetails.startDate} to ${tripDetails.endDate}
- Travelers: ${tripDetails.travelers} person(s)
- Interests: ${tripDetails.interests}

WEATHER AT DESTINATION:
${research.weather}

VISA AND DOCUMENT REQUIREMENTS:
${research.visaInfo}

PLANNED ITINERARY (pack specifically for these activities):
${itinerary}

Create a practical, specific packing list based on the weather above and
the activities in the itinerary. Include important travel documents for
Indian passport holders visiting ${tripDetails.destination}.`;

  console.log(`[packingAgent] Calling Claude (single call, no tools)`);

  // [AGENT] Single call — Claude reasons with weather + itinerary text.
  // No tools needed. No searching. Pure synthesis of provided context.
  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  console.log(`[packingAgent] stop_reason: ${response.stop_reason}`);

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock) throw new Error('packingAgent: No text in final response');

  try {
    return JSON.parse(textBlock.text);
  } catch {
    const jsonMatch = textBlock.text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) return JSON.parse(jsonMatch[1]);
    throw new Error(`packingAgent: Could not parse JSON: ${textBlock.text.substring(0, 200)}`);
  }
}
