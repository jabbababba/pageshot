// Turn a raw CDP or chrome.* failure into something worth showing a person.
export function toUserMessage(err) {
  const raw = String((err && err.message) || err || "").trim();

  if (/another debugger|already attached|debugger is attached/i.test(raw)) {
    return "Close DevTools for this tab and try again.";
  }
  if (/no tab with given id|no target with given id|target closed|inspected target (navigated|closed)|detached/i.test(raw)) {
    return "The tab changed or closed before the capture finished.";
  }
  if (/cannot be scripted|cannot access|chrome:\/\//i.test(raw)) {
    return "Chrome doesn't allow capturing this page.";
  }
  return raw || "Something went wrong.";
}
