import test from "node:test";
import assert from "node:assert/strict";
import { createDashboardAuth } from "../api/auth.mjs";
const request = (cookie = "") => ({
  headers: { cookie },
  socket: { remoteAddress: "127.0.0.1" },
});
test("password validation is exact", () => {
  const auth = createDashboardAuth({
    password: "correct horse battery staple",
  });
  assert.equal(auth.verifyPassword("correct horse battery staple"), true);
  assert.equal(auth.verifyPassword("correct horse battery staplE"), false);
});
test("issued session authenticates and expires", () => {
  let now = 1_000_000;
  const auth = createDashboardAuth({
    password: "correct horse battery staple",
    ttlSeconds: 300,
    now: () => now,
  });
  const cookie = auth.sessionCookie(request()).split(";")[0];
  assert.equal(auth.isAuthenticated(request(cookie)), true);
  now += 301_000;
  assert.equal(auth.isAuthenticated(request(cookie)), false);
});
test("password rotation invalidates an existing session", () => {
  const oldAuth = createDashboardAuth({
    password: "correct horse battery staple",
  });
  const cookie = oldAuth.sessionCookie(request()).split(";")[0];
  const newAuth = createDashboardAuth({
    password: "another strong shared password",
  });
  assert.equal(newAuth.isAuthenticated(request(cookie)), false);
});
test("short password is rejected at startup", () =>
  assert.throws(
    () => createDashboardAuth({ password: "short" }),
    /at least 12/,
  ));
