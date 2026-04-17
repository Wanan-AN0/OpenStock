/**
 * better-auth lazy wrapper — build-safe.
 *
 * During `next build` there is no MongoDB so `getAuth()` returns null.
 * We export a stub so pages that import `auth` can still compile.
 * At runtime the real auth is loaded lazily on each API call.
 */

import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { connectToDatabase } from "@/database/mongoose";
import { nextCookies } from "better-auth/next-js";

// ── singleton ─────────────────────────────────────────────────────────────────

let _instance: ReturnType<typeof betterAuth> | null = null;

export const getAuth = async (): Promise<ReturnType<typeof betterAuth> | null> => {
  if (_instance) return _instance;

  let mongoose: Awaited<ReturnType<typeof connectToDatabase>>;
  try {
    mongoose = await connectToDatabase();
  } catch (err) {
    console.warn("[auth] DB connect failed:", (err as Error).message);
    return null;
  }
  if (!mongoose) return null;

  const db = mongoose.connection;
  if (!db) throw new Error("MongoDB connection not found!");

  _instance = betterAuth({
    database: mongodbAdapter(db as any),
    secret: process.env.BETTER_AUTH_SECRET ?? "dev-secret",
    baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    emailAndPassword: {
      enabled: true,
      disableSignUp: false,
      requireEmailVerification: false,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
    },
    plugins: [nextCookies()],
  });

  return _instance;
};

// ── build-safe stub (replaces real auth during `next build`) ──────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stub: any = {
  api: {
    getSession: async () => null,
    signIn: async () => { throw new Error("auth unavailable during build"); },
    signOut: async () => null,
    listDatabases: async () => null,
  },
};

// Pre-init — on server, try to load real auth immediately
// (silently fails during build when DB is absent)
if (typeof window === "undefined") {
  getAuth()
    .then((a) => { if (a) Object.assign(stub, a); })
    .catch(() => {/* build-time — expected */});
}

export const auth = stub;
