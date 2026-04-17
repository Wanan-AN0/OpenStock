#!/usr/bin/env node
/**
 * OpenStock Local Deploy Webhook Server
 *
 * Listens for deploy notifications from GitHub Actions
 * and automatically pulls the new Docker image + restarts containers.
 *
 * Usage:
 *   node scripts/deploy-webhook.js [port]   # default port: 3333
 *
 * Required env vars or .env:
 *   GHCR_IMAGE   - full image URL, e.g. ghcr.io/wanan-an0/openstock
 *   DOCKER_COMPOSE_DIR - path to where docker-compose.yml lives
 *
 * Run behind a public tunnel (ngrok/localrun) so GitHub Actions can reach it:
 *   npx localrun scripts/deploy-webhook.js
 *   # or
 *   ngrok http 3333
 */

const http = require("http");
const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

// Load .env from project root
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .forEach((l) => {
      const [k, ...v] = l.split("=");
      if (k && !process.env[k]) process.env[k.trim()] = v.join("=").trim();
    });
}

const PORT = parseInt(process.argv[2] || process.env.WEBHOOK_PORT || "3333");
const IMAGE = process.env.GHCR_IMAGE || "ghcr.io/wanan-an0/openstock";
const COMPOSE_DIR = process.env.DOCKER_COMPOSE_DIR || path.join(__dirname, "..");

// ── helpers ────────────────────────────────────────────────────────────────

function log(msg, type = "INFO") {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] [${type}] ${msg}`);
}

function run(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    log(`RUN: ${cmd}`);
    const child = spawn("sh", ["-c", cmd], {
      cwd: COMPOSE_DIR,
      stdio: "inherit",
      ...opts,
    });
    child.on("close", (code) => {
      if (code === 0) resolve(code);
      else reject(new Error(`Command exited ${code}: ${cmd}`));
    });
    child.on("error", reject);
  });
}

function getCurrentImageTag() {
  try {
    const out = execSync(
      `docker compose -f "${COMPOSE_DIR}/docker-compose.yml" ps --format json 2>/dev/null || docker compose -f "${COMPOSE_DIR}/docker-compose.yml" ps 2>/dev/null`,
      { cwd: COMPOSE_DIR }
    )
      .toString()
      .trim();
    // extract image tag from compose config
    const cfg = execSync(
      `docker compose -f "${COMPOSE_DIR}/docker-compose.yml" config --images 2>/dev/null`,
      { cwd: COMPOSE_DIR }
    )
      .toString()
      .trim()
      .split("\n")[0];
    return cfg || IMAGE;
  } catch {
    return IMAGE;
  }
}

// ── deploy steps ────────────────────────────────────────────────────────────

async function pullNewImage(imageWithTag) {
  log(`Pulling image: ${imageWithTag}`);
  await run(`docker pull "${imageWithTag}"`);
}

async function stopOldContainers() {
  log("Stopping old containers...");
  await run(`docker compose -f "${COMPOSE_DIR}/docker-compose.yml" down`);
}

async function startNewContainers() {
  log("Starting new containers...");
  await run(`docker compose -f "${COMPOSE_DIR}/docker-compose.yml" up -d`);
  log("Waiting for services to be healthy...");
  await new Promise((r) => setTimeout(r, 8000));
  await run(
    `docker compose -f "${COMPOSE_DIR}/docker-compose.yml}" ps 2>/dev/null || docker compose -f "${COMPOSE_DIR}/docker-compose.yml" ps`
  );
}

async function handleDeploy(payload) {
  const { image, tag, branch, commit } = payload;
  log(
    `Deploy received — branch: ${branch}, commit: ${commit?.slice(0, 7)}, tag: ${tag}`
  );
  if (!image || !tag) {
    throw new Error("Missing 'image' or 'tag' in payload");
  }

  await stopOldContainers();
  await pullNewImage(tag);
  await startNewContainers();
  log("✅ Deploy complete!");
}

// ── HTTP server ──────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS preflight
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "POST" && url.pathname === "/deploy") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body);
        await handleDeploy(payload);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, message: "Deploy triggered" }));
      } catch (err) {
        log(`ERROR: ${err.message}`, "ERROR");
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // Health check
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", image: IMAGE }));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  log(`🚀 Webhook server listening on http://localhost:${PORT}`);
  log(`   POST /deploy   → trigger deploy`);
  log(`   GET  /health   → health check`);
  log(`   Image: ${IMAGE}`);
  log(`   Compose dir: ${COMPOSE_DIR}`);
  log("");
  log("⚠️  This port needs to be publicly reachable!");
  log("   Run 'npx localrun ${PORT}' or 'ngrok http ${PORT}' to expose.");
});

process.on("SIGINT", () => {
  log("Shutting down...");
  server.close(() => process.exit(0));
});
