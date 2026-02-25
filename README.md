# OnScreen AI Assistant

Desktop assistant with a floating always-on-top icon and transparent chat panel.

## Privacy behavior

- No continuous screen recording.
- Screen is captured only when the user clicks the bubble or `Capture Again`.

## Local development

```powershell
npm install
npm start
```

## Build Windows downloads

```powershell
npm run dist
```

Build artifacts are generated in `dist/`.

## Landing page

Open `landing/index.html` in a browser to show a simple download page.

## Browser extension mode (best prompt accuracy on webpages)

This mode sends a structured DOM element map (text + bounding boxes) from browser tab to the desktop app.

### 1. Load extension (Chrome/Edge/Brave)

1. Open browser extensions page (`chrome://extensions` or `edge://extensions`)
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select folder: `browser-extension/`

### 2. Use with app

1. Keep OnScreen AI Assistant running (it starts local bridge on `127.0.0.1:17333`)
2. Open target webpage in browser
3. Click extension icon -> **Send DOM Map**
4. Go back to assistant panel and run `Send` / `N`

The assistant now uses DOM map + OCR + UI tree and prioritizes DOM anchors for web pages.
