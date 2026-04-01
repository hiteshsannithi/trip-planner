// ============================================================
// src/main.jsx — React Entry Point
// ============================================================
// WHAT: The entry point for the React app. Mounts the <App /> component
//       into the <div id="root"> in index.html.
//
// WHY THIS FILE:
//   index.html has a <script src="/src/main.jsx">. When the browser
//   loads the page, Vite serves this file. It's the bridge between
//   the plain HTML shell and the React component tree.
//
//   React.StrictMode: Wraps App in strict mode — highlights potential
//   problems by intentionally double-invoking functions in development.
//   It has no effect in production builds.
// ============================================================

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './App.css';

// Mount React into the #root div from index.html
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
