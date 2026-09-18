export const PROTOCOL_VERSION = "1.3";

// Attach the debugger to a tab, run `fn` with a bound send(), then always
// detach. The finally block is the whole point of this module: a missed
// detach leaves Chrome's debugging infobar stuck on the user's tab.
export async function withDebugger(tabId, fn, dbg = chrome.debugger) {
  const target = { tabId };

  // If this throws we never attached, so there is nothing to clean up.
  await dbg.attach(target, PROTOCOL_VERSION);

  const send = (method, params = {}) => dbg.sendCommand(target, method, params);

  try {
    return await fn(send);
  } finally {
    try {
      await dbg.detach(target);
    } catch {
      // The tab may already be gone. Nothing useful to do, and this must not
      // replace whatever the caller was already throwing or returning.
    }
  }
}
