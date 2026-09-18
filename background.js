import { checkUrl } from "./lib/guard.js";
import { toUserMessage } from "./lib/errors.js";
import { withDebugger as realWithDebugger } from "./lib/cdp.js";
import { captureJpegs as realCaptureJpegs } from "./lib/capture.js";
import { printPdf as realPrintPdf } from "./lib/pdf.js";
import { saveAll as realSaveAll } from "./lib/download.js";
import { buildFilenames } from "./lib/name.js";

const DEFAULT_DEPS = {
  withDebugger: realWithDebugger,
  captureJpegs: realCaptureJpegs,
  printPdf: realPrintPdf,
  saveAll: realSaveAll,
  now: () => new Date(),
};

// The popup can be closed at any moment, so the service worker owns the
// progress state and the popup reads it when it reopens.
let state = { running: false, status: "" };

function setStatus(status, running = true) {
  state = { running, status };
  chrome.runtime.sendMessage({ type: "pageshot:status", ...state }).catch(() => {
    // No popup open. Nothing is listening, and that is fine.
  });
}

export async function runCapture({ tabId, url, title, format, deps = DEFAULT_DEPS, onStatus = () => {} }) {
  const allowed = checkUrl(url);
  if (!allowed.ok) return { ok: false, error: allowed.reason };

  try {
    const dataUrls = await deps.withDebugger(tabId, async (send) => {
      await send("Page.enable");
      if (format === "pdf") {
        onStatus("Printing to PDF");
        return [await deps.printPdf(send)];
      }
      onStatus("Loading page content");
      return deps.captureJpegs(send, {
        onProgress: (i, n) => onStatus(n > 1 ? `Capturing ${i} of ${n}` : "Capturing"),
      });
    });

    const files = buildFilenames({
      url, title, ext: format === "pdf" ? "pdf" : "jpg",
      count: dataUrls.length, date: deps.now(),
    });

    onStatus("Saving");
    await deps.saveAll(files, dataUrls);
    return { ok: true, files };
  } catch (err) {
    return { ok: false, error: toUserMessage(err) };
  }
}

// The tests import this file in plain Node, where chrome.* does not exist.
// Everything above is pure enough to import; only the wiring below needs the
// browser, so it is registered conditionally.
const inExtension = typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage;

if (inExtension) {
  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (msg && msg.type === "pageshot:state") {
      respond(state);
      return false;
    }

    if (!msg || msg.type !== "pageshot:capture") return false;

    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) {
        setStatus("No active tab.", false);
        respond({ ok: false, error: "No active tab." });
        return;
      }

      setStatus("Starting");
      const result = await runCapture({
        tabId: tab.id, url: tab.url, title: tab.title, format: msg.format,
        onStatus: (s) => setStatus(s),
      });

      setStatus(result.ok ? "Saved" : result.error, false);
      respond(result);
    })();

    return true; // keep the message channel open for the async respond
  });

  // Chrome can detach us on its own: the user closes the tab, opens DevTools,
  // or clicks Cancel on the debugging bar. Clear our state so the popup does
  // not sit there claiming a capture is still running.
  chrome.debugger.onDetach.addListener((source, reason) => {
    if (!state.running) return;
    setStatus(reason === "canceled_by_user" ? "Capture cancelled." : "The debugger detached.", false);
  });
}
