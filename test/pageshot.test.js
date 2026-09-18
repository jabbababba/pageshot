// Pageshot test suite.  Run with:  node test/pageshot.test.js
//
// Pure modules are imported directly. Anything that touches chrome.* is
// driven through a fake that records the CDP conversation, so no browser
// is involved.

import { MAX_BAND, planBands } from "../lib/plan.js";
import { slugify, hostOf, stamp, buildFilenames } from "../lib/name.js";
import { checkUrl } from "../lib/guard.js";
import { toUserMessage } from "../lib/errors.js";

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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
