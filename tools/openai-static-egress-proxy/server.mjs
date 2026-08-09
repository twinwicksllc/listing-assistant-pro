import { createServer } from "node:http";

const PORT = Number(process.env.PORT || 8080);
const OPENAI_API_KEY =
  process.env.NEW_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "";
const PROXY_AUTH_TOKEN = process.env.PROXY_AUTH_TOKEN || "";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MAX_BODY_BYTES = 6 * 1024 * 1024;

if (!OPENAI_API_KEY) {
  console.error("Missing NEW_OPENAI_API_KEY/OPENAI_API_KEY env var");
  process.exit(1);
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];

    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("payload_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("invalid_json"));
      }
    });

    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    return json(res, 200, { ok: true });
  }

  if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
    return json(res, 404, { error: "not_found" });
  }

  if (PROXY_AUTH_TOKEN) {
    const provided = req.headers["x-proxy-auth"] || "";
    if (provided !== PROXY_AUTH_TOKEN) {
      return json(res, 401, { error: "unauthorized" });
    }
  }

  let payload;
  try {
    payload = await readBody(req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "bad_request";
    if (code === "payload_too_large") {
      return json(res, 413, { error: code });
    }
    return json(res, 400, { error: code });
  }

  try {
    const upstream = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await upstream.text();
    res.writeHead(upstream.status, {
      "Content-Type":
        upstream.headers.get("content-type") || "application/json",
    });
    res.end(text);
  } catch (err) {
    console.error("Upstream OpenAI request failed:", String(err));
    return json(res, 502, { error: "upstream_failure" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`OpenAI static-egress proxy listening on :${PORT}`);
});
