// ============================================================
// tools/tavilySearch.js — Web Search Tool
// ============================================================
// WHAT: A shared function that calls the Tavily search API and returns
//       structured search results (title, content, URL).
//
// WHY A SEPARATE FILE:
//   Four agents need web search: research, flights, carRental, hotels.
//   Defining the search logic ONCE here means:
//   1. One place to update if Tavily changes their API
//   2. One place to add error handling, retries, or logging
//   3. Easy to swap for a different search API later — just change this file
//   This is called the "single responsibility" principle.
//
// PATTERN [TOOL]:
//   In the Claude agent framework, a "tool" is a function that:
//   - Has a defined name (used in the tool definition object)
//   - Takes typed inputs (the search query)
//   - Returns structured outputs (array of results)
//   - Has a side effect (HTTP call to Tavily)
//   The LLM doesn't execute this directly — it says "call tavilySearch with
//   query='weather in Paris'", and YOUR CODE calls this function.
//   The LLM then reads the results and decides what to do next.
//
// HOW DATA FLOWS:
//   agent decides to search → calls tavilySearch(query)
//     → HTTP POST to api.tavily.com
//     → Tavily returns JSON with search results
//     → we extract { title, content, url } from each result
//     → return clean array to the agent
//     → agent reads results and continues reasoning
// ============================================================

import fetch from 'node-fetch';

// [TOOL] The main export — a single async function.
// WHY async: The Tavily API call takes ~1-2 seconds (network I/O).
// async/await lets Node.js handle other work while waiting,
// rather than blocking the entire server.
export async function tavilySearch(query) {
  // Safety check: if no API key is set, fail loudly rather than
  // making a request that will return a 401 error with a cryptic message.
  if (!process.env.TAVILY_API_KEY) {
    throw new Error('TAVILY_API_KEY is not set in environment variables');
  }

  // [TOOL] Make the HTTP POST request to Tavily's search API.
  // WHY POST not GET: Tavily uses POST for search requests because
  // the query parameters are sent in the request body as JSON,
  // not in the URL. This is a common pattern for APIs with complex inputs.
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      // Tell Tavily we're sending JSON
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      // The Tavily API key for authentication
      api_key: process.env.TAVILY_API_KEY,

      // The actual search query (e.g., "weather in Paris in June")
      query: query,

      // max_results: how many results to return.
      // 5 is the sweet spot — enough for the LLM to have good context,
      // not so many that it wastes tokens processing irrelevant results.
      max_results: 5,

      // search_depth: "basic" is faster and cheaper than "advanced".
      // Advanced does deeper crawling but we don't need that here.
      search_depth: 'basic',

      // include_answer: Tavily can synthesize a direct answer.
      // We set false because we want raw results — the LLM is our
      // synthesizer, not Tavily.
      include_answer: false,
    }),
  });

  // [TOOL] Check if the API request itself succeeded (HTTP 200-299).
  // A failed API call (wrong key, rate limit) returns a non-OK status.
  // We throw here so the calling agent catches it and can report the error.
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Tavily API error: ${response.status} — ${errorText}`);
  }

  // Parse the JSON response body into a JavaScript object.
  const data = await response.json();

  // [TOOL] Extract and reshape the results.
  // WHY reshape: Tavily returns many fields per result (score, raw_content,
  // published_date, etc.) The LLM only needs title, content, and url.
  // Passing only what's needed reduces token usage — important at scale.
  //
  // data.results is an array like:
  // [{ title: "...", content: "...", url: "...", score: 0.9, ... }, ...]
  //
  // We map it to a cleaner shape:
  // [{ title: "...", content: "...", url: "..." }, ...]
  const results = (data.results || []).map(result => ({
    title: result.title,
    content: result.content,
    url: result.url,
  }));

  return results;
}

// ============================================================
// [TOOL] The Tool Definition Object
// ============================================================
// WHAT: This is the schema Claude reads to understand how to call this tool.
//       It's separate from the function above — the function is the
//       implementation, this object is the "API contract" Claude reads.
//
// WHY: When you call client.messages.create({ tools: [tavilySearchTool] }),
//      Claude reads this object and learns:
//      - "This tool is named 'tavilySearch'"
//      - "It takes one input: a string called 'query'"
//      - "I should call it when I need to search the web"
//
//      When Claude decides to use the tool, it returns a response like:
//      { type: 'tool_use', name: 'tavilySearch', input: { query: '...' } }
//      Your code then calls the actual tavilySearch() function above.
//
// PATTERN [TOOL]: This is the "tool definition" pattern used by ALL
//      Claude tool-calling code. Every tool needs both:
//      1. A JavaScript function that does the actual work
//      2. A definition object that describes it to Claude
// ============================================================
export const tavilySearchTool = {
  // The name Claude will use when it decides to call this tool.
  // Must match exactly — Claude outputs this string in its response.
  name: 'tavilySearch',

  // A clear description helps Claude decide WHEN to use this tool.
  // Be specific: Claude reads this to understand what the tool does.
  description: 'Search the web for current information. Use this to find ' +
    'travel information, prices, weather, visa requirements, flight options, ' +
    'hotel prices, and car rental availability.',

  // input_schema: defines what inputs the tool accepts.
  // Uses JSON Schema format — the same standard as OpenAPI/Swagger.
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        // A good description here helps Claude write better search queries.
        description: 'The search query to look up. Be specific for better ' +
          'results. Example: "flights from Mumbai to Paris in June 2025 price"',
      },
    },
    // required tells Claude which inputs it MUST provide (vs optional ones)
    required: ['query'],
  },
};
