// Pageshot end-to-end smoke test.  Run with:  node test/smoke.test.js
//
// The unit suite checks each module against a fake. This one drives the whole
// pipeline, from runCapture down to the bytes a download would receive, using
// a fake CDP endpoint that serves REAL jpeg and pdf data. It then writes those
// bytes to disk and checks the files are valid and byte-identical to the
// originals.
//
// Everything is self-contained: no fixture files, no dependencies, no network.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCapture } from "../background.js";
import { captureJpegs } from "../lib/capture.js";
import { printPdf } from "../lib/pdf.js";

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "  -> " + detail : "")); }
};

/* ------------------------------------------------------------- fixtures */

// A real 48x25 baseline JPEG, embedded so the test needs nothing from disk.
const JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAASABIAAD/4QC8RXhpZgAATU0AKgAAAAgABQESAAMAAAABAAEAAAEaAAUA" +
  "AAABAAAASgEbAAUAAAABAAAAUgEoAAMAAAABAAIAAIdpAAQAAAABAAAAWgAAAAAAAABIAAAAAQAA" +
  "AEgAAAABAAeQAAAHAAAABDAyMjGRAQAHAAAABAECAwCgAAAHAAAABDAxMDCgAQADAAAAAQABAACg" +
  "AgAEAAAAAQAAADCgAwAEAAAAAQAAABmkBgADAAAAAQAAAAAAAAAA/8AAEQgAGQAwAwEiAAIRAQMR" +
  "Af/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQEC" +
  "AwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNE" +
  "RUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqy" +
  "s7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEB" +
  "AQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEH" +
  "YXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZX" +
  "WFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLD" +
  "xMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMABAQEBAQEBgQEBgkGBgYJDAkJ" +
  "CQkMDwwMDAwMDxIPDw8PDw8SEhISEhISEhUVFRUVFRkZGRkZHBwcHBwcHBwcHP/bAEMBBAUFBwcH" +
  "DAcHDB0UEBQdHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0d" +
  "Hf/dAAQAA//aAAwDAQACEQMRAD8A9uzEwxjFV5bWOQcVgTX1+FPkRqD2ya5q51TxVbs0iPEVH8LA" +
  "fp3r5fD42v0gz6aph4W1kvvOmvNMVs8Vy91pA5+WuWXx94k1DNlAkNtcrknzkKsVHfB4we1QweN9" +
  "dmhEzRWs8YcoXQkZPoMdxX0VDG4hfZPFr4ai/tFfUbQC5ltmAURorZPvXmmr3llbTG3T97KccDpg" +
  "85z6fSuo17WYZPtEupnbJPAsafNsVZCOMgckfWualu4hagWVnE88SqouCd5KDjITpnms8TneJprl" +
  "Ubefz+78zfD5RhJPmk7+Xy+/8j//0NT4gWGo3+kQ2ejXQtZRKTI2WyyYIwSM9zk5ridD8Qx+D9Ma" +
  "28Q30d1IpAXyk8yQIOiFiRkenpXeeKf+QWn+/H/Wvl7xn/yFD9P6CvPw1Ncl33PYruz0Poqx1rwt" +
  "4kQB3hu5IwGdVBTbnplWP4dTXnGn/ES0sfFk9hqVtHb2CyMsUaphlVhw3uTwT9eOlcD8Nf8AkM3f" +
  "/XD/ANmFZvjL/kPw/X/CvQjSTXqefKrJWa6E+qX9hqU88irOUM7Mn2gg7gScA9MY9ccU+01Oeytp" +
  "VUREuoUKFLADBxjHOc471l6f9w/7z/zjqWL/AFjf9c5f5NXLiKFPks1oVRrT9pdM/9k=";

const JPEG = Buffer.from(JPEG_B64, "base64");

// A minimal but genuinely valid one-page PDF, built here rather than stored.
function buildPdf() {
  const content = Buffer.from("BT /F1 24 Tf 72 700 Td (Pageshot smoke test) Tj ET");
  const objs = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] " +
                "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>"),
    Buffer.concat([
      Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from("\nendstream"),
    ]),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
  ];

  let body = Buffer.from("%PDF-1.4\n");
  const offsets = [];
  objs.forEach((obj, i) => {
    offsets.push(body.length);
    body = Buffer.concat([body, Buffer.from(`${i + 1} 0 obj\n`), obj, Buffer.from("\nendobj\n")]);
  });

  const xrefAt = body.length;
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += String(off).padStart(10, "0") + " 00000 n \n";
  xref += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;

  return Buffer.concat([body, Buffer.from(xref)]);
}

const PDF = buildPdf();

/* ----------------------------------------------------------- fake chrome */

// Answers the four CDP commands the pipelines use. The PDF is served in
// 13-byte chunks, a size chosen so most chunks carry base64 padding: that is
// precisely the case where concatenating the base64 strings would corrupt it.
function makeSend(pageHeight) {
  let offset = 0;
  return async (method) => {
    if (method === "Page.getLayoutMetrics") {
      return {
        cssContentSize: { width: 1280, height: pageHeight },
        cssLayoutViewport: { clientWidth: 1280, clientHeight: 900 },
      };
    }
    if (method === "Page.captureScreenshot") return { data: JPEG_B64 };
    if (method === "Page.printToPDF") return { stream: "handle-1" };
    if (method === "IO.read") {
      const slice = PDF.subarray(offset, offset + 13);
      offset += slice.length;
      return { data: slice.toString("base64"), base64Encoded: true, eof: offset >= PDF.length };
    }
    return {};
  };
}

const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "pageshot-smoke-"));

// Real modules everywhere except the debugger itself and the download sink.
function deps(pageHeight) {
  const send = makeSend(pageHeight);
  const written = [];
  return {
    written,
    withDebugger: async (_tabId, fn) => fn(send),
    captureJpegs: (s, o) => captureJpegs(s, { ...o, sleep: async () => {} }),
    printPdf,
    saveAll: async (names, urls) => names.map((name, i) => {
      const file = path.join(OUT, name);
      fs.writeFileSync(file, Buffer.from(urls[i].split(",")[1], "base64"));
      written.push(file);
      return i;
    }),
    now: () => new Date(2026, 8, 18, 14, 32),
  };
}

const isJpeg = (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isPdf = (b) => b.subarray(0, 5).toString() === "%PDF-";

/* ---------------------------------------------------------------- checks */

try {
  console.log("\nEnd to end: a page taller than the cap");
  {
    const d = deps(40000);
    const r = await runCapture({
      tabId: 1, url: "https://www.example.com/x", title: "Smoke Test", format: "jpg", deps: d,
    });
    ok("capture reports success", r.ok === true, r.error || "");
    ok("writes three numbered files", d.written.length === 3,
       d.written.map((p) => path.basename(p)).join(", "));
    ok("names them 1of3, 2of3, 3of3",
       d.written.map((p) => path.basename(p).match(/-(\dof\d)\./)[1]).join(",") === "1of3,2of3,3of3");
    ok("every file is a real jpeg", d.written.every((p) => isJpeg(fs.readFileSync(p))));
    ok("every file is byte-identical to the source",
       d.written.every((p) => Buffer.compare(fs.readFileSync(p), JPEG) === 0));
  }

  console.log("\nEnd to end: a page that fits in one band");
  {
    const d = deps(3000);
    await runCapture({
      tabId: 1, url: "https://www.example.com/x", title: "Smoke Test", format: "jpg", deps: d,
    });
    ok("writes exactly one file", d.written.length === 1);
    ok("no part suffix on a single file", !/of\d/.test(path.basename(d.written[0])),
       path.basename(d.written[0]));
    ok("the file is a real jpeg", isJpeg(fs.readFileSync(d.written[0])));
  }

  console.log("\nEnd to end: pdf through a 13-byte chunked stream");
  {
    const d = deps(3000);
    const r = await runCapture({
      tabId: 1, url: "https://www.example.com/x", title: "Smoke Test", format: "pdf", deps: d,
    });
    ok("capture reports success", r.ok === true, r.error || "");
    ok("writes one pdf", d.written.length === 1, path.basename(d.written[0]));
    ok("the file is a real pdf", isPdf(fs.readFileSync(d.written[0])));
    ok("byte-identical after chunked reassembly",
       Buffer.compare(fs.readFileSync(d.written[0]), PDF) === 0);
  }

  console.log("\nEnd to end: a page chrome refuses to capture");
  {
    const d = deps(3000);
    const r = await runCapture({
      tabId: 1, url: "chrome://extensions", title: "Extensions", format: "jpg", deps: d,
    });
    ok("refuses before touching the debugger", r.ok === false);
    ok("writes nothing", d.written.length === 0);
  }
} finally {
  fs.rmSync(OUT, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
