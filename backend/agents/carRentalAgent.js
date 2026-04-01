// ============================================================
// agents/carRentalAgent.js — Car Rental Agent (Agent 3 of 8)
// ============================================================
// WHAT: Searches for car rental options (self-drive and chauffeur-driven)
//       at the destination. Returns company options, prices, and a
//       driving tip specific to that country/city.
//
// WHY IT EXISTS:
//   Not every destination is walkable or well-served by public transit.
//   The user needs to know whether to rent a car, and what it costs.
//   For some destinations (e.g. a European capital) a car is unnecessary.
//   The agent handles this nuance through its system prompt.
//
// PATTERN [AGENT] + [AGENT LOOP]:
//   Structurally identical to flightsAgent. If you understand that file,
//   you already understand this one. The pattern:
//     1. Build user message with context
//     2. while(true): call Claude with tools
//     3. If tool_use → execute tavilySearch → send results back → loop
//     4. If end_turn → parse JSON → return
//
//   The ONLY differences from flightsAgent:
//     1. System prompt (role = car rental specialist)
//     2. Output JSON schema (car-specific fields)
//     3. User message (asks for car rentals not flights)
//
// ── THE "SWAP THE TOOL" LESSON ───────────────────────────────
//   In production you might swap Tavily for:
//     → Rentalcars.com API
//     → Expedia Cars API
//     → RapidAPI car rental endpoints
//   Change only the inside of the tool dispatch switch. Everything else stays.
//
// HOW DATA FLOWS:
//   tripDetails + research →
//     Claude searches "{destination} car rental per day price" →
//     Claude searches "self drive vs chauffeur {destination}" (optional) →
//     Returns structured JSON →
//   output: { options, recommendation, bookingTip, drivingTip }
//     → used by orchestrator in final plan
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import { tavilySearch, tavilySearchTool } from '../tools/tavilySearch.js';

const client = new Anthropic();

// [AGENT] System prompt — car rental specialist role.
// KEY INSTRUCTION: Include a drivingTip about local driving laws/conditions.
// This makes the output more useful (e.g. "Drive on the left in UK",
// "International license required in Japan", "Traffic is heavy in Bangkok").
const SYSTEM_PROMPT = `You are a car rental specialist for international travelers.
Your job is to find car rental options at the destination and advise on
self-drive vs chauffeur options.

You have access to a web search tool. Use it 1-2 times to search for:
1. Car rental prices and companies at the destination (per day rates in USD)
2. Whether self-drive is practical (traffic, parking, road conditions)

After searching, respond with ONLY a JSON object in this exact format:
{
  "options": [
    {
      "company": "rental company name (e.g. Hertz, local company)",
      "carType": "type of car e.g. Economy Hatchback, SUV, Sedan",
      "pricePerDay": 45,
      "features": "key features e.g. AC, automatic, GPS included"
    }
  ],
  "recommendation": "Whether to rent a car or use public transit/taxis, and why",
  "bookingTip": "Where to book, when to book, what to watch out for",
  "drivingTip": "Local driving law or condition travelers must know — e.g. international license required, drive on left, specific traffic rules"
}

Provide 2-3 options at different price points. Prices in USD per day.
Do not include any text before or after the JSON. Return only the JSON object.`;

// ============================================================
// [AGENT] Exported function — called by routes/plan.js
// ============================================================
// INPUT:
//   tripDetails — { destination, departureCity, startDate, endDate, travelers, budget, interests }
//   research    — { weather, bestAreas, visaInfo, localTips, currency, highlights }
//
// OUTPUT:
//   {
//     options: [{ company, carType, pricePerDay, features }],
//     recommendation: string,
//     bookingTip: string,
//     drivingTip: string
//   }
// ============================================================
export async function carRentalAgent(tripDetails, research) {
  console.log(`\n[carRentalAgent] Searching car rentals at: ${tripDetails.destination}`);

  // [AGENT] User message with trip and research context.
  // WHY include research.bestAreas: Claude can give better recommendations
  // if it knows which neighborhoods to get around between.
  const userMessage = `Find car rental options for this trip:
- Destination: ${tripDetails.destination}
- Travel dates: ${tripDetails.startDate} to ${tripDetails.endDate}
- Number of travelers: ${tripDetails.travelers}
- Total budget: $${tripDetails.budget} USD

Destination context:
- Best areas to stay: ${research.bestAreas?.join(', ') || 'city center'}
- Local tips: ${research.localTips?.slice(0, 2).join('; ') || ''}

Search for current car rental prices and advise on whether renting is
practical for this destination. Return the structured JSON.`;

  const messages = [{ role: 'user', content: userMessage }];
  let response;

  // [AGENT LOOP] Same pattern as flightsAgent — read the comments there
  // for a detailed walkthrough of why this loop works this way.
  while (true) {
    console.log(`[carRentalAgent] Calling Claude (message count: ${messages.length})`);

    response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages,
      tools: [tavilySearchTool],
    });

    console.log(`[carRentalAgent] stop_reason: ${response.stop_reason}`);
    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      console.log(`[carRentalAgent] Search complete.`);
      break;
    }

    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');

      const toolResults = await Promise.all(
        toolUseBlocks.map(async (toolUse) => {
          console.log(`[carRentalAgent] Tool call: ${toolUse.name}("${toolUse.input.query}")`);
          let result;
          try {
            if (toolUse.name === 'tavilySearch') {
              const searchResults = await tavilySearch(toolUse.input.query);
              result = JSON.stringify(searchResults, null, 2);
            } else {
              result = `Unknown tool: ${toolUse.name}`;
            }
          } catch (error) {
            result = `Tool error: ${error.message}`;
          }
          return { type: 'tool_result', tool_use_id: toolUse.id, content: result };
        })
      );

      messages.push({ role: 'user', content: toolResults });
    }
  }

  // ── Parse and return ─────────────────────────────────────────
  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock) throw new Error('carRentalAgent: No text in final response');

  try {
    return JSON.parse(textBlock.text);
  } catch {
    const jsonMatch = textBlock.text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) return JSON.parse(jsonMatch[1]);
    throw new Error(`carRentalAgent: Could not parse JSON: ${textBlock.text.substring(0, 200)}`);
  }
}
