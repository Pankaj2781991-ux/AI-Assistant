const root = document.getElementById("overlayRoot");

function clamp01(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function intersects(a, b) {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

function placeHintRect(preferred, size, occupied, bounds) {
  const candidates = [
    { x: preferred.x, y: preferred.y + preferred.h + 8 },
    { x: preferred.x, y: preferred.y - size.h - 8 },
    { x: preferred.x + preferred.w + 8, y: preferred.y },
    { x: preferred.x - size.w - 8, y: preferred.y }
  ];

  for (const cand of candidates) {
    const rect = {
      x: Math.max(0, Math.min(bounds.w - size.w, cand.x)),
      y: Math.max(0, Math.min(bounds.h - size.h, cand.y)),
      w: size.w,
      h: size.h
    };
    const blocked = occupied.some((r) => intersects(r, rect));
    if (!blocked) {
      return rect;
    }
  }

  // Fallback: stack downward until free.
  let y = Math.max(0, Math.min(bounds.h - size.h, preferred.y + preferred.h + 8));
  for (let i = 0; i < 20; i += 1) {
    const rect = {
      x: Math.max(0, Math.min(bounds.w - size.w, preferred.x)),
      y,
      w: size.w,
      h: size.h
    };
    const blocked = occupied.some((r) => intersects(r, rect));
    if (!blocked) {
      return rect;
    }
    y = Math.max(0, Math.min(bounds.h - size.h, y + size.h + 6));
  }

  return {
    x: Math.max(0, Math.min(bounds.w - size.w, preferred.x)),
    y: Math.max(0, Math.min(bounds.h - size.h, preferred.y)),
    w: size.w,
    h: size.h
  };
}

function renderHints(steps) {
  root.innerHTML = "";
  const occupied = [];
  const rootBounds = {
    w: root.clientWidth || window.innerWidth,
    h: root.clientHeight || window.innerHeight
  };
  steps.forEach((step) => {
    const bbox = step?.bbox;
    if (!bbox) {
      return;
    }

    const x = clamp01(Number(bbox.x));
    const y = clamp01(Number(bbox.y));
    const w = clamp01(Number(bbox.w));
    const h = clamp01(Number(bbox.h));
    if (w <= 0 || h <= 0) {
      return;
    }

    const action = String(step.action || "").toLowerCase();
    const isClick = action === "click" || action === "double_click";
    const isType = action === "type";

    let drawX = x;
    let drawY = y;
    let drawW = w;
    let drawH = h;

    // AI boxes can be loose; for click targets, render a tighter box around center.
    if (isClick) {
      const cx = x + w / 2;
      const cy = y + h / 2;
      drawW = Math.max(0.035, w * 0.45);
      drawH = Math.max(0.03, h * 0.45);
      drawX = clamp01(cx - drawW / 2);
      drawY = clamp01(cy - drawH / 2);
      if (drawX + drawW > 1) {
        drawX = 1 - drawW;
      }
      if (drawY + drawH > 1) {
        drawY = 1 - drawH;
      }
    }

    const box = document.createElement("div");
    box.className = `hint-box${isClick ? " click-target" : ""}`;
    box.style.left = `${drawX * 100}%`;
    box.style.top = `${drawY * 100}%`;
    box.style.width = `${drawW * 100}%`;
    box.style.height = `${drawH * 100}%`;
    const boxPx = {
      x: drawX * rootBounds.w,
      y: drawY * rootBounds.h,
      w: drawW * rootBounds.w,
      h: drawH * rootBounds.h
    };
    occupied.push(boxPx);

    const label = document.createElement("div");
    label.className = "hint-label";
    label.textContent = `${step.step}. ${step.target || step.action || "step"}`;
    box.appendChild(label);

    if (isClick) {
      const center = document.createElement("div");
      center.className = "hint-center";
      box.appendChild(center);
    }

    const detail = document.createElement("div");
    detail.className = "hint-detail";
    const confidencePct = Math.round(clamp01(Number(step.confidence)) * 100);
    const lines = [];
    if (step.instruction) {
      lines.push(step.instruction);
    }
    if (step.anchorText) {
      lines.push(`Match: "${step.anchorText}"`);
    }
    if (step.templateHint) {
      lines.push(`Hint: ${step.templateHint}`);
    }
    if (isType && step.textToType) {
      lines.push(`Type: ${step.textToType}`);
    }
    if (isType && step.howToGet) {
      lines.push(`Get it: ${step.howToGet}`);
    }
    lines.push(`Confidence: ${confidencePct}%`);
    detail.textContent = lines.join("\n");
    box.appendChild(detail);

    root.appendChild(box);
  });
}

window.overlayApi.onOverlayData((payload) => {
  renderHints(payload?.steps || []);
});
