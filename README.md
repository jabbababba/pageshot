# Pageshot

Capture a whole web page as a JPG, or as a PDF containing real selectable text.

## Install

1. Download the code: click the green **Code** button at
   <https://github.com/jabbababba/pageshot> and choose **Download ZIP**, then
   unzip it. (Or `git clone https://github.com/jabbababba/pageshot.git`.)
2. Open `chrome://extensions`
3. Turn on **Developer mode** (top right)
4. **Load unpacked**, and choose the unzipped folder
5. Pin Pageshot to the toolbar

Chrome will ask you to approve the **debugger** permission. See the first note
below for why it is needed.

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
npm test
```

That runs two suites, neither of which needs a browser:

- `test/pageshot.test.js` unit-tests each module against a fake debugger.
- `test/smoke.test.js` drives the whole pipeline end to end with real JPEG and
  PDF bytes, writes the files a download would produce, and checks they are
  valid and byte-identical to the originals.

No dependencies and no build step.
