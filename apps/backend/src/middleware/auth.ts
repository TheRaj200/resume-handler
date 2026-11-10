import type { NextFunction, Request, Response } from "express";
import { authService } from "../services/auth.service";

export function requireAuth(request: Request, response: Response, next: NextFunction): void {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    response.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Bearer token required." } });
    return;
  }

  try {
    request.userId = authService.verifyAccessToken(token);
    next();
  } catch {
    response.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Invalid or expired access token." } });
  }
}
