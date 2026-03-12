{
  const sendBtn = document.getElementById("sendBtn") as HTMLButtonElement | null;
  const statusEl = document.getElementById("status") as HTMLElement | null;

  function setStatus(text: string) {
    if (statusEl) {
      statusEl.textContent = text;
    }
  }

  sendBtn?.addEventListener("click", async () => {
    sendBtn.disabled = true;
    setStatus("Collecting visible DOM elements...");
    try {
      const response = await chrome.runtime.sendMessage({ type: "send-dom-map" });
      if (!response?.ok) {
        throw new Error(String(response?.error || "Failed to send DOM map."));
      }
      const count = Number(response?.count || 0);
      const url = String(response?.url || "");
      setStatus(`Sent ${count} elements to desktop app.\n${url}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error.";
      setStatus(`Send failed: ${message}`);
    } finally {
      sendBtn.disabled = false;
    }
  });
}


