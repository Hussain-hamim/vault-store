// Capture the complete standalone document, including its paper gutters.
// Oversized ledgers fail explicitly instead of silently cropping customer data.
async function renderShareImage(contents, BrowserWindow) {
  const win = BrowserWindow.fromWebContents(contents);
  await contents.setZoomFactor(1);
  const size = await contents.executeJavaScript(`(() => {
    const body = document.body;
    return { width: Math.ceil(body.getBoundingClientRect().width), height: Math.ceil(Math.max(body.scrollHeight, body.getBoundingClientRect().height)) };
  })()`);
  if (size.width < 1 || size.height < 1 || size.width > 2400 || size.height > 12000 || size.width * size.height > 16000000) {
    const error = new Error('WHATSAPP_IMAGE_TOO_LARGE');
    error.code = error.message;
    throw error;
  }
  win.setContentSize(size.width, size.height);
  await contents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const bitmap = await contents.capturePage({ x: 0, y: 0, ...size }, { stayHidden: true, stayAwake: true });
  if (bitmap.isEmpty()) throw new Error('Could not render invoice image.');
  return bitmap.toPNG();
}
module.exports = { renderShareImage };
