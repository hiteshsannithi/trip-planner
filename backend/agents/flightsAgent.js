// ============================================================
// agents/flightsAgent.js — Flights Agent (Agent 2 of 8)
// ============================================================
// WHAT: Searches for flight options from the user's departure city
//       to the destination. Returns structured data with options,
//       prices, airlines, and a booking tip.
//
// WHY IT EXISTS:
//   The user needs real flight options to plan and budget their trip.
//   We use Tavily to search Indian travel sites (MakeMyTrip, Goibibo,
//   Yatra) the same way a user would — but automatically.
//
// PATTERN [AGENT] + [AGENT LOOP]:
//   This file is STRUCTURALLY IDENTICAL to researchAgent.js.
//   Same while loop. Same tool dispatch. Same JSON parse at the end.
//   The ONLY differences are:
//     1. The system prompt (role = flight search specialist)
//     2. The output JSON schema (flights-specific fields)
//     3. The user message (asks for flights not destination research)
//
//   This is intentional — it proves the agent loop is a reusable pattern.
//   Once you understand it in researchAgent, you understand it everywhere.
//
// ── THE "SWAP THE TOOL" LESSON ───────────────────────────────
//   In a production app, you would swap Tavily for a dedicated API:
//     → Amadeus API: professional flight data, requires approval
//     → Skyscanner API: great prices, complex OAuth setup
//     → Google Flights API: via SerpAPI, paid but reliable
//
//   HOW TO SWAP: Only change ONE thing inside the tool_use handler below:
//     BEFORE: const results = await tavilySearch(toolUse.input.query)
//     AFTER:  const results = await amadeusSearch(toolUse.input.origin,
//                                                  toolUse.input.destination)
//
//   The while loop, the message building, the JSON parsing — all stays
//   exactly the same. This is why separating tools from agents matters.
//
// HOW DATA FLOWS:
//   tripDetails + research (from plan.js) →
//     [build user message with context] →
//     Claude reads, decides to search for flights →
//     [tool call] tavilySearch("flights Mumbai to Paris June 2025") →
//     Claude reads results, may search again (prices, airlines) →
//     Claude has enough data, returns structured JSON →
//   output: { options, cheapestPrice, bestOption, bookingTip }
//     → used by budgetAgent (to get actual flight prices)
//     → used by orchestrator (to include in final plan)
//
// MODEL CHOICE: claude-haiku-4-5
//   WHY: Searching + extracting flight data is a straightforward task.
//   Haiku handles it well at ~10x less cost than Sonnet.
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import { tavilySearch, tavilySearchTool } from '../tools/tavilySearch.js';

// [AGENT] One client instance per file — lightweight and stateless.
const client = new Anthropic();

// [AGENT] System prompt: defines this agent's specialist role.
// WHY FLIGHT-SPECIFIC: A focused role gets better results than a generic
// "helpful assistant" prompt. Claude knows to stay on topic and format
// output exactly as instructed.
//
// KEY INSTRUCTION: "Return ONLY a JSON object" — this is critical.
// The workflow in plan.js parses this JSON and passes it to budgetAgent.
// Without strict JSON output, we'd have to do complex text parsing.
const SYSTEM_PROMPT = `You are a flight search specialist for Indian travelers.
Your job is to find realistic flight options between Indian cities and
international destinations.

You have access to a web search tool. Use it 1-2 times to search for:
1. Current flight prices from the departure city to the destination
2. Available airlines, number of stops, and travel duration

Search as a traveler would — look for results from MakeMyTrip, Goibibo,
Yatra, and Google Flights. Focus on options realistic for Indian travelers.
Prices must be in USD per person.

After searching, respond with ONLY a JSON object in this exact format:
{
  "options": [
    {
      "airline": "airline name(s) for this itinerary",
      "departure": "departure time and city",
      "arrival": "arrival time and city (next day if overnight)",
      "duration": "total travel time including layovers e.g. 14h 30m",
      "stops": "number of stops e.g. 1 stop via Dubai",
      "price": 800
    }
  ],
  "cheapestPrice": 650,
  "bestOption": "Description of best value option and why — e.g. 'Emirates via Dubai: good balance of price, comfort, and reasonable layover'",
  "bookingTip": "Practical advice — e.g. 'Book 6-8 weeks ahead, use incognito mode, Tuesday/Wednesday flights are cheaper'"
}

Provide 2-4 realistic options at different price points.
Do not include any text before or after the JSON. Return only the JSON object.`;

// ============================================================
// [AGENT] The exported function — called by routes/plan.js
// ============================================================
// INPUT:
//   tripDetails — the user's form data
//     { destination, departureCity, startDate, endDate, travelers, budget, interests }
//   research — output from researchAgent
//     { weather, bestAreas, visaInfo, localTips, currency, highlights }
//
// OUTPUT: Parsed JSON
//   {
//     options: [{ airline, departure, arrival, duration, stops, price }],
//     cheapestPrice: number,
//     bestOption: string,
//     bookingTip: string
//   }
// ============================================================
export async function flightsAgent(tripDetails, research) {
  console.log(`\n[flightsAgent] Searching: ${tripDetails.departureCity} → ${tripDetails.destination}`);

  // [AGENT] Build the user message with trip context.
  // WHY include research: Claude uses destination context to write better
  // search queries (e.g. it knows the airport name, travel season, etc.)
  const userMessage = `Find flight options for this trip:
- From: ${tripDetails.departureCity}
- To: ${tripDetails.destination}
- Outbound date: ${tripDetails.startDate}
- Return date: ${tripDetails.endDate}
- Number of travelers: ${tripDetails.travelers}
- Total trip budget: $${tripDetails.budget} USD

Destination research context:
- Weather: ${research.weather}
- Currency: ${research.currency}

Search Indian travel sites for current flight prices and options.
Return the structured JSON with 2-4 realistic options.`;

  // [AGENT LOOP] Start the conversation with the user message.
  // Same pattern as researchAgent — messages array grows with each loop iteration.
  const messages = [{ role: 'user', content: userMessage }];
  let response;

  // [AGENT LOOP] The core agentic loop — runs until Claude says end_turn.
  // Expected iterations for a typical flight search:
  //   Loop 1: Claude searches for flights → stop_reason: tool_use
  //   Loop 2: Claude reads results, may search again → stop_reason: tool_use OR end_turn
  //   Loop 3: Claude has enough data, returns JSON → stop_reason: end_turn
  while (true) {
    console.log(`[flightsAgent] Calling Claude (message count: ${messages.length})`);

    response = await client.messages.create({
      model: 'claude-haiku-4-5',

      // [AGENT] max_tokens: 2048 is enough for flight data.
      // Less than researchAgent's 4096 because flight JSON is smaller
      // than research JSON (fewer fields, shorter descriptions).
      max_tokens: 2048,

      system: SYSTEM_PROMPT,
      messages,

      // [TOOL] Give Claude access to tavilySearch so it can look up flights.
      // Without this array, Claude would have to make up flight data.
      tools: [tavilySearchTool],
    });

    console.log(`[flightsAgent] stop_reason: ${response.stop_reason}`);

    // [AGENT LOOP] Add Claude's response to the history so it has context next iteration.
    messages.push({ role: 'assistant', content: response.content });

    // [AGENT LOOP] Done — Claude finished and returned the JSON.
    if (response.stop_reason === 'end_turn') {
      console.log(`[flightsAgent] Search complete.`);
      break;
    }

    // [AGENT LOOP] Claude wants to call a tool — execute it and send results back.
    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');

      const toolResults = await Promise.all(
        toolUseBlocks.map(async (toolUse) => {
          console.log(`[flightsAgent] Tool call: ${toolUse.name}("${toolUse.input.query}")`);

          let result;
          try {
            if (toolUse.name === 'tavilySearch') {
              // [TOOL] Call the actual tavilySearch function.
              // In a production app, THIS is the only line you'd change to
              // swap in Amadeus or Skyscanner — everything else stays the same.
              const searchResults = await tavilySearch(toolUse.input.query);
              result = JSON.stringify(searchResults, null, 2);
              console.log(`[flightsAgent] Got ${searchResults.length} results`);
            } else {
              result = `Unknown tool: ${toolUse.name}`;
            }
          } catch (error) {
            result = `Tool error: ${error.message}`;
            console.error(`[flightsAgent] Tool error:`, error.message);
          }

          // [TOOL] Return result in the exact format the Claude API expects.
          // tool_use_id MUST match the id from the tool_use block — this is
          // how Claude knows which tool call this result belongs to.
          return {
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: result,
          };
        })
      );

      // [AGENT LOOP] Send tool results back to Claude as a 'user' message.
      // Convention: tool results are always 'user' role (you're "telling" Claude the results).
      messages.push({ role: 'user', content: toolResults });
    }
  }

  // ── Parse and return Claude's final JSON response ───────────
  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock) {
    throw new Error('flightsAgent: Claude returned no text in final response');
  }

  // [AGENT] Parse the JSON — same two-step approach as researchAgent.
  // Try direct parse first, fall back to extracting from markdown code fences.
  try {
    return JSON.parse(textBlock.text);
  } catch {
    const jsonMatch = textBlock.text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) return JSON.parse(jsonMatch[1]);
    throw new Error(`flightsAgent: Could not parse JSON: ${textBlock.text.substring(0, 200)}`);
  }
}
