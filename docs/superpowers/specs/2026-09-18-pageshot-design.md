# Pageshot: design

**Date:** 2026-09-18
**Status:** Approved, ready for implementation planning

## Purpose

A Chrome extension that captures the whole of a web page and exports it either
as a JPG (pixel-accurate) or as a PDF containing real, selectable text. A
FireShot replacement covering only the parts actually used.

## Scope

In scope:

- Entire-page capture only.
- Two exports: JPG, and PDF with selectable text laid out as the page is.
- Popup with two buttons; files go straight to the Downloads folder.

Explicitly out of scope (may be added later, not now):

- Visible-area capture, region selection, batch capture of all tabs.
- Annotation or editing of the capture.
- Uploading, sharing, clipboard export.
- An options page.
- OCR.

## Constraints that shaped the design

1. **A selectable-text PDF of the page as laid out can only come from Chrome's
   own print engine**, `Page.printToPDF`, reachable from an extension only
   through the `chrome.debugger` API. No other extension API produces real
   text. The `debugger` permission is therefore mandatory, and Chrome shows a
   "Pageshot started debugging this browser" infobar during every capture.
   This is a consequence of the requirement, not a choice.
2. **Chrome hard-caps any single screenshot at 16,384px tall**, a GPU texture
   limit. Pages routinely exceed this, so full-page capture must be banded.
3. **`URL.createObjectURL` does not exist in MV3 service workers**, so the
   conventional blob-download path is unavailable.

## Architecture

All logic runs in the service worker. No content script and no host
permissions: CDP supplies the page geometry, so the extension never injects
into pages.

```
popup.html / popup.js  ──▶  background.js (orchestrator)
                                 │
                                 ├── lib/cdp.js      attach / send / detach wrapper
                                 ├── lib/plan.js     page height → capture bands   [pure]
                                 ├── lib/capture.js  bands → JPEG data URLs
                                 ├── lib/pdf.js      printToPDF → PDF bytes
                                 └── lib/name.js     tab → filenames               [pure]
```

`plan.js` and `name.js` are pure: no `chrome.*` reference, no I/O. They hold
the logic most likely to be wrong and are directly unit-testable.

`cdp.js` is the only module that touches `chrome.debugger`. Everything else
receives a `send(method, params)` function, which is what makes the pipelines
testable against a fake.

### Manifest

- `manifest_version: 3`
- Permissions: `debugger`, `downloads`, `activeTab`
- No host permissions, no content scripts, no web-accessible resources
- `action` with `default_popup: popup.html`
- Service worker: `background.js`

## JPG pipeline

Because `Page.captureScreenshot` returns a JPEG of an arbitrary page-absolute
rectangle, and tall pages are permitted to split across files, **one band is
one output file**. There is no canvas, no stitching and no seam handling.

1. `Page.getLayoutMetrics` gives `cssContentSize` (full width and height).
2. **Lazy-load pre-pass**: step-scroll to the bottom in viewport-sized
   increments via `Runtime.evaluate`, pause briefly at each step, then return
   to the top. Without this, content that loads on scroll renders as blank
   space.
3. `plan.js` slices the content height into bands of at most `MAX_BAND = 16384`
   px. A 9,000px page gives one band; a 40,000px page gives three
   (16384, 16384, 7232).
4. One `Page.captureScreenshot` per band: `format: "jpeg"`, `quality: 90`,
   `captureBeyondViewport: true`, `clip: {x: 0, y: <band top>, width, height,
   scale: 1}`. Clip coordinates are page-absolute when `captureBeyondViewport`
   is true, so the page is never scrolled during capture and sticky headers
   cannot repeat.
5. Each band downloads as its own file.

## PDF pipeline

`Page.printToPDF` with:

- `printBackground: true`
- `preferCSSPageSize: true`
- A4: `paperWidth: 8.27`, `paperHeight: 11.69` (inches)
- Margins: 10mm, expressed as `0.394` inches on all four sides
- `transferMode: "ReturnAsStream"`, then read the handle with `IO.read` until
  `eof`, then `IO.close`

The stream matters: the DevTools pipe rejects oversized frames, and a long page
returned as a single base64 payload will hit that limit.

**Known limitation:** `printToPDF` renders through the site's print stylesheet.
A minority of sites hide content or force a different layout when printing, so
the PDF will occasionally differ from the screenshot. This is inherent to
producing real selectable text. The JPG remains the pixel-accurate record.

## Popup

A single small panel, no framework, no build step.

- Two buttons: **Save as JPG** and **Save as PDF**.
- A one-line status area beneath them, empty at rest.
- While a capture runs, both buttons disable and the status shows progress:
  "Loading page content" during the lazy pre-pass, then "Capturing 2 of 3" per
  band, then "Saved".
- On failure the status shows the message from the error table and the buttons
  re-enable.
- The popup must survive being closed mid-capture: the service worker owns the
  capture, so closing the popup never cancels or corrupts a download. A popup
  reopened during a capture re-reads the current state and shows the same
  progress.

## Capture lifecycle

```
popup click
  └─ guard: is the URL capturable?      → if not, message and stop
  └─ chrome.debugger.attach(tabId, "1.3")
       └─ Page.enable
       └─ JPG:  getLayoutMetrics → lazy pre-pass → plan → capture bands
          PDF:  printToPDF → stream read
       └─ download each result
  └─ finally: chrome.debugger.detach    → always, on every path
```

## Error handling

Every failure produces a plain message in the popup, not a console log.

| Situation | Behaviour |
|---|---|
| `chrome://`, `chrome-extension://`, `file://`, Web Store, PDF viewer | Blocked before attaching. "Chrome doesn't allow capturing this page." |
| DevTools already attached to the tab | "Close DevTools for this tab and try again." |
| Tab navigates or closes mid-capture | Abort, discard partial files, detach. |
| `printToPDF` rejects | Offer the JPG instead rather than failing silently. |
| Any unexpected CDP error | Surface the raw message; detach regardless. |

**Detach is unconditional.** It runs in a `finally` on every path, and the
extension also listens to `chrome.debugger.onDetach` to clear its own state. A
stuck attach leaves the yellow infobar on the user's tab indefinitely, which is
the worst outcome this extension can produce.

## Downloads

CDP returns base64 already, so results download as `data:` URLs through
`chrome.downloads.download`, avoiding the missing `createObjectURL` entirely.
If Chrome rejects a data URL for a large file, the fallback is an offscreen
document (`chrome.offscreen`), which has a DOM and therefore
`URL.createObjectURL`. The offscreen path is built only if the data URL path
proves insufficient in manual testing.

## Naming

Pattern: `<host>-<title-slug>-<YYMMDD-HHMM>.<ext>`

Example: `example.com-how-to-fix-a-bike-260918-1432.jpg`

- Host has any leading `www.` stripped.
- Title is lowercased, non-alphanumerics collapsed to single hyphens, trimmed
  to 60 characters at a word boundary.
- Missing or empty title: the slug segment is omitted entirely.
- Multiple JPG files take a `-1of3` suffix before the extension. A single file
  takes no suffix.

## Defaults

These are constants in the source, not user settings.

| Setting | Value |
|---|---|
| Paper | A4 |
| Margins | 10mm |
| Print backgrounds | On |
| JPEG quality | 90 |
| Capture scale | 1x |
| Max band / file height | 16384px |

## Testing

Following the clean-read convention: plain Node, no framework, no build step.
Run with `node test/pageshot.test.js`, hand-rolled pass/fail counters.

`chrome.debugger` is replaced by a fake that records every command sent and
replays fixture responses, so the tests assert on the CDP conversation without
launching a browser.

Cases:

- **Band planning**: 500px, exactly 16384px, 16385px, 40000px, and a zero
  height.
- **Filenames**: normal title, unicode title, empty title, very long title,
  `www.` stripping, `1of3` suffix present only for multi-file captures.
- **Detach always happens**, including when capture throws mid-way. This is the
  single most important test.
- **Scheme guard** rejects `chrome://` before any attach is attempted.
- **PDF stream reading** assembles multi-chunk `IO.read` responses correctly and
  closes the handle.

Manual verification once built, on three real pages: a long article, an
infinite-scroll feed, and a page with an aggressive sticky header.

## Success criteria

1. A long article captures to a single legible JPG and to a PDF whose text can
   be selected and searched.
2. A page over 16,384px produces correctly numbered, non-overlapping JPGs that
   together cover the whole page with nothing missing or duplicated.
3. The debugger infobar always disappears when a capture finishes or fails.
4. Blocked pages produce a clear message rather than a silent failure.
