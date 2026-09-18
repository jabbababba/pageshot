// German and other common characters that should transliterate rather than
// vanish, since a slug of "gr-e" helps nobody.
const TRANSLITERATE = {
  "ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss",
  "Ä": "ae", "Ö": "oe", "Ü": "ue",
  "æ": "ae", "ø": "oe", "å": "aa", "ñ": "n",
};

export function slugify(title, maxLen = 60) {
  let s = String(title || "");
  s = s.replace(/[äöüßÄÖÜæøåñ]/g, (c) => TRANSLITERATE[c] || c);
  s = s.toLowerCase()
       .normalize("NFKD")
       .replace(/[̀-ͯ]/g, "")   // drop combining accents
       .replace(/[^a-z0-9]+/g, "-")
       .replace(/^-+|-+$/g, "");

  if (s.length <= maxLen) return s;

  // Cut at the last word boundary that fits, rather than mid-word.
  const cut = s.slice(0, maxLen);
  const lastDash = cut.lastIndexOf("-");
  return (lastDash > 0 ? cut.slice(0, lastDash) : cut).replace(/-+$/, "");
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "") || "page";
  } catch {
    return "page";
  }
}

const pad = (n) => String(n).padStart(2, "0");

export function stamp(date) {
  return pad(date.getFullYear() % 100) + pad(date.getMonth() + 1) + pad(date.getDate()) +
         "-" + pad(date.getHours()) + pad(date.getMinutes());
}

// Returns exactly `count` filenames. The part suffix appears only when there
// is more than one file, so the common case stays clean.
export function buildFilenames({ url, title, ext, count = 1, date = new Date() }) {
  const base = [hostOf(url), slugify(title), stamp(date)].filter(Boolean).join("-");
  if (count <= 1) return [`${base}.${ext}`];
  return Array.from({ length: count }, (_, i) => `${base}-${i + 1}of${count}.${ext}`);
}
