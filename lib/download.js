// CDP hands us base64 already, so results go out as data: URLs. This sidesteps
// URL.createObjectURL, which does not exist in MV3 service workers.
export async function saveDataUrl(filename, dataUrl, api = chrome.downloads) {
  return api.download({ url: dataUrl, filename, saveAs: false });
}

export async function saveAll(filenames, dataUrls, api = chrome.downloads) {
  const ids = [];
  for (let i = 0; i < filenames.length; i++) {
    ids.push(await saveDataUrl(filenames[i], dataUrls[i], api));
  }
  return ids;
}
