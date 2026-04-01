// ============================================================
// agents/orchestrator.js — Orchestrator (Final Agent, Agent 8 of 8)
// ============================================================
// WHAT: The final step in the workflow. Receives ALL 7 agent outputs
//       and synthesizes them into one clean, cohesive markdown travel plan.
//       This is the document the user reads at the end.
//
// WHY IT EXISTS:
//   7 agents produce 7 separate outputs. Without an orchestrator,
//   the frontend would have to display raw JSON from each agent with
//   no overall narrative. The orchestrator:
//     - Combines all outputs into a readable document
//     - Ensures information is consistent (e.g. budget matches flight prices)
//     - Notices if something looks off and adjusts the narrative
//     - Creates a polished, flowing plan rather than separate reports
//
// ── THE MOST IMPORTANT ARCHITECTURAL DECISION: MODEL CHOICE ──
//
//   Every other agent uses claude-haiku-4-5.
//   The orchestrator uses claude-sonnet-4-5.
//   WHY THIS DIFFERENCE MATTERS:
//
//   Haiku is excellent at focused, well-defined tasks:
//     ✅ "Search for flights, return this JSON schema"
//     ✅ "Build an itinerary with morning/afternoon/evening structure"
//     ✅ "List what to pack based on this weather"
//
//   Sonnet is better at complex synthesis and reasoning:
//     ✅ Reading 7 different outputs and creating coherent narrative
//     ✅ Noticing "budget estimate says $1600 for flights but flights
//        agent found options starting at $900 — let me use the real number"
//     ✅ Making the final document flow naturally, not feel stitched together
//
//   COST TRADEOFF:
//     Sonnet costs ~5x more than Haiku per token.
//     BUT the orchestrator runs ONCE per trip request.
//     Paying more for the ONE output the user actually reads is worth it.
//     The 7 Haiku agents kept the bulk of the cost low.
//
//   This pattern — cheap models for specialized subtasks, expensive model
//   for final synthesis — is a standard cost optimization in multi-agent
//   systems. Remember it.
//
// PATTERN [AGENT] — single LLM call:
//   No tools. No loop. One call, one response.
//   The orchestrator is a pure SYNTHESIZER — it reasons with what it has.
//   It doesn't search the web; it creates from the research already done.
//
// HOW DATA FLOWS:
//   { tripDetails, research, flights, cars, hotels,
//     itinerary, budget, packing } →
//     [single Sonnet call] →
//     Claude reads all 8 inputs and writes a cohesive travel plan →
//   output: complete markdown travel plan string
//     → sent to frontend as the final "complete" event
//     → this is what the user sees as the full plan
// ============================================================

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

// [AGENT] System prompt — editor/synthesizer role.
// KEY DIFFERENCE from other agents: this prompt is about WRITING QUALITY,
// not about what to search or what format to return.
// We want the final document to feel like a professional travel guide,
// not like a robot assembled 7 JSON blobs.
const SYSTEM_PROMPT = `You are a professional travel plan editor and writer.
You receive reports from 7 specialist travel agents and combine them into
one comprehensive, beautifully formatted travel plan.

Your job:
1. Synthesize all the specialist reports into a coherent narrative
2. Ensure information is consistent (e.g. budget reflects actual prices found)
3. Format as clean, readable markdown with clear sections
4. Write in a warm, helpful tone — like a knowledgeable friend planning the trip
5. Highlight the most important information in each section

Structure the final plan with these sections:
# [Destination] Travel Plan — [Dates]

## Trip Overview
## Flights
## Getting Around (Car Rental / Transport)
## Accommodation
## Day-by-Day Itinerary
## Budget Breakdown
## Packing List
## Important Notes (Visa, Tips, Emergency Info)

Be specific — use actual prices, hotel names, and details from the reports.
If budget is over the user's limit, acknowledge this and emphasize saving tips.`;

// ============================================================
// [AGENT] Exported function — called LAST in routes/plan.js workflow
// ============================================================
// INPUT: An object containing all agent outputs
//   {
//     tripDetails,  — original form data
//     research,     — from researchAgent
//     flights,      — from flightsAgent
//     cars,         — from carRentalAgent
//     hotels,       — from hotelsAgent
//     itinerary,    — from itineraryAgent (markdown string)
//     budget,       — from budgetAgent
//     packing       — from packingAgent
//   }
//
// OUTPUT: markdown string — the complete formatted travel plan
// ============================================================
export async function orchestrator({
  tripDetails,
  research,
  flights,
  cars,
  hotels,
  itinerary,
  budget,
  packing,
}) {
  console.log(`\n[orchestrator] Synthesizing final plan for: ${tripDetails.destination}`);

  // [AGENT] Build a comprehensive user message containing ALL 7 agent outputs.
  // WHY JSON.stringify: Most agent outputs are JavaScript objects.
  // JSON.stringify converts them to readable text Claude can parse.
  // The itinerary is already a string (markdown), so no conversion needed.
  //
  // WHY PUT EVERYTHING IN ONE MESSAGE:
  // Sonnet needs to SEE all the data at once to synthesize it correctly.
  // If we split it across messages, Claude might miss cross-references
  // (e.g. "hotel in Marais" referenced in both hotels AND itinerary).
  const userMessage = `Please create the final travel plan from these specialist reports:

═══ TRIP DETAILS ═══
Destination: ${tripDetails.destination}
Departure: ${tripDetails.departureCity}
Dates: ${tripDetails.startDate} to ${tripDetails.endDate}
Travelers: ${tripDetails.travelers}
Budget: $${tripDetails.budget} USD
Interests: ${tripDetails.interests}

═══ DESTINATION RESEARCH ═══
${JSON.stringify(research, null, 2)}

═══ FLIGHTS REPORT ═══
${JSON.stringify(flights, null, 2)}

═══ CAR RENTAL REPORT ═══
${JSON.stringify(cars, null, 2)}

═══ HOTELS REPORT ═══
${JSON.stringify(hotels, null, 2)}

═══ ITINERARY ═══
${itinerary}

═══ BUDGET BREAKDOWN ═══
${JSON.stringify(budget, null, 2)}

═══ PACKING LIST ═══
${JSON.stringify(packing, null, 2)}

Create the complete, formatted travel plan using all of the above.
Make it specific, practical, and easy to read.`;

  console.log(`[orchestrator] Calling Claude Sonnet (synthesizing ${userMessage.length} characters of agent output)`);

  // [AGENT] Single call with claude-sonnet-4-5.
  // THIS IS THE ONLY PLACE IN THE CODEBASE THAT USES SONNET.
  // All other agents use claude-haiku-4-5.
  // The max_tokens here is 8192 because the final plan can be long —
  // full itinerary + all sections can reach 3000-5000 words.
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',  // [AGENT] Sonnet for synthesis quality
    max_tokens: 8192,            // [AGENT] Large output — full travel plan
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    // No tools — orchestrator is a pure writer, not a searcher
  });

  console.log(`[orchestrator] stop_reason: ${response.stop_reason}`);

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock) throw new Error('orchestrator: No text in final response');

  console.log(`[orchestrator] Final plan generated (${textBlock.text.length} characters)`);

  // [AGENT] Return the markdown string directly.
  // The orchestrator's output is already formatted for display.
  // plan.js sends this as the final SSE event to the frontend.
  return textBlock.text;
}
