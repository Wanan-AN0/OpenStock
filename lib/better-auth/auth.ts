import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { connectToDatabase } from "@/database/mongoose";
import { nextCookies } from "better-auth/next-js";

let authInstance: ReturnType<typeof betterAuth> | null = null;

export const getAuth = async (): Promise<ReturnType<typeof betterAuth> | null> => {
  if (authInstance) return authInstance;

  // Gracefully skip DB connection during Next.js build (no MongoDB available)
  let mongoose: Awaited<ReturnType<typeof connectToDatabase>>;
  try {
    mongoose = await connectToDatabase();
  } catch (err) {
    console.warn("[auth] Could not connect to MongoDB during build — skipping auth:", (err as Error).message);
    return null;
  }

  if (!mongoose) return null;

  const db = mongoose.connection;
  if (!db) throw new Error("MongoDB connection not found!");

  authInstance = betterAuth({
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

  return authInstance;
};

// Module-level auth init wrapped in try-catch so next build doesn't crash
// when MongoDB is unavailable (e.g. during Docker image build)
let _auth: ReturnType<typeof betterAuth> | null = null;
getAuth().then((a) => { _auth = a; }).catch((e) => {
  console.warn("[auth] Lazy init failed:", (e as Error).message);
});

export const auth = new Proxy({} as ReturnType<typeof betterAuth>, {
  get(_target, prop, receiver) {
    // Auth is null during build — all calls gracefully return null
    if (!_auth) {
      if (prop === "api") return auth.api;
      return null as any;
    }
    const val = (_auth as any)[prop];
    return typeof val === "function" ? val.bind(_auth) : val;
  },
  has(_target, prop) {
    if (!_auth) return prop === "api";
    return prop in _auth;
  },
});

// Lazy API proxy so pages can call auth.api.getSession() without await
auth.api = new Proxy({}, {
  get(_target, prop) {
    if (prop === "getSession") {
      return async (opts: Parameters<NonNullable<ReturnType<typeof betterAuth>>["api"]["getSession"]>[0]) => {
        const a = await getAuth();
        if (!a) return null;
        return a.api.getSession(opts);
      };
    }
    if (prop === "signIn" || prop === "signOut" || prop === "listDatabases") {
      return async (...args: any[]) => {
        const a = await getAuth();
        if (!a) throw new Error("auth not available");
        return (a.api as any)[prop](...args);
      };
    }
    return async (..._args: any[]) => { /* noop during build */ };
  },
});
