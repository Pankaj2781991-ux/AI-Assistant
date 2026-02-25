const sendBtn = document.getElementById("sendBtn");
const statusEl = document.getElementById("status");

function setStatus(text) {
  statusEl.textContent = text;
}

sendBtn.addEventListener("click", async () => {
  sendBtn.disabled = true;
  setStatus("Collecting visible DOM elements...");
  try {
    const response = await chrome.runtime.sendMessage({ type: "send-dom-map" });
    if (!response?.ok) {
      throw new Error(response?.error || "Failed to send DOM map.");
    }
    const count = Number(response?.count || 0);
    const url = String(response?.url || "");
    setStatus(`Sent ${count} elements to desktop app.\n${url}`);
  } catch (error) {
    setStatus(`Send failed: ${error.message}`);
  } finally {
    sendBtn.disabled = false;
  }
});
