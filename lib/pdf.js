const MM_10_IN_INCHES = 0.394;

export const A4 = {
  printBackground: true,
  preferCSSPageSize: true,
  paperWidth: 8.27,
  paperHeight: 11.69,
  marginTop: MM_10_IN_INCHES,
  marginBottom: MM_10_IN_INCHES,
  marginLeft: MM_10_IN_INCHES,
  marginRight: MM_10_IN_INCHES,
};

const CHUNK = 512 * 1024;

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes) {
  let s = "";
  const SLICE = 0x8000; // stay under the argument limit of String.fromCharCode
  for (let i = 0; i < bytes.length; i += SLICE) {
    s += String.fromCharCode(...bytes.subarray(i, i + SLICE));
  }
  return btoa(s);
}

// Read a CDP IO stream to completion.
//
// Each chunk is decoded to bytes before joining. Concatenating the base64
// strings instead would embed "=" padding mid-stream and silently corrupt the
// PDF, which is the failure this function exists to prevent.
export async function readStream(send, handle) {
  const chunks = [];
  let total = 0;

  for (;;) {
    const { data, base64Encoded, eof } = await send("IO.read", { handle, size: CHUNK });
    if (data) {
      const bytes = base64Encoded === false
        ? Uint8Array.from(String(data), (c) => c.charCodeAt(0))
        : base64ToBytes(data);
      chunks.push(bytes);
      total += bytes.length;
    }
    if (eof) break;
  }

  await send("IO.close", { handle });

  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

// Chrome's own print engine, which is the only route to a PDF with real
// selectable text. It renders through the site's print stylesheet, so the
// result can differ from the screenshot on sites that style printing oddly.
export async function printPdf(send, paper = A4) {
  const { stream } = await send("Page.printToPDF", { ...paper, transferMode: "ReturnAsStream" });
  const bytes = await readStream(send, stream);
  return `data:application/pdf;base64,${bytesToBase64(bytes)}`;
}
