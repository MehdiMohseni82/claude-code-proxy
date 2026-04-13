import express from "express";
import proxyRoutes from "./routes/proxy.js";
import anthropicRoutes from "./routes/anthropic.js";
import adminApiRoutes from "./routes/adminApi.js";
import healthRoutes from "./routes/health.js";
import { apiKeyAuth } from "./middleware/apiKeyAuth.js";
import { rateLimitMiddleware } from "./middleware/rateLimiter.js";
import { budgetCheckMiddleware } from "./middleware/budgetCheck.js";
import { errorHandler } from "./middleware/errorHandler.js";

const app = express();
app.use(express.json({ limit: "10mb" }));

// Health check — no auth
app.use(healthRoutes);

// Admin API — protected by admin secret
app.use("/api/admin", adminApiRoutes);

// /v1/* routes — protected by API key auth + budget check + rate limiting
// OpenAI-compatible: GET /v1/models, POST /v1/chat/completions
app.use("/v1", apiKeyAuth, budgetCheckMiddleware, rateLimitMiddleware, proxyRoutes);
// Native Anthropic Messages: POST /v1/messages
app.use("/v1", apiKeyAuth, budgetCheckMiddleware, rateLimitMiddleware, anthropicRoutes);

// Centralized error handler
app.use(errorHandler);

export { app };
