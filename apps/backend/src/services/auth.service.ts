import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";
import { env } from "../config/env";
import { User } from "../models/User";

const ACCESS_TTL = "15m" as const;
const REFRESH_TTL = "30d" as const;

function secret(): string {
  if (!env.JWT_SECRET) {
    throw new Error("JWT_SECRET is required for authentication.");
  }
  return env.JWT_SECRET;
}

function signToken(userId: string, expiresIn: SignOptions["expiresIn"]): string {
  return jwt.sign({ type: expiresIn === ACCESS_TTL ? "access" : "refresh" }, secret(), {
    subject: userId,
    expiresIn,
  });
}

function verifyToken(token: string, expectedType: "access" | "refresh"): string {
  const payload = jwt.verify(token, secret());
  if (typeof payload === "string") throw new Error("Invalid token.");
  const typed = payload as JwtPayload & { type?: string };
  if (typed.type !== expectedType || typeof typed.sub !== "string") {
    throw new Error("Invalid token type.");
  }
  return typed.sub;
}

function publicUser(user: { _id: string; email: string }) {
  return { id: user._id, email: user.email };
}

export class AuthService {
  async register(email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();
    if (password.length < 8) throw new Error("Password must be at least 8 characters.");

    const existing = await User.findOne({ email: normalizedEmail }).exec();
    if (existing) throw new Error("An account with this email already exists.");

    const userId = randomUUID();
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ _id: userId, email: normalizedEmail, passwordHash });
    return this.issueSession(user._id, user.email);
  }

  async login(email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail }).exec();
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new Error("Invalid email or password.");
    }
    return this.issueSession(user._id, user.email);
  }

  async refresh(refreshToken: string) {
    const userId = verifyToken(refreshToken, "refresh");
    const user = await User.findById(userId).exec();
    if (!user?.refreshTokenHash || !(await bcrypt.compare(refreshToken, user.refreshTokenHash))) {
      throw new Error("Refresh token expired or revoked.");
    }
    return this.issueSession(user._id, user.email);
  }

  async logout(userId: string): Promise<void> {
    await User.findByIdAndUpdate(userId, { $unset: { refreshTokenHash: 1 } }).exec();
  }

  verifyAccessToken(token: string): string {
    return verifyToken(token, "access");
  }

  private async issueSession(userId: string, email: string) {
    const accessToken = signToken(userId, ACCESS_TTL);
    const refreshToken = signToken(userId, REFRESH_TTL);
    await User.findByIdAndUpdate(userId, {
      refreshTokenHash: await bcrypt.hash(refreshToken, 12),
    }).exec();
    return { user: { id: userId, email }, accessToken, refreshToken };
  }
}

export const authService = new AuthService();
