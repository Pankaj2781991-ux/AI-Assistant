const helpBubble = document.getElementById("helpBubble");
const BUBBLE_SIZE = 72;
let pointerActive = false;
let startedDragging = false;
let startX = 0;
let startY = 0;

async function captureCurrentScreen() {
  return window.bubbleApi.captureScreen();
}

async function handleCaptureClick() {
  helpBubble.disabled = true;
  const originalLabel = helpBubble.textContent;
  helpBubble.textContent = "...";

  try {
    const capture = await captureCurrentScreen();
    window.bubbleApi.openHelpPanel({
      dataUrl: capture?.dataUrl || null,
      captureMeta: capture?.captureMeta || null
    });
  } catch (_error) {
    // Capture is user-controlled; if canceled we still open the panel.
    window.bubbleApi.openHelpPanel({ dataUrl: null, captureMeta: null });
  } finally {
    helpBubble.disabled = false;
    helpBubble.textContent = originalLabel;
  }
}

helpBubble.addEventListener("pointerdown", (event) => {
  pointerActive = true;
  startedDragging = false;
  startX = event.screenX;
  startY = event.screenY;
  helpBubble.setPointerCapture(event.pointerId);
});

helpBubble.addEventListener("pointermove", (event) => {
  if (!pointerActive) {
    return;
  }

  const deltaX = Math.abs(event.screenX - startX);
  const deltaY = Math.abs(event.screenY - startY);
  if (deltaX > 3 || deltaY > 3) {
    startedDragging = true;
    window.bubbleApi.moveWindow({
      x: event.screenX - Math.floor(BUBBLE_SIZE / 2),
      y: event.screenY - Math.floor(BUBBLE_SIZE / 2)
    });
  }
});

helpBubble.addEventListener("pointerup", async () => {
  pointerActive = false;
  if (!startedDragging) {
    await handleCaptureClick();
  }
});
