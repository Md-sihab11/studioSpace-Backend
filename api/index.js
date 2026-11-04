import { app } from "../index.js";

/**
 * Vercel serverless entry point. `index.js` only calls app.listen() when it is
 * not running on Vercel, so the Express app can be used as the request handler.
 */
export default app;
