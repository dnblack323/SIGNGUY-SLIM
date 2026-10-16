import { randomBytes, timingSafeEqual, createHash, createHmac } from "node:crypto";
import bcrypt from "bcryptjs";

const SESSION_DAYS = 14;
const PLATFORM_SESSION_DAYS = 30;

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

function kioskPinMaterial(tenantId, pin) {
  return `signguy-slim:kiosk-pin:v1:${tenantId}:${pin}`;
}

export function isBcryptHash(hash) {
  return typeof hash === "string" && /^\$2[aby]\$\d{2}\$/.test(hash);
}

export function hashKioskPin(tenantId, pin) {
  return bcrypt.hashSync(kioskPinMaterial(tenantId, pin), 12);
}

export function verifyKioskPin(tenantId, pin, hash) {
  if (!tenantId || !pin || !isBcryptHash(hash)) return false;
  return bcrypt.compareSync(kioskPinMaterial(tenantId, pin), hash);
}

export function newSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function csrfTokenForSession(session) {
  if (!session?.id || !session?.token_hash || !session?.expires_at) return "";
  return createHmac("sha256", session.token_hash)
    .update(`${session.id}:${session.expires_at}`, "utf8")
    .digest("base64url");
}

export function sessionExpiry(now = new Date()) {
  return new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function platformSessionExpiry(now = new Date()) {
  return new Date(now.getTime() + PLATFORM_SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}
