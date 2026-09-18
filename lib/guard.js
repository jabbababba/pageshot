const BLOCKED_SCHEMES = [
  "chrome:", "chrome-extension:", "chrome-untrusted:", "chrome-search:",
  "devtools:", "view-source:", "about:", "edge:", "file:", "data:",
];

// Chrome blocks debugger attachment on its own store pages.
const BLOCKED_HOSTS = [
  { host: "chromewebstore.google.com" },
  { host: "chrome.google.com", pathPrefix: "/webstore" },
];

const NO = { ok: false, reason: "Chrome doesn't allow capturing this page." };

export function checkUrl(url) {
  if (!url) return NO;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return NO;
  }

  if (BLOCKED_SCHEMES.includes(parsed.protocol)) return NO;
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return NO;

  for (const rule of BLOCKED_HOSTS) {
    if (parsed.hostname !== rule.host) continue;
    if (!rule.pathPrefix || parsed.pathname.startsWith(rule.pathPrefix)) return NO;
  }

  return { ok: true };
}
