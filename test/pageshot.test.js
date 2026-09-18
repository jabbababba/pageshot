// Pageshot test suite.  Run with:  node test/pageshot.test.js
//
// Pure modules are imported directly. Anything that touches chrome.* is
// driven through a fake that records the CDP conversation, so no browser
// is involved.

import { MAX_BAND, planBands } from "../lib/plan.js";
import { slugify, hostOf, stamp, buildFilenames } from "../lib/name.js";
import { checkUrl } from "../lib/guard.js";
import { toUserMessage } from "../lib/errors.js";
import { withDebugger, PROTOCOL_VERSION } from "../lib/cdp.js";
import { getMetrics, primeLazyContent, captureBands, captureJpegs } from "../lib/capture.js";
import { A4, readStream, printPdf } from "../lib/pdf.js";
import { saveDataUrl, saveAll } from "../lib/download.js";
import { runCapture } from "../background.js";

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "  -> " + detail : "")); }
};
const eq = (name, actual, expected) =>
  ok(name, JSON.stringify(actual) === JSON.stringify(expected),
     "got " + JSON.stringify(actual));

console.log("\nBand planning");

eq("short page is one band", planBands(500), [{ y: 0, height: 500 }]);
eq("exactly the cap is one band", planBands(16384), [{ y: 0, height: 16384 }]);
eq("one pixel over the cap spills into a second band", planBands(16385),
   [{ y: 0, height: 16384 }, { y: 16384, height: 1 }]);
eq("40000px page is three bands", planBands(40000),
   [{ y: 0, height: 16384 }, { y: 16384, height: 16384 }, { y: 32768, height: 7232 }]);
eq("zero height yields no bands", planBands(0), []);
eq("negative height yields no bands", planBands(-10), []);
eq("fractional height is floored", planBands(500.7), [{ y: 0, height: 500 }]);
ok("cap is 16384", MAX_BAND === 16384, String(MAX_BAND));

const bands = planBands(40000);
ok("bands never overlap",
   bands.every((b, i) => i === 0 || b.y === bands[i - 1].y + bands[i - 1].height));
ok("bands cover the whole page",
   bands.reduce((n, b) => n + b.height, 0) === 40000);


console.log("\nFilenames");

const D = new Date(2026, 8, 18, 14, 32); // 18 Sept 2026, 14:32 local

ok("timestamp is YYMMDD-HHMM", stamp(D) === "260918-1432", stamp(D));
ok("midnight pads correctly",
   stamp(new Date(2026, 0, 5, 0, 7)) === "260105-0007",
   stamp(new Date(2026, 0, 5, 0, 7)));

ok("www is stripped", hostOf("https://www.example.com/a/b") === "example.com");
ok("subdomains are kept", hostOf("https://news.bbc.co.uk/x") === "news.bbc.co.uk");
ok("unparseable url falls back", hostOf("not a url") === "page");

ok("simple title slugs", slugify("How to Fix a Bike") === "how-to-fix-a-bike");
ok("punctuation collapses", slugify("Hello,   World!! -- again") === "hello-world-again",
   slugify("Hello,   World!! -- again"));
ok("german characters transliterate",
   slugify("Größe der Wohnung") === "groesse-der-wohnung",
   slugify("Größe der Wohnung"));
ok("accents reduce to ascii", slugify("Café Münster") === "cafe-muenster",
   slugify("Café Münster"));
ok("empty title gives empty slug", slugify("") === "" && slugify(null) === "");
ok("emoji-only title gives empty slug", slugify("🎉🎉") === "", slugify("🎉🎉"));
ok("long titles cut at a word boundary",
   slugify("a".repeat(20) + " " + "b".repeat(20) + " " + "c".repeat(40)).length <= 60);
ok("long title does not end in a hyphen",
   !slugify("word ".repeat(40)).endsWith("-"), slugify("word ".repeat(40)));

eq("single file has no part suffix",
   buildFilenames({ url: "https://www.example.com/x", title: "How to Fix a Bike", ext: "jpg", count: 1, date: D }),
   ["example.com-how-to-fix-a-bike-260918-1432.jpg"]);

eq("three files are numbered",
   buildFilenames({ url: "https://example.com/x", title: "Long", ext: "jpg", count: 3, date: D }),
   ["example.com-long-260918-1432-1of3.jpg",
    "example.com-long-260918-1432-2of3.jpg",
    "example.com-long-260918-1432-3of3.jpg"]);

eq("missing title drops the slug segment entirely",
   buildFilenames({ url: "https://example.com/x", title: "", ext: "pdf", count: 1, date: D }),
   ["example.com-260918-1432.pdf"]);

console.log("\nURL guard");

ok("https is capturable", checkUrl("https://example.com").ok);
ok("http is capturable", checkUrl("http://example.com").ok);
ok("chrome:// is blocked", checkUrl("chrome://extensions").ok === false);
ok("extension pages are blocked", checkUrl("chrome-extension://abc/x.html").ok === false);
ok("file:// is blocked", checkUrl("file:///Users/x/a.html").ok === false);
ok("devtools is blocked", checkUrl("devtools://devtools/bundled/x.html").ok === false);
ok("view-source is blocked", checkUrl("view-source:https://example.com").ok === false);
ok("the web store is blocked", checkUrl("https://chromewebstore.google.com/detail/x").ok === false);
ok("the legacy web store is blocked",
   checkUrl("https://chrome.google.com/webstore/detail/x").ok === false);
ok("a normal google page is fine", checkUrl("https://chrome.google.com/about").ok);
ok("undefined url is blocked", checkUrl(undefined).ok === false);
ok("blocked urls carry a readable reason",
   /doesn't allow/i.test(checkUrl("chrome://extensions").reason),
   checkUrl("chrome://extensions").reason);

console.log("\nError messages");

ok("devtools clash is explained",
   /Close DevTools/i.test(toUserMessage(new Error("Another debugger is already attached to the tab with id: 5"))));
ok("closed tab is explained",
   /tab changed or closed/i.test(toUserMessage(new Error("No tab with given id 12"))));
ok("navigation away is explained",
   /tab changed or closed/i.test(toUserMessage(new Error("Inspected target navigated or closed"))));
ok("unknown errors pass their message through",
   toUserMessage(new Error("kaboom")) === "kaboom");
ok("empty errors still say something",
   toUserMessage(undefined).length > 0, toUserMessage(undefined));


console.log("\nDebugger session");

// A stand-in for chrome.debugger that records everything it is asked to do.
function fakeDebugger({ attachError = null, sendResults = {}, detachError = null } = {}) {
  const log = [];
  return {
    log,
    async attach(target, version) {
      log.push(["attach", target.tabId, version]);
      if (attachError) throw attachError;
    },
    async sendCommand(target, method, params) {
      log.push(["send", method, params]);
      const r = sendResults[method];
      if (r instanceof Error) throw r;
      return typeof r === "function" ? r(params) : (r ?? {});
    },
    async detach(target) {
      log.push(["detach", target.tabId]);
      if (detachError) throw detachError;
    },
  };
}

const names = (dbg) => dbg.log.map((e) => e[0]);

{
  const dbg = fakeDebugger({ sendResults: { "Page.enable": {} } });
  const result = await withDebugger(7, async (send) => {
    await send("Page.enable");
    return "done";
  }, dbg);
  ok("returns the callback result", result === "done", String(result));
  eq("attaches, sends, then detaches", names(dbg), ["attach", "send", "detach"]);
  ok("attaches with protocol 1.3", dbg.log[0][2] === PROTOCOL_VERSION, dbg.log[0][2]);
  ok("attaches to the right tab", dbg.log[0][1] === 7);
}

{
  const dbg = fakeDebugger();
  let thrown = null;
  try {
    await withDebugger(7, async () => { throw new Error("capture blew up"); }, dbg);
  } catch (e) { thrown = e; }
  ok("rethrows the callback error", thrown && thrown.message === "capture blew up");
  ok("DETACHES EVEN WHEN THE CALLBACK THROWS", names(dbg).includes("detach"),
     JSON.stringify(names(dbg)));
}

{
  const dbg = fakeDebugger({ attachError: new Error("Another debugger is already attached") });
  let thrown = null;
  try {
    await withDebugger(7, async () => "never runs", dbg);
  } catch (e) { thrown = e; }
  ok("propagates the attach failure", thrown && /Another debugger/.test(thrown.message));
  ok("does not detach when attach never succeeded", !names(dbg).includes("detach"),
     JSON.stringify(names(dbg)));
}

{
  const dbg = fakeDebugger({ detachError: new Error("No tab with given id") });
  const result = await withDebugger(7, async () => "fine", dbg);
  ok("a failing detach does not mask a good result", result === "fine", String(result));
}


console.log("\nJPEG capture");

// Records the CDP conversation and answers the three commands capture uses.
function fakeSend({ contentHeight = 5000, contentWidth = 1280, viewportHeight = 900 } = {}) {
  const calls = [];
  const send = async (method, params = {}) => {
    calls.push({ method, params });
    if (method === "Page.getLayoutMetrics") {
      return {
        cssContentSize: { x: 0, y: 0, width: contentWidth, height: contentHeight },
        cssLayoutViewport: { clientWidth: contentWidth, clientHeight: viewportHeight },
      };
    }
    if (method === "Page.captureScreenshot") return { data: "AAAA" };
    return {};
  };
  send.calls = calls;
  send.of = (m) => calls.filter((c) => c.method === m);
  return send;
}

const noSleep = async () => {};

{
  const send = fakeSend({ contentHeight: 5000.4, contentWidth: 1280.6, viewportHeight: 900 });
  const m = await getMetrics(send);
  eq("metrics are read and rounded up", m, { width: 1281, height: 5001, viewportHeight: 900 });
}

{
  const send = fakeSend();
  await primeLazyContent(send, { height: 2700, viewportHeight: 900 }, noSleep);
  const evals = send.of("Runtime.evaluate").map((c) => c.params.expression);
  ok("scrolls down through the page in viewport steps",
     evals.filter((e) => /scrollTo\(0, \d+\)/.test(e)).length >= 3, JSON.stringify(evals));
  ok("returns to the top afterwards",
     evals[evals.length - 1] === "window.scrollTo(0, 0)", evals[evals.length - 1]);
}

{
  const send = fakeSend();
  const bands = planBands(40000);
  const seen = [];
  const urls = await captureBands(send, {
    width: 1280, bands, onProgress: (i, n) => seen.push([i, n]),
  });

  ok("one image per band", urls.length === 3, String(urls.length));
  ok("images are jpeg data urls",
     urls.every((u) => u.startsWith("data:image/jpeg;base64,AAAA")), urls[0]);
  eq("progress is reported per band", seen, [[1, 3], [2, 3], [3, 3]]);

  const shots = send.of("Page.captureScreenshot").map((c) => c.params);
  ok("every shot captures beyond the viewport",
     shots.every((p) => p.captureBeyondViewport === true));
  ok("every shot is jpeg at quality 90",
     shots.every((p) => p.format === "jpeg" && p.quality === 90));
  eq("clips are page-absolute and tile the page",
     shots.map((p) => [p.clip.y, p.clip.height]),
     [[0, 16384], [16384, 16384], [32768, 7232]]);
  ok("clips use scale 1 and full width",
     shots.every((p) => p.clip.scale === 1 && p.clip.width === 1280 && p.clip.x === 0));
}

{
  const send = fakeSend({ contentHeight: 3000 });
  const urls = await captureJpegs(send, { sleep: noSleep });
  ok("full pipeline returns one file for a short page", urls.length === 1, String(urls.length));
  ok("pipeline primes lazy content before capturing",
     send.calls.findIndex((c) => c.method === "Runtime.evaluate") <
     send.calls.findIndex((c) => c.method === "Page.captureScreenshot"));
}


console.log("\nPDF printing");

// Serve `bytes` through IO.read in chunks of `size`, base64 per chunk, which
// is what Chrome actually does and where naive string concatenation breaks.
function fakePdfSend(bytes, size = 7) {
  const calls = [];
  let offset = 0;
  const send = async (method, params = {}) => {
    calls.push({ method, params });
    if (method === "Page.printToPDF") return { stream: "handle-1" };
    if (method === "IO.read") {
      const slice = bytes.subarray(offset, offset + size);
      offset += slice.length;
      return {
        data: Buffer.from(slice).toString("base64"),
        base64Encoded: true,
        eof: offset >= bytes.length,
      };
    }
    return {};
  };
  send.calls = calls;
  send.of = (m) => calls.filter((c) => c.method === m);
  return send;
}

{
  // 50 bytes at 7 per chunk guarantees padded intermediate chunks.
  const original = Uint8Array.from({ length: 50 }, (_, i) => (i * 7) % 256);
  const send = fakePdfSend(original, 7);
  const bytes = await readStream(send, "handle-1");
  ok("reassembles multi-chunk streams byte for byte",
     Buffer.compare(Buffer.from(bytes), Buffer.from(original)) === 0,
     bytes.length + " bytes");
  ok("closes the stream handle", send.of("IO.close").length === 1);
  ok("closes the handle it was given",
     send.of("IO.close")[0].params.handle === "handle-1");
}

{
  const original = Uint8Array.from([1, 2, 3]);
  const send = fakePdfSend(original, 1024);
  const bytes = await readStream(send, "handle-1");
  ok("handles a single-chunk stream",
     Buffer.compare(Buffer.from(bytes), Buffer.from(original)) === 0);
}

{
  const original = Uint8Array.from({ length: 30 }, (_, i) => i);
  const send = fakePdfSend(original, 8);
  const url = await printPdf(send);

  ok("returns a pdf data url", url.startsWith("data:application/pdf;base64,"), url.slice(0, 40));
  ok("the data url decodes back to the original bytes",
     Buffer.compare(Buffer.from(url.split(",")[1], "base64"), Buffer.from(original)) === 0);

  const p = send.of("Page.printToPDF")[0].params;
  ok("prints backgrounds", p.printBackground === true);
  ok("prefers CSS page size", p.preferCSSPageSize === true);
  ok("uses A4", p.paperWidth === 8.27 && p.paperHeight === 11.69,
     p.paperWidth + "x" + p.paperHeight);
  ok("uses 10mm margins",
     [p.marginTop, p.marginBottom, p.marginLeft, p.marginRight].every((m) => m === 0.394));
  ok("streams rather than returning one giant payload",
     p.transferMode === "ReturnAsStream", String(p.transferMode));
}


console.log("\nDownloads");

{
  const asked = [];
  const api = { download: async (opts) => { asked.push(opts); return asked.length; } };
  await saveDataUrl("a.jpg", "data:image/jpeg;base64,AAAA", api);
  ok("passes the filename through", asked[0].filename === "a.jpg");
  ok("passes the data url as the download url",
     asked[0].url === "data:image/jpeg;base64,AAAA");
  ok("does not open a save dialog", asked[0].saveAs === false);

  const ids = await saveAll(["a.jpg", "b.jpg"], ["data:x", "data:y"], api);
  ok("saves every file", ids.length === 2 && asked.length === 3, JSON.stringify(ids));
}

console.log("\nOrchestration");

// Minimal doubles for everything runCapture reaches for.
function deps({ jpegs = ["data:image/jpeg;base64,AAAA"], pdf = "data:application/pdf;base64,BBBB",
                capture = null, detachLog = [] } = {}) {
  return {
    withDebugger: async (tabId, fn) => {
      try { return await fn(async () => ({})); }
      finally { detachLog.push("detached"); }
    },
    captureJpegs: capture || (async () => jpegs),
    printPdf: async () => pdf,
    saveAll: async (names) => names.map((_, i) => i),
    now: () => new Date(2026, 8, 18, 14, 32),
    detachLog,
  };
}

{
  const d = deps();
  const r = await runCapture({
    tabId: 1, url: "https://www.example.com/a", title: "How to Fix a Bike",
    format: "jpg", deps: d,
  });
  ok("jpg capture succeeds", r.ok === true, JSON.stringify(r));
  eq("names the single jpg correctly", r.files,
     ["example.com-how-to-fix-a-bike-260918-1432.jpg"]);
}

{
  const d = deps({ jpegs: ["data:a", "data:b", "data:c"] });
  const r = await runCapture({
    tabId: 1, url: "https://example.com/a", title: "Long", format: "jpg", deps: d,
  });
  eq("numbers multi-file jpg captures", r.files,
     ["example.com-long-260918-1432-1of3.jpg",
      "example.com-long-260918-1432-2of3.jpg",
      "example.com-long-260918-1432-3of3.jpg"]);
}

{
  const d = deps();
  const r = await runCapture({
    tabId: 1, url: "https://example.com/a", title: "Long", format: "pdf", deps: d,
  });
  eq("pdf capture names one file", r.files, ["example.com-long-260918-1432.pdf"]);
}

{
  const d = deps();
  const r = await runCapture({
    tabId: 1, url: "chrome://extensions", title: "Extensions", format: "jpg", deps: d,
  });
  ok("blocked pages fail before attaching", r.ok === false);
  ok("blocked pages explain themselves", /doesn't allow/i.test(r.error), r.error);
  ok("blocked pages never attach the debugger", d.detachLog.length === 0);
}

{
  const detachLog = [];
  const d = deps({
    detachLog,
    capture: async () => { throw new Error("Inspected target navigated or closed"); },
  });
  const r = await runCapture({
    tabId: 1, url: "https://example.com/a", title: "X", format: "jpg", deps: d,
  });
  ok("a mid-capture failure is reported, not thrown", r.ok === false, JSON.stringify(r));
  ok("the failure is translated for a human",
     /tab changed or closed/i.test(r.error), r.error);
  ok("THE DEBUGGER IS STILL DETACHED AFTER A FAILURE",
     detachLog.length === 1, JSON.stringify(detachLog));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
