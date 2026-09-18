# Pageshot

Capture a whole web page as a JPG, or as a PDF containing real selectable text.

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked**, and choose this folder
4. Pin Pageshot to the toolbar

## Use

Click the toolbar icon and choose **Save as JPG** or **Save as PDF**. Files land
in your Downloads folder, named like
`example.com-how-to-fix-a-bike-260918-1432.jpg`.

## Notes

- Chrome shows a **"Pageshot started debugging this browser"** bar during every
  capture. This is unavoidable: the selectable-text PDF comes from Chrome's own
  print engine, which extensions can only reach through the debugger API. The
  bar disappears as soon as the capture finishes.
- Pages taller than 16,384px are split into numbered files
  (`...-1of3.jpg`), because that is Chrome's hard cap on a single screenshot.
- The PDF renders through the site's print stylesheet, so on a few sites it
  will not match the screenshot exactly. The JPG is always the pixel-accurate
  record.
- Chrome forbids capturing `chrome://` pages, the Web Store, and local files.
- There is no icon set yet, so Chrome shows a default puzzle piece.

## Tests

```bash
node test/pageshot.test.js
```

No dependencies and no build step.
