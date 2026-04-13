import type { Request, Response, NextFunction } from "express";
import { ADMIN_API_SECRET } from "../config.js";

export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  if (!ADMIN_API_SECRET) {
    res.status(503).json({
      error: {
        message: "Admin API is not configured. Set ADMIN_API_SECRET environment variable.",
        type: "configuration_error",
      },
    });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${ADMIN_API_SECRET}`) {
    res.status(401).json({
      error: {
        message: "Invalid admin authorization",
        type: "authentication_error",
      },
    });
    return;
  }

  next();
}
