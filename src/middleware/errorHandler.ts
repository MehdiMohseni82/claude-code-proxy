import type { Request, Response, NextFunction } from "express";

export function errorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error("Unhandled error:", err);

  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: {
      message: err.message || "Internal server error",
      type: status >= 500 ? "server_error" : "invalid_request_error",
    },
  });
}
