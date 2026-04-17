import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;

// FIX: Set Google DNS and force IPv4 to avoid querySrv ECONNREFUSED
import dns from 'dns';
try {
    // This is often more effective than setServers for Node 17+
    if (dns.setDefaultResultOrder) {
        dns.setDefaultResultOrder('ipv4first');
    }
    dns.setServers(['8.8.8.8']);
    console.log('MongoDB: Custom DNS settings applied');
} catch (e) {
    console.error('Failed to set custom DNS:', e);
}

declare global {
    var mongooseCache: {
        conn: typeof mongoose | null;
        promise: Promise<typeof mongoose> | null;
    }
}

let cached = global.mongooseCache;

if (!cached) {
    cached = global.mongooseCache = { conn: null, promise: null };
}

export const connectToDatabase = async () => {
    if (!MONGODB_URI) {
        // During `next build` pre-render, skip connection
        if (process.env.NODE_ENV === "production") {
            console.warn("MongoDB: MONGODB_URI not set — skipping connection (build-time?)");
            return null as unknown as typeof mongoose;
        }
        throw new Error("MongoDB URI is missing");
    }

    if (cached.conn) return cached.conn;

    if (!cached.promise) {
        cached.promise = mongoose.connect(MONGODB_URI, { bufferCommands: false, family: 4 });
    }

    try {
        cached.conn = await cached.promise;
    }
    catch (err) {
        cached.promise = null;
        // During `next build`, MongoDB is not available — return null instead of crashing
        console.warn(`[mongoose] Connection failed (build-time?): ${(err as Error).message}`);
        return null as unknown as typeof mongoose;
    }

    console.log(`MongoDB Connected ${MONGODB_URI} in ${process.env.NODE_ENV}`);
    return cached.conn;
}