# Use official Node.js 20 Alpine image as base
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first (layer cache)
COPY package*.json ./

# Install dependencies
RUN npm ci --legacy-peer-deps

# Copy source files
COPY . .

# ── Build args (injected by GitHub Actions or docker build --build-arg) ───────
ARG NEXT_PUBLIC_FINNHUB_API_KEY
ARG NEXT_PUBLIC_BASE_PATH=""
ENV NEXT_PUBLIC_FINNHUB_API_KEY=${NEXT_PUBLIC_FINNHUB_API_KEY}
ENV NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH}

# Build the Next.js application
RUN npm run build

# ── Production image ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Copy built artifacts from builder
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static .next/static
COPY --from=builder /app/public ./public

# Expose the port Next.js runs on
EXPOSE 3000

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
