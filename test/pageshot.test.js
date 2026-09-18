// Pageshot test suite.  Run with:  node test/pageshot.test.js
//
// Pure modules are imported directly. Anything that touches chrome.* is
// driven through a fake that records the CDP conversation, so no browser
// is involved.

import { MAX_BAND, planBands } from "../lib/plan.js";

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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
