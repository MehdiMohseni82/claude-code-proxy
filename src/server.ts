import { PORT } from "./config.js";
// Importing connection module triggers DB init + migrations
import "./db/connection.js";
import { app } from "./app.js";

app.listen(PORT, () => {
  console.log(`Claude Code OpenAI-compatible API server running on port ${PORT}`);
  console.log(`  POST http://localhost:${PORT}/v1/chat/completions`);
  console.log(`  GET  http://localhost:${PORT}/v1/models`);
  console.log(`  GET  http://localhost:${PORT}/health`);
  console.log(`  Admin API at http://localhost:${PORT}/api/admin/*`);
});
