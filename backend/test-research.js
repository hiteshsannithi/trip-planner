// ============================================================
// test-research.js — Standalone Agent Test Script
// ============================================================
// WHAT: Runs researchAgent directly with hardcoded trip data.
//       No Express server. No frontend. Just the agent + the tool.
//
// WHY: Testing agents in isolation is the fastest way to:
//   1. Verify your API keys work
//   2. See the agent loop in action (tool calls printed to console)
//   3. Inspect the JSON output before connecting it to other agents
//   4. Debug issues without noise from the rest of the system
//
// HOW TO RUN:
//   cd backend
//   node test-research.js
//
// WHAT YOU SHOULD SEE:
//   [researchAgent] Starting research for: Paris, France
//   [researchAgent] Calling Claude (message count: 1)
//   [researchAgent] Claude responded with stop_reason: tool_use
//   [researchAgent] Tool call: tavilySearch("weather in Paris France in June 2025")
//   [researchAgent] Got 5 search results
//   [researchAgent] Calling Claude (message count: 3)
//   [researchAgent] Claude responded with stop_reason: tool_use
//   [researchAgent] Tool call: tavilySearch("visa requirements France Indian passport")
//   ... (1-2 more searches)
//   [researchAgent] Research complete.
//   ✅ Research Result:
//   { weather: '...', bestAreas: [...], visaInfo: '...', ... }
// ============================================================

// [TOOL] Load .env file — MUST be first, before importing anything that
// reads process.env. Dotenv reads the .env file and populates process.env
// with ANTHROPIC_API_KEY, TAVILY_API_KEY, etc.
import 'dotenv/config';

// Import only the agent we want to test — no Express, no routing
import { researchAgent } from './agents/researchAgent.js';

// ── Hardcoded test data ──────────────────────────────────────
// WHY hardcode: We want a predictable input we can run repeatedly.
// Change this to any destination to test different scenarios.
const testTrip = {
  destination: 'Paris, France',
  departureCity: 'Mumbai, India',
  startDate: '2025-06-15',
  endDate: '2025-06-22',
  travelers: 2,
  budget: 3000,
  interests: 'art, museums, fine dining, architecture',
};

// ── Run the agent ────────────────────────────────────────────
// [AGENT] We wrap in an async IIFE (Immediately Invoked Function Expression)
// WHY: Node.js doesn't allow top-level await in all versions/configurations.
// An async function lets us use await. IIFE means it runs immediately.
(async () => {
  console.log('═'.repeat(60));
  console.log('  Trip Planner — Research Agent Test');
  console.log('═'.repeat(60));
  console.log('\nTest trip:', testTrip);
  console.log('\nStarting agent...\n');

  try {
    // [AGENT] Call the research agent — this triggers the agent loop
    // Watch the console: you'll see each Claude call and each tool call
    // printed as the loop runs. This is the agent loop in action.
    const result = await researchAgent(testTrip);

    // Print the structured output
    console.log('\n' + '═'.repeat(60));
    console.log('  ✅ Research Result');
    console.log('═'.repeat(60));

    // Pretty-print the JSON so it's readable
    console.log(JSON.stringify(result, null, 2));

    // Validate that the expected fields are present
    console.log('\n' + '─'.repeat(40));
    console.log('Field validation:');
    const expectedFields = ['weather', 'bestAreas', 'visaInfo', 'localTips', 'currency', 'highlights'];
    for (const field of expectedFields) {
      const present = field in result;
      console.log(`  ${present ? '✅' : '❌'} ${field}`);
    }
    console.log('─'.repeat(40));

  } catch (error) {
    // Detailed error output so you can diagnose what went wrong
    console.error('\n❌ Test failed:', error.message);

    // Common failure modes and how to fix them:
    if (error.message.includes('ANTHROPIC_API_KEY')) {
      console.error('\n→ Fix: Add ANTHROPIC_API_KEY to your .env file');
      console.error('  Run: cp .env.example .env  then fill in your key');
    } else if (error.message.includes('TAVILY_API_KEY')) {
      console.error('\n→ Fix: Add TAVILY_API_KEY to your .env file');
      console.error('  Get a free key at: https://tavily.com');
    } else if (error.message.includes('401')) {
      console.error('\n→ Fix: Your API key is invalid. Check it in .env');
    } else {
      console.error('\nFull error:', error);
    }

    process.exit(1);
  }
})();
