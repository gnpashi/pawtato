/**
 * Netlify Edge Function: /.netlify/edge-functions/dog-og  (runs on "/")
 *
 * A shared dog link must preview that exact dog in WhatsApp, Telegram, Slack, iMessage.
 * Those crawlers never run JavaScript, so the Open Graph tags have to be in the HTML the
 * server sends. This function takes the normal index.html from context.next(), strips every
 * og:/twitter: tag it already has, and injects tags built from the validated query string.
 *
 * Anything that is not a valid dog share gets the untouched response.
 */

const ALLOWED_HOST = "images.dog.ceo";
const IMAGE_PATH = /^\/breeds\/[a-z0-9-]+\/[A-Za-z0-9._-]+\.(jpe?g|png|webp)$/i;
const MIME_BY_EXT = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cleanText(value, max) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Only real Dog CEO photos pass; everything else means "not a dog share". */
function readDogImage(raw) {
  let target;
  try {
    target = new URL(raw);
  } catch (error) {
    return null;
  }

  if (target.protocol !== "https:") return null;
  if (target.hostname !== ALLOWED_HOST) return null;
  if (target.port && target.port !== "443") return null;
  if (target.username || target.password) return null;
  if (!IMAGE_PATH.test(target.pathname)) return null;

  return target;
}

function metaTags({ title, description, imageUrl, shareUrl, siteOrigin, imageType }) {
  const safeTitle = escapeAttribute(title);
  const safeDescription = escapeAttribute(description);
  const safeImage = escapeAttribute(imageUrl);
  const safeShare = escapeAttribute(shareUrl);

  const tags = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="pawtato">`,
    `<meta property="og:title" content="${safeTitle}">`,
    `<meta property="og:description" content="${safeDescription}">`,
    `<meta property="og:image" content="${safeImage}">`,
    imageType ? `<meta property="og:image:type" content="${escapeAttribute(imageType)}">` : "",
    `<meta property="og:image:secure_url" content="${safeImage}">`,
    `<meta property="og:image:alt" content="${safeDescription}">`,
    `<meta property="og:url" content="${safeShare}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${safeTitle}">`,
    `<meta name="twitter:description" content="${safeDescription}">`,
    `<meta name="twitter:image" content="${safeImage}">`,
    `<meta name="twitter:image:alt" content="${safeDescription}">`,
    `<link rel="canonical" href="${safeShare}">`
  ].filter(Boolean);

  return `<!-- dog share preview -->\n    ${tags.join("\n    ")}\n  `;
}

export default async function dogOg(request, context) {
  const url = new URL(request.url);

  // Only the site root, and only HTML requests: images, JS and /.netlify/* pass straight through.
  if (url.pathname !== "/") return context.next();
  if (request.method !== "GET" && request.method !== "HEAD") return context.next();

  const image = readDogImage(url.searchParams.get("dog"));
  const name = cleanText(url.searchParams.get("name"), 40);
  const breed = cleanText(url.searchParams.get("breed"), 60);
  if (!image || !name || !breed) return context.next();

  const response = await context.next();
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  const html = await response.text();

  const shareUrl =
    url.origin +
    url.pathname +
    "?dog=" + encodeURIComponent(image.toString()) +
    "&name=" + encodeURIComponent(name) +
    "&breed=" + encodeURIComponent(breed);

  const extension = image.pathname.split(".").pop().toLowerCase();
  const tags = metaTags({
    title: `Meet ${name}! \uD83D\uDC36`,
    description: `${name} is a ${breed}. Meet this adorable dog!`,
    imageUrl: image.toString(),
    shareUrl,
    siteOrigin: url.origin,
    imageType: MIME_BY_EXT[extension] || ""
  });

  // No duplicate or conflicting preview tags: the page's own ones go first.
  const withoutOldTags = html.replace(
    /[ \t]*<meta\s+(?:property|name)\s*=\s*"(?:og:[^"]*|twitter:[^"]*)"[^>]*>\s*\n?/gi,
    ""
  );
  const withoutOldCanonical = withoutOldTags.replace(/[ \t]*<link\s+rel="canonical"[^>]*>\s*\n?/gi, "");

  const injected = /<\/head>/i.test(withoutOldCanonical)
    ? withoutOldCanonical.replace(/<\/head>/i, `${tags}</head>`)
    : tags + withoutOldCanonical;

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  // The HTML differs per dog, and crawlers cache aggressively.
  headers.set("cache-control", "public, max-age=0, must-revalidate");
  headers.set("vary", "Accept-Encoding");

  return new Response(injected, { status: response.status, statusText: response.statusText, headers });
}
