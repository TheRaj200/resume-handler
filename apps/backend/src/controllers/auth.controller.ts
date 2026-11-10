import type { Request, Response } from "express";
import { z } from "zod";
import { authService } from "../services/auth.service";

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(200),
});

const refreshSchema = z.object({ refreshToken: z.string().min(20) });

export class AuthController {
  register = async (request: Request, response: Response): Promise<void> => {
    try {
      const input = credentialsSchema.parse(request.body);
      response.status(201).json({ ok: true, data: await authService.register(input.email, input.password) });
    } catch (error) {
      const message = error instanceof z.ZodError ? "Valid email and password (8+ chars) required." : error instanceof Error ? error.message : "Registration failed";
      response.status(message.includes("already exists") ? 409 : 400).json({ ok: false, error: { code: "REGISTER_FAILED", message } });
    }
  };

  login = async (request: Request, response: Response): Promise<void> => {
    try {
      const input = credentialsSchema.parse(request.body);
      response.json({ ok: true, data: await authService.login(input.email, input.password) });
    } catch (error) {
      const message = error instanceof z.ZodError ? "Valid email and password required." : error instanceof Error ? error.message : "Login failed";
      response.status(401).json({ ok: false, error: { code: "LOGIN_FAILED", message } });
    }
  };

  refresh = async (request: Request, response: Response): Promise<void> => {
    try {
      const { refreshToken } = refreshSchema.parse(request.body);
      response.json({ ok: true, data: await authService.refresh(refreshToken) });
    } catch (error) {
      response.status(401).json({ ok: false, error: { code: "REFRESH_FAILED", message: "Invalid or expired refresh token." } });
    }
  };

  logout = async (request: Request, response: Response): Promise<void> => {
    if (request.userId) await authService.logout(request.userId);
    response.status(204).send();
  };
}

export const authController = new AuthController();
