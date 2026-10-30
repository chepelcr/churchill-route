// A served re-export of React, for the component harnesses.
//
// `page.evaluate(() => import("react"))` does NOT work: Vite rewrites bare
// specifiers only inside the modules it serves, and an inline import from the
// page is not one of them — it reaches the browser as a literal `"react"` and
// fails to resolve. This file IS served, so its own imports are rewritten, and
// the harness imports it by path instead.
//
// It is dev-tooling that lives under `tools/` deliberately: nothing in `src/`
// should exist only for a test, and Vite serves the project root, so a module
// here is reachable at `/tools/harness-react.js` without shipping in the build.
export { createElement, Fragment } from "react";
export { createRoot } from "react-dom/client";
