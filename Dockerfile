# ── Builder stage ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Build args — provide dummy values so Next.js SSR pre-render doesn't crash
ARG NEXT_PUBLIC_FINNHUB_API_KEY=demo
ARG BUILD_MONGODB_URI=mongodb://localhost:27017/buildcheck
ENV NEXT_PUBLIC_FINNHUB_API_KEY=${NEXT_PUBLIC_FINNHUB_API_KEY}
ENV MONGODB_URI=${BUILD_MONGODB_URI}

# Install deps (use package-lock.json hash for layer cache)
COPY package*.json ./
RUN npm ci --legacy-peer-deps

# Copy source
COPY . .

# Build
RUN npm run build

# ── Production image ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN apk add --no-cache dumb-init curl

# Only copy built artifacts + runtime deps
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./

# Runtime env vars come from docker-compose — no defaults needed
# MONGODB_URI, BETTER_AUTH_SECRET, NEXT_PUBLIC_FINNHUB_API_KEY, etc.

EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
