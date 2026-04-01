// ============================================================
// agents/hotelsAgent.js — Hotels Agent (Agent 4 of 8)
// ============================================================
// WHAT: Searches for hotel options at the destination, organized by area,
//       with price per night, highlights, and ratings.
//
// WHY IT EXISTS:
//   Hotels are the biggest variable in trip budgeting. Knowing which
//   areas have which hotels at which prices helps the user plan both
//   their location and their spending.
//
// PATTERN [AGENT] + [AGENT LOOP]:
//   Same structure as researchAgent, flightsAgent, carRentalAgent.
//   This is the THIRD time you're seeing this loop — by now, the pattern
//   should feel familiar:
//     while(true) → call Claude → if tool_use: run tool → if end_turn: parse
//
// KEY TEACHING POINT — AGENTS USE EACH OTHER'S CONTEXT:
//   Notice the user message includes research.bestAreas.
//   This is how agents in a workflow build on each other.
//   researchAgent found the best neighborhoods first.
//   hotelsAgent now searches SPECIFICALLY in those neighborhoods.
//   Without this context, hotelsAgent would return random hotels.
//   With it, it returns hotels in the areas researchAgent recommended.
//
//   This is the VALUE of running researchAgent first (Step 2 in the workflow).
//   All downstream agents get richer, more targeted results because of it.
//
// HOW DATA FLOWS:
//   tripDetails + research →
//     Claude uses research.bestAreas to form targeted search queries →
//     tavilySearch("hotels in [best area] [destination] price per night") →
//     Claude collects options across areas and price ranges →
//     Returns structured JSON →
//   output: { options, recommendation }
//     → used by budgetAgent (actual hotel prices)
//     → used by orchestrator in final plan
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import { tavilySearch, tavilySearchTool } from '../tools/tavilySearch.js';

const client = new Anthropic();

// [AGENT] System prompt — hotel search specialist role.
// NOTE: We explicitly tell Claude to organize by area, because the frontend
// displays hotels in an area-grouped card. This shows how system prompts
// can be "UI-aware" — formatting output to match how it will be displayed.
const SYSTEM_PROMPT = `You are a hotel recommendation specialist for international travelers.
Your job is to find hotel options at the destination across different areas
and price ranges.

You have access to a web search tool. Use it 1-2 times to search for:
1. Hotels in the recommended areas with prices per night in USD
2. Reviews, ratings, and what makes each area good for tourists

After searching, respond with ONLY a JSON object in this exact format:
{
  "options": [
    {
      "name": "Hotel name",
      "area": "neighborhood or area of the city",
      "pricePerNight": 120,
      "highlights": "2-3 key features e.g. rooftop pool, near metro, free breakfast",
      "rating": "4.2/5 or Good/Excellent based on reviews"
    }
  ],
  "recommendation": "Which hotel or area is best for this traveler's interests and budget, and why"
}

Provide 3-5 options spanning budget, mid-range, and luxury categories.
Prices in USD per night. Focus on areas that are good for tourists.
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
//     options: [{ name, area, pricePerNight, highlights, rating }],
//     recommendation: string
//   }
// ============================================================
export async function hotelsAgent(tripDetails, research) {
  console.log(`\n[hotelsAgent] Searching hotels at: ${tripDetails.destination}`);

  // [AGENT] Calculate number of nights — needed for budget context.
  // WHY: Claude can give better price guidance if it knows how many nights,
  // e.g. "at 7 nights, this hotel would cost $840 total which is 28% of budget"
  const startDate = new Date(tripDetails.startDate);
  const endDate = new Date(tripDetails.endDate);
  const nights = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));

  // [AGENT] User message — includes research context for targeted search.
  // KEY: We pass research.bestAreas so Claude searches IN those specific areas.
  // This is agents-building-on-agents in action.
  const userMessage = `Find hotel options for this trip:
- Destination: ${tripDetails.destination}
- Check-in: ${tripDetails.startDate}
- Check-out: ${tripDetails.endDate} (${nights} nights)
- Number of travelers: ${tripDetails.travelers} (rooms needed: ${Math.ceil(tripDetails.travelers / 2)})
- Total trip budget: $${tripDetails.budget} USD
- Interests: ${tripDetails.interests}

Best areas to search (from destination research):
${research.bestAreas?.map((area, i) => `${i + 1}. ${area}`).join('\n') || 'City center'}

Search for hotels in these specific areas. Return options across budget,
mid-range, and luxury categories. Return the structured JSON.`;

  const messages = [{ role: 'user', content: userMessage }];
  let response;

  // [AGENT LOOP] You know this pattern now. Same loop as the previous three agents.
  // Kept here because each agent is a self-contained file — no shared loop code.
  // That's the right tradeoff: a little repetition for complete self-containment.
  while (true) {
    console.log(`[hotelsAgent] Calling Claude (message count: ${messages.length})`);

    response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages,
      tools: [tavilySearchTool],
    });

    console.log(`[hotelsAgent] stop_reason: ${response.stop_reason}`);
    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      console.log(`[hotelsAgent] Search complete.`);
      break;
    }

    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');

      const toolResults = await Promise.all(
        toolUseBlocks.map(async (toolUse) => {
          console.log(`[hotelsAgent] Tool call: ${toolUse.name}("${toolUse.input.query}")`);
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
  if (!textBlock) throw new Error('hotelsAgent: No text in final response');

  try {
    return JSON.parse(textBlock.text);
  } catch {
    const jsonMatch = textBlock.text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) return JSON.parse(jsonMatch[1]);
    throw new Error(`hotelsAgent: Could not parse JSON: ${textBlock.text.substring(0, 200)}`);
  }
}
