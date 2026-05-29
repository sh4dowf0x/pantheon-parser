# Pantheon Parser

Experimental OCR combat parser for Pantheon.

## Quick Start

```powershell
npm install
npm run once
```

`npm run once` captures the configured screen region, saves `data/last-capture.png`, OCRs it, parses combat-looking lines, and writes events to `data/pantheon-events.sqlite`.

For a debug capture that does not write to the database:

```powershell
npm run debug:capture
```

For the normal combined app, which starts both live parsing and the dashboard:

```powershell
npm start
```

Or double-click:

```text
StartPantheonParser.bat
```

Then open:

```text
http://localhost:3107
```

For parser-only troubleshooting:

```powershell
npm run parser
```

For dashboard-only troubleshooting:

```powershell
npm run dashboard
```

Or double-click:

```text
StartPantheonDashboard.bat
```

The dashboard refreshes every 2 seconds and includes Damage/Healing, time range, and Players/All source filters.

For a one-shot region/OCR test, double-click:

```text
DebugCapture.bat
```

To capture the whole Pantheon window with a grid for region tuning:

```text
CalibrateCapture.bat
```

To select the exact combat-log rectangle with the mouse:

```text
SelectCaptureRegion.bat
```

The default capture mode is `autoCombatLog`, which targets the lower-right combat-log rectangle as a fixed ratio of the Pantheon client area.

To clear generated debug images/text:

```text
CleanDebugImages.bat
```

If you have multiple Pantheon clients open, the parser asks which one to use when it starts. You can also double-click:

```text
ListPantheonWindows.bat
```

Then copy the desired `Id` into `config.json` as `processId`.

Or pass it for one run:

```powershell
npm start -- --pid 91228
```

## Capture Region

Edit `config.json`.

The default targets the combat log by percentage inside the Pantheon window:

```json
"mode": "autoCombatLog",
"window": {
  "processName": "Pantheon",
  "processId": null,
  "titleContains": "Pantheon",
  "useClientArea": true
},
"autoCombatLog": {
  "x": 0.73,
  "y": 0.82,
  "width": 0.267,
  "height": 0.17
}
```

That means lower-right of the Pantheon window, aimed at the combat log by default. This keeps working if you move the Pantheon window around or change resolution while the UI scale/layout stays the same.

If you want exact pixels inside the Pantheon window, set:

```json
"mode": "windowAbsolute"
```

Then edit:

```json
"windowAbsolute": {
  "x": 900,
  "y": 620,
  "width": 800,
  "height": 360
}
```

Run `npm run debug:capture`, then open `data/last-capture.png` to see what OCR is reading. The raw OCR text is written to `data/last-ocr.txt`, and the selected window/crop details are written to `data/last-capture-meta.json`.

The live parser does not read old screenshot files; screenshots are only debug output. Debug captures overwrite `data/last-capture.png` by default and no longer accumulate timestamped copies. To delete the debug image immediately after OCR, set:

```json
"debug": {
  "keepCaptureImage": false,
  "keepTimestampedCaptures": false
}
```

During live mode, the parser prints a status line every 10 seconds showing the selected Pantheon PID, crop rectangle, OCR line count, combat-candidate count, and total inserted events. Set `"statusEveryMs": 0` in `config.json` to disable it.

If OCR keeps seeing the same visible combat-log lines across multiple captures, the parser suppresses repeats with:

```json
"dedupe": {
  "ttlMs": 120000,
  "maxEntries": 500,
  "ignoreInitialVisibleLines": true
}
```

`ttlMs` is how long a recognized combat line is remembered before an identical line can be inserted again.
When `ignoreInitialVisibleLines` is true, live mode treats the combat lines already visible at startup as backlog and waits for new lines before inserting events. `npm run once` still parses the current visible lines for debugging.
