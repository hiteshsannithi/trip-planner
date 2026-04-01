// ============================================================
// agents/researchAgent.js — Research Agent (Agent 1 of 8)
// ============================================================
// WHAT: The first agent in the workflow. It researches the destination
//       using web search and returns structured facts that all other
//       agents depend on.
//
// WHY IT RUNS FIRST:
//   Every other agent needs destination context:
//   - flightsAgent needs departure/arrival cities
//   - hotelsAgent needs to know which areas are best
//   - budgetAgent needs to know the local currency
//   - packingAgent needs weather information
//   - itineraryAgent needs to know local attractions
//   No agent can run until this one finishes.
//
// PATTERN [AGENT] + [AGENT LOOP]:
//   This file implements the core agentic pattern:
//   1. Send a message to Claude WITH tools available
//   2. Claude either responds with text OR requests a tool call
//   3. If tool call → execute the tool → send result back to Claude
//   4. Claude reads the result → might search again → might finish
//   5. Loop until Claude says stop_reason === 'end_turn'
//
//   The CRITICAL insight: YOUR while loop controls when to stop.
//   Claude controls WHAT to search and WHEN it has enough info.
//   This division of control is what makes it "agentic."
//
// HOW DATA FLOWS:
//   tripDetails (from workflow) →
//     [build messages] →
//     Claude reads them, decides to search →
//     [tool call] tavilySearch("weather in Paris in June") →
//     Claude reads results, decides to search again →
//     [tool call] tavilySearch("visa requirements Paris for Indians") →
//     Claude has enough, returns structured JSON →
//   output: { weather, bestAreas, visaInfo, localTips, currency }
//     → used by ALL other agents
//
// MODEL CHOICE: claude-haiku-4-5
//   WHY: Haiku is fast (1-2s) and cheap (~$0.00025/1K tokens).
//   Research is a well-defined task — it doesn't need Sonnet's
//   deeper reasoning. Save the expensive model for the orchestrator
//   which must synthesize everything coherently.
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import { tavilySearch, tavilySearchTool } from '../tools/tavilySearch.js';

// [AGENT] Initialize the Anthropic client.
// WHY: The client handles authentication (reads ANTHROPIC_API_KEY from
//      process.env automatically), connection pooling, and retries.
//      We create ONE client per agent file — it's lightweight and
//      stateless, so creating it at module level is fine.
const client = new Anthropic();

// [AGENT] The system prompt defines this agent's ROLE and BEHAVIOR.
// WHY A SYSTEM PROMPT PER AGENT:
//   Each agent is a specialist. By giving each one a focused system prompt,
//   you get better results than one generic prompt trying to do everything.
//   The system prompt tells Claude:
//   1. What role it's playing ("you are a travel research specialist")
//   2. What to focus on (weather, visa, areas, tips, currency)
//   3. What format to return (JSON — IMPORTANT for parsing later)
//   4. How many times to search (2-3 searches)
//
// The instruction to return JSON is critical: it allows the workflow
// in plan.js to parse and pass this agent's output to other agents
// programmatically. Without this, we'd get freeform text we can't use.
const SYSTEM_PROMPT = `You are a travel research specialist with deep knowledge
of destinations worldwide. Your job is to research the destination and provide
accurate, practical information for travelers.

You have access to a web search tool. Use it 2-3 times to gather:
1. Current weather and best time to visit
2. Visa requirements (especially for Indian passport holders)
3. Best areas to stay and must-see attractions
4. Local currency, typical costs, and practical tips

After searching, respond with ONLY a JSON object in this exact format:
{
  "weather": "description of weather during travel dates, temperature range, what to expect",
  "bestAreas": ["area 1 with why", "area 2 with why", "area 3 with why"],
  "visaInfo": "visa requirements and process for Indian travelers",
  "localTips": ["tip 1", "tip 2", "tip 3", "tip 4", "tip 5"],
  "currency": "local currency name, exchange rate to USD, tipping culture",
  "highlights": ["top attraction 1", "top attraction 2", "top attraction 3", "top attraction 4"]
}

Do not include any text before or after the JSON. Return only the JSON object.`;

// ============================================================
// [AGENT] The main exported function
// ============================================================
// INPUT:  tripDetails — the form data from the user
//   {
//     destination: "Paris, France",
//     departureCity: "Mumbai",
//     startDate: "2025-06-15",
//     endDate: "2025-06-22",
//     travelers: 2,
//     budget: 3000,
//     interests: "art, food, history"
//   }
//
// OUTPUT: Parsed JSON object with research results
//   {
//     weather: "...",
//     bestAreas: [...],
//     visaInfo: "...",
//     localTips: [...],
//     currency: "...",
//     highlights: [...]
//   }
// ============================================================
export async function researchAgent(tripDetails) {
  console.log(`\n[researchAgent] Starting research for: ${tripDetails.destination}`);

  // [AGENT] Build the initial user message.
  // WHY: Claude needs the trip context to write good search queries.
  // We format it clearly so Claude can extract the key details easily.
  // Note: this is the USER message. The SYSTEM message (above) tells
  // Claude its role; the USER message tells it the specific task.
  const userMessage = `Please research this trip:
- Destination: ${tripDetails.destination}
- Departure city: ${tripDetails.departureCity}
- Travel dates: ${tripDetails.startDate} to ${tripDetails.endDate}
- Number of travelers: ${tripDetails.travelers}
- Budget: $${tripDetails.budget} USD total
- Interests: ${tripDetails.interests}

Search for current weather, visa info for Indian travelers, best areas to stay,
and practical local tips. Then return the structured JSON.`;

  // [AGENT LOOP] The messages array is the conversation history.
  // WHY AN ARRAY: The Claude API is stateless — it doesn't remember
  // previous messages. Every API call must include the FULL conversation
  // history so Claude has context. We start with the user's message and
  // add to it with each round of the agent loop.
  const messages = [
    { role: 'user', content: userMessage }
  ];

  // [AGENT LOOP] This is the heart of the agentic pattern.
  // The loop runs until Claude says it's done (stop_reason === 'end_turn').
  // In a typical run, this loops 3-4 times:
  //   Iteration 1: Claude searches for weather
  //   Iteration 2: Claude searches for visa info
  //   Iteration 3: Claude searches for best areas
  //   Iteration 4: Claude has enough info, returns final JSON
  //
  // WHY A WHILE LOOP instead of a fixed number of iterations:
  //   We don't know in advance how many times Claude will search.
  //   For a simple destination it might search twice. For a complex
  //   multi-city trip it might search four times. The while loop
  //   lets Claude decide when it has enough information.
  let response;

  while (true) {
    // [AGENT] Call the Claude API.
    // WHY these specific parameters:
    //   model: claude-haiku-4-5 — fast and cheap for research tasks
    //   max_tokens: 4096 — enough for 2-3 tool calls + final JSON
    //   system: the role/behavior instructions
    //   messages: the full conversation so far (Claude needs all context)
    //   tools: the list of tools Claude can call. Without this array,
    //          Claude cannot call tavilySearch — it wouldn't know it exists.
    console.log(`[researchAgent] Calling Claude (message count: ${messages.length})`);

    response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: messages,

      // [TOOL] Pass the tool definition so Claude knows it can search.
      // This array tells Claude: "you have access to tavilySearch tool.
      // Here's its name, description, and what inputs it takes."
      // Claude reads this and decides on its own when to use it.
      tools: [tavilySearchTool],
    });

    console.log(`[researchAgent] Claude responded with stop_reason: ${response.stop_reason}`);

    // [AGENT LOOP] Add Claude's response to the conversation history.
    // WHY: On the next iteration, Claude needs to "remember" what it
    // already searched and what results it got. We do this by including
    // its previous responses in the messages array.
    messages.push({
      role: 'assistant',
      content: response.content,
    });

    // [AGENT LOOP] Check the stop_reason to decide what to do next.
    //
    // stop_reason === 'end_turn':
    //   Claude has finished. It's not calling any more tools.
    //   Its final response should contain the JSON we want.
    //   → break out of the loop and parse the result.
    //
    // stop_reason === 'tool_use':
    //   Claude wants to call one or more tools.
    //   → find the tool_use blocks, execute them, send results back.
    //   → loop continues.
    //
    // stop_reason === 'max_tokens':
    //   Claude hit the token limit before finishing.
    //   → we break and try to parse whatever it returned.
    //   In practice, 4096 tokens is enough for this agent.
    if (response.stop_reason === 'end_turn') {
      // Claude is done — exit the loop and process the final response
      console.log(`[researchAgent] Research complete.`);
      break;
    }

    // [AGENT LOOP] Handle tool calls.
    // WHY: When stop_reason === 'tool_use', Claude's content array contains
    // one or more blocks with type === 'tool_use'. Each block has:
    //   { type: 'tool_use', id: 'toolu_...', name: 'tavilySearch', input: { query: '...' } }
    //
    // We need to:
    // 1. Find all tool_use blocks in the response
    // 2. Execute each tool (call the actual function)
    // 3. Collect the results
    // 4. Add them to messages as a 'tool_result' block
    // 5. Let the loop iterate — Claude will read the results
    if (response.stop_reason === 'tool_use') {
      // [TOOL] Find all tool_use blocks in Claude's response content.
      // Claude's content is an array that might contain:
      //   - { type: 'text', text: 'Let me search for...' }     (Claude's thinking)
      //   - { type: 'tool_use', name: 'tavilySearch', ... }    (the tool call)
      const toolUseBlocks = response.content.filter(block => block.type === 'tool_use');

      // [TOOL] Execute all tool calls and collect results.
      // WHY Promise.all here: If Claude calls multiple tools in one response,
      // we can run them in parallel. In practice, Claude usually calls one
      // tool at a time, but Promise.all handles both cases correctly.
      const toolResults = await Promise.all(
        toolUseBlocks.map(async (toolUse) => {
          console.log(`[researchAgent] Tool call: ${toolUse.name}("${toolUse.input.query}")`);

          // [TOOL] Execute the actual tool function.
          // WHY the switch statement: In a multi-tool agent you'd have
          // multiple tools (tavilySearch, getWeather, getCurrencyRate, etc.)
          // The switch dispatches to the right function.
          // For researchAgent we only have one tool, but the pattern is correct.
          let result;
          try {
            if (toolUse.name === 'tavilySearch') {
              // Call the actual tavilySearch function we imported above
              const searchResults = await tavilySearch(toolUse.input.query);
              // Convert results to a string Claude can read.
              // WHY JSON.stringify: Claude reads text, not JavaScript objects.
              result = JSON.stringify(searchResults, null, 2);
              console.log(`[researchAgent] Got ${searchResults.length} search results`);
            } else {
              result = `Unknown tool: ${toolUse.name}`;
            }
          } catch (error) {
            // If the tool fails, tell Claude so it can handle the error gracefully
            result = `Tool error: ${error.message}`;
            console.error(`[researchAgent] Tool error:`, error.message);
          }

          // [TOOL] Return the result in the format Claude's API expects.
          // The 'tool_result' type is how you send tool output back to Claude.
          // tool_use_id MUST match the id from the tool_use block — Claude
          // uses this to match results to the specific tool call it made.
          return {
            type: 'tool_result',
            tool_use_id: toolUse.id,  // CRITICAL: must match the tool_use block id
            content: result,
          };
        })
      );

      // [AGENT LOOP] Add tool results to the conversation as a 'user' message.
      // WHY 'user' role: The API convention is that tool results are sent as
      // user messages (because you, the developer, are "telling" Claude the results).
      // Claude will read these results on the next iteration and decide
      // whether to search again or compile the final answer.
      messages.push({
        role: 'user',
        content: toolResults,
      });

      // The while(true) loop continues — Claude gets another chance to respond
    }
  }

  // ── Parse the final response ────────────────────────────────
  // [AGENT] Extract the text from Claude's final response.
  // Claude's content is an array. We find the text block (not tool_use blocks).
  // WHY find() not content[0]: Claude's response might have a text block AND
  // a tool_use block. We specifically want the text block.
  const textBlock = response.content.find(block => block.type === 'text');

  if (!textBlock) {
    throw new Error('researchAgent: Claude returned no text in final response');
  }

  // [AGENT] Parse the JSON that Claude returned.
  // WHY try/catch: Claude USUALLY returns valid JSON when instructed, but
  // sometimes wraps it in markdown fences (```json ... ```).
  // We handle both cases.
  try {
    // First attempt: direct JSON parse (the happy path)
    return JSON.parse(textBlock.text);
  } catch {
    // Fallback: Claude might have wrapped the JSON in markdown code fences.
    // Extract the JSON from between ```json and ```
    const jsonMatch = textBlock.text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
    }
    // If we still can't parse it, throw with the raw text for debugging
    throw new Error(`researchAgent: Could not parse JSON from response: ${textBlock.text.substring(0, 200)}`);
  }
}
