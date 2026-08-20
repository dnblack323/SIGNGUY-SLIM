import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import bcrypt from "bcryptjs";

const SESSION_DAYS = 14;

export async function hashPassword(password) {
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    throw new Error("password_length");
  }
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password, hash) {
  if (!password || !hash) return false;
  return bcrypt.compare(password, hash);
}

export function newSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function sessionExpiry(now = new Date()) {
  return new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}
