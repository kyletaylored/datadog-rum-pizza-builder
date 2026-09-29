import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Minimal .env loader (no dependency) — never commit the real .env.
function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv(path.join(__dirname, "..", ".env"));

const {
  DD_API_KEY,
  DD_OTLP_TRACES_ENDPOINT,
  DD_OTLP_LOGS_ENDPOINT,
  PROXY_PORT = "8791",
} = process.env;

if (!DD_API_KEY) {
  console.error(
    "Missing DD_API_KEY. Copy .env.example to .env and fill it in (never commit .env)."
  );
  process.exit(1);
}

// Pure passthrough: forwards the request body untouched to Datadog's OTLP
// intake, injecting dd-api-key server-side. Never transforms the payload —
// the RUM-required fields (session.id, datadog.application.id, etc.) travel
// exactly as the page set them.
const ROUTES = {
  "/v1/traces": DD_OTLP_TRACES_ENDPOINT,
  "/v1/logs": DD_OTLP_LOGS_ENDPOINT,
};

function withCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

const server = createServer(async (req, res) => {
  withCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const target = ROUTES[req.url];
  if (req.method !== "POST" || !target) {
    res.writeHead(404).end("not found");
    return;
  }

  if (!target.startsWith("http")) {
    res.writeHead(500).end(
      `${req.url} has no configured upstream endpoint — set the matching DD_OTLP_*_ENDPOINT in .env`
    );
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  try {
    const upstream = await fetch(target, {
      method: "POST",
      headers: {
        "content-type": req.headers["content-type"] ?? "application/x-protobuf",
        "dd-api-key": DD_API_KEY,
      },
      body,
    });
    const upstreamBody = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
    });
    res.end(upstreamBody);
  } catch (err) {
    console.error("proxy forward failed:", err);
    res.writeHead(502).end("upstream request failed");
  }
});

server.listen(Number(PROXY_PORT), () => {
  console.log(`otel-rum-lab proxy listening on http://localhost:${PROXY_PORT}`);
  console.log(`  POST /v1/traces -> ${DD_OTLP_TRACES_ENDPOINT || "(unset)"}`);
  console.log(`  POST /v1/logs   -> ${DD_OTLP_LOGS_ENDPOINT || "(unset)"}`);
});
