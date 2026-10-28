/**
 * GET /.netlify/functions/dog-image?url=https://images.dog.ceo/breeds/<breed>/<file>.jpg
 *
 * Streams a single dog photo back to the browser so the page can hand a real File to the
 * Web Share API. The URL is never passed straight to fetch: only https on images.dog.ceo,
 * only /breeds/... image paths, no redirects, a hard timeout and a streaming size cap.
 *
 * No dependencies: Node's global fetch + Buffer only.
 */

"use strict";

const ALLOWED_HOST = "images.dog.ceo";
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 6 * 1024 * 1024;
const TIMEOUT_MS = 8000;
const PATH_PATTERN = /^\/breeds\/[a-z0-9-]+\/[A-Za-z0-9._-]+\.(jpe?g|png|webp)$/i;

function fail(statusCode, message) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    },
    body: JSON.stringify({ error: message })
  };
}

/** Only these URLs may be proxied; everything else is a 400. */
function parseTarget(raw) {
  let target;
  try {
    target = new URL(raw);
  } catch (error) {
    return { error: "Invalid url" };
  }

  if (target.protocol !== "https:") return { error: "Only https images are allowed" };
  if (target.hostname !== ALLOWED_HOST) return { error: "Host not allowed" };
  if (target.port && target.port !== "443") return { error: "Port not allowed" };
  if (target.username || target.password) return { error: "Credentials are not allowed" };
  if (!PATH_PATTERN.test(target.pathname)) return { error: "Not a dog photo path" };

  return { url: target };
}

exports.handler = async function handler(event) {
  const method = (event && event.httpMethod) || "GET";
  if (method !== "GET" && method !== "HEAD") {
    return {
      ...fail(405, "Method not allowed"),
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        allow: "GET, HEAD"
      }
    };
  }

  const raw = event.queryStringParameters && event.queryStringParameters.url;
  if (!raw) return fail(400, "Missing url parameter");

  const parsed = parseTarget(raw);
  if (parsed.error) return fail(400, parsed.error);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(parsed.url.toString(), {
      method: "GET",
      // A redirect to anywhere else would defeat the host check above.
      redirect: "error",
      signal: controller.signal,
      headers: { accept: ALLOWED_TYPES.join(",") }
    });

    if (!upstream.ok) {
      return fail(upstream.status === 404 ? 404 : 502, "Upstream responded " + upstream.status);
    }

    const contentType = (upstream.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (ALLOWED_TYPES.indexOf(contentType) === -1) {
      return fail(415, "Unsupported content type");
    }

    // Trust but verify: the header can lie, so the stream is capped too.
    const declared = Number(upstream.headers.get("content-length") || 0);
    if (declared > MAX_BYTES) return fail(413, "Image too large");

    const chunks = [];
    let total = 0;

    if (upstream.body && typeof upstream.body[Symbol.asyncIterator] === "function") {
      for await (const chunk of upstream.body) {
        total += chunk.length;
        if (total > MAX_BYTES) {
          controller.abort();
          return fail(413, "Image too large");
        }
        chunks.push(chunk);
      }
    } else {
      const buffer = Buffer.from(await upstream.arrayBuffer());
      total = buffer.length;
      if (total > MAX_BYTES) return fail(413, "Image too large");
      chunks.push(buffer);
    }

    if (!total) return fail(502, "Empty image");

    return {
      statusCode: 200,
      headers: {
        "content-type": contentType,
        "content-length": String(total),
        // The photo behind a URL never changes, so the CDN may keep it.
        "cache-control": "public, max-age=86400, immutable",
        "x-content-type-options": "nosniff",
        "content-disposition": 'inline; filename="dog.' + contentType.split("/")[1] + '"'
      },
      body: Buffer.concat(chunks).toString("base64"),
      isBase64Encoded: true
    };
  } catch (error) {
    if (error && (error.name === "AbortError" || error.code === "ABORT_ERR")) {
      return fail(504, "Upstream timed out");
    }
    // fetch refuses redirects with a TypeError; both cases are a bad upstream.
    return fail(502, "Upstream request failed");
  } finally {
    clearTimeout(timer);
  }
};
