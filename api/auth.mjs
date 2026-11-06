import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "arena_dashboard_session";
const digest = (value) => createHash("sha256").update(value).digest();
const safeEqual = (left, right) => timingSafeEqual(digest(left), digest(right));
const signature = (key, expiresAt) =>
  createHmac("sha256", key).update(String(expiresAt)).digest("base64url");

function cookies(header = "") {
  return new Map(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        return separator === -1
          ? [part, ""]
          : [part.slice(0, separator), part.slice(separator + 1)];
      }),
  );
}

export function createDashboardAuth({
  password,
  ttlSeconds = 12 * 60 * 60,
  now = () => Date.now(),
}) {
  if (!password || password.length < 12)
    throw new Error("DASHBOARD_PASSWORD must contain at least 12 characters.");
  const ttl = Math.min(Math.max(Number(ttlSeconds) || 43_200, 300), 604_800);
  const key = digest(`arena-dashboard-session\0${password}`);
  const secure = (request) =>
    process.env.COOKIE_SECURE === "true" ||
    request.headers["x-forwarded-proto"] === "https";
  const verifyToken = (token) => {
    if (!token) return false;
    const [expiresAtRaw, supplied, extra] = token.split(".");
    if (extra !== undefined || !/^\d+$/.test(expiresAtRaw ?? "")) return false;
    const expiresAt = Number(expiresAtRaw);
    if (
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= Math.floor(now() / 1000)
    )
      return false;
    return safeEqual(supplied ?? "", signature(key, expiresAt));
  };
  return {
    ttlSeconds: ttl,
    verifyPassword: (candidate) => safeEqual(String(candidate ?? ""), password),
    isAuthenticated: (request) =>
      verifyToken(cookies(request.headers.cookie).get(COOKIE_NAME)),
    sessionCookie(request) {
      const expiresAt = Math.floor(now() / 1000) + ttl;
      return [
        `${COOKIE_NAME}=${expiresAt}.${signature(key, expiresAt)}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Strict",
        `Max-Age=${ttl}`,
        ...(secure(request) ? ["Secure"] : []),
      ].join("; ");
    },
    clearCookie(request) {
      return [
        `${COOKIE_NAME}=`,
        "Path=/",
        "HttpOnly",
        "SameSite=Strict",
        "Max-Age=0",
        ...(secure(request) ? ["Secure"] : []),
      ].join("; ");
    },
  };
}
