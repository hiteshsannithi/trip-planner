// ============================================================
// loadEnv.js — Environment Variable Loader
// ============================================================
// WHAT: Loads .env file into process.env with override:true.
//
// WHY THIS FILE EXISTS (the ES module import hoisting problem):
//   In ES modules, ALL import statements are hoisted and executed
//   BEFORE the module body runs. This means in index.js:
//
//     import dotenv from 'dotenv';
//     dotenv.config();           ← this is the MODULE BODY
//     import planRouter from './routes/plan.js';  ← this is hoisted
//
//   Execution order is actually:
//     1. dotenv is loaded (module only, config() not called yet)
//     2. planRouter → all agents loaded → new Anthropic() called ← KEY IS MISSING
//     3. index.js body runs: dotenv.config() ← TOO LATE
//
//   By putting dotenv.config() in a SEPARATE MODULE that is imported first,
//   it runs before any other module's body:
//     1. loadEnv.js runs: dotenv.config({ override: true }) ← KEY IS SET
//     2. agents loaded → new Anthropic() ← KEY IS AVAILABLE ✓
//
// WHY override:true:
//   dotenv by default skips env vars already set in the shell.
//   If ANTHROPIC_API_KEY='' exists in the shell (even as empty string),
//   dotenv leaves it empty. override:true forces .env values to always win.
// ============================================================

import dotenv from 'dotenv';
dotenv.config({ override: true });
