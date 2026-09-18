const buttons = [document.getElementById("jpg"), document.getElementById("pdf")];
const status = document.getElementById("status");

function render({ running, status: text }) {
  buttons.forEach((b) => { b.disabled = !!running; });
  status.textContent = text || "";
}

// A capture started earlier may still be running: the service worker owns it,
// so reopening the popup picks the progress back up.
chrome.runtime.sendMessage({ type: "pageshot:state" }).then(render).catch(() => {});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "pageshot:status") render(msg);
});

for (const button of buttons) {
  button.addEventListener("click", async () => {
    render({ running: true, status: "Starting" });
    try {
      const result = await chrome.runtime.sendMessage({
        type: "pageshot:capture", format: button.id,
      });
      render({ running: false, status: result.ok ? "Saved" : result.error });
    } catch (err) {
      render({ running: false, status: String(err.message || err) });
    }
  });
}
