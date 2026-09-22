# Canvas Live Snapshot

> **Preserve the canvas as it appears now.**

Canvas Live Snapshot captures the currently rendered Obsidian Canvas for visual archiving. It copies rendered nodes, groups, computed styles and SVG connection paths into an HTML snapshot, then uses browser printing for PDF output.

For Advanced Canvas connections such as Straight, Squared and A*, the plugin copies the generated SVG paths rather than implementing their routing algorithms again. Supported webviews are captured as PNG images of the visible page at capture time, including the view associated with its current scroll position.

Snapshots are saved to Downloads and opened automatically. WYSIWYG is the design goal; actual fidelity depends on rendering, webview capture support and browser printing.

## Live Render Snapshot

```text
Obsidian + Advanced Canvas / current theme
                    ↓
        Already rendered Canvas view
                    ↓
       DOM + computed styles + SVG
          + supported webview PNGs
                    ↓
               HTML snapshot
                    ↓
           Browser print / PDF
```

Reusing the visual output reduces the need to reimplement third-party rendering rules. This is an architectural benefit, not proof of universal plugin compatibility.

- **Actual edge geometry:** copy the paths already generated for the current view. Theme and edge-style fidelity still require real-world validation.
- **Visible web content:** successful captures retain the visible frame and its current scroll view, not the full page, interactions or video history. Nodes are captured sequentially, not atomically at one instant.
- **Computed appearance:** copy actual element styles. Font files, pseudo-elements and special rendering layers may still differ or be missing.
- **Structured output:** ordinary text stays HTML and edges stay SVG; webview captures are raster images. Searchable or fully vector PDF output is not guaranteed for every element.
- **A shorter archive workflow:** save and open automatically, then confirm PDF output in the browser print dialog.

[中文说明](README.zh-CN.md)

## How it compares

These are workflow differences based on public project documentation, not measured fidelity or performance advantages.

| Project | Documented focus | This plugin's focus |
| --- | --- | --- |
| [Advanced Canvas](https://github.com/Developer-Mike/obsidian-advanced-canvas) | PNG / SVG export of the whole canvas or a selection, including transparency | An additional HTML snapshot and browser-print workflow, with supported webview capture |
| [Canvas HTML Exporter](https://community.obsidian.md/plugins/canvas-html-exporter) | Interactive HTML, search, zoom, folding and saved Advanced Canvas attributes | Snapshotting current rendered DOM / SVG for review and printing, without equivalent interactive navigation |
| [Canvas to PDF](https://github.com/2d3dtreasures/obsidian-canvas-to-pdf) | PDF and HTML exports, including searchable vector PDF output | Reusing current rendered edges and opening the HTML for browser printing; no direct PDF generation |

The distinctive combination is **current-view capture, supported webview freezing, and automatic saving and opening**. It is useful for preserving a review or presentation snapshot. For interactive publishing, unrendered-node coverage, batch conversion or direct PDF creation, evaluate tools dedicated to those needs. This plugin's visual fidelity has not yet been benchmarked against those projects.

## Features

- Export from the command palette or the left ribbon.
- Preserve computed node styles and rendered SVG connection paths.
- Attempt to embed images and CSS backgrounds, and freeze HTML canvas elements as PNG images.
- Capture embedded webviews with Electron's `capturePage()` when available.
- Save timestamped HTML files in the system Downloads directory without overwriting existing files.
- Automatically open the saved HTML with the system's default HTML application.
- Adjust the snapshot margin in settings.

## Installation

This release has not yet been published in the community directory.

For manual installation, download `main.js`, `manifest.json` and `styles.css` from a release and place them in `<vault>/.obsidian/plugins/canvas-live-snapshot/`. Restart Obsidian and enable **Canvas Live Snapshot** under **Settings → Community plugins**. If your vault uses a custom configuration folder, replace `.obsidian` accordingly.

## Export a canvas

1. Open the canvas you want to export and finish editing any text nodes.
2. Zoom to fit all nodes on screen. Wait for images and embedded pages to load.
3. Open the command palette and run **Canvas Live Snapshot: 导出当前 Canvas HTML 快照（用于打印 PDF）**, or click the export icon in the left ribbon. The current plugin interface is in Chinese.
4. Keep the canvas unchanged while the snapshot is being created.
5. The HTML file is saved to Downloads and opened automatically. Click **Print / Save PDF** in the exported page and select your browser's PDF destination.
6. Enable background graphics, disable headers and footers, and check the print preview before saving.

The plugin creates **HTML**, not a PDF file. PDF generation is handled by your browser. It requests a custom page size matching the snapshot, but very large canvases can exceed browser print limits.

## Settings and files

The settings page shows the output directory and lets you adjust the margin. The plugin prefers the OS Downloads path exposed by Electron; when unavailable it falls back to `Downloads` under your home directory. Previous vault-relative output settings are ignored.

Filenames include the canvas name and a timestamp. If a filename already exists, a numeric suffix is added. The original `.canvas` file is not modified.

## Compatibility and limitations

- Desktop only; no mobile support.
- Uses internal Canvas DOM structures, which can change between Obsidian versions.
- Captures nodes currently rendered in the DOM. Virtualized or unrendered nodes may be missing; fit the canvas to the viewport before exporting.
- Copies the current zoom level. Text may be small if the canvas is zoomed out substantially.
- Advanced Canvas is optional. Its special connections must already be rendered to be captured. This project is independent of Advanced Canvas.
- Ordinary cross-origin iframes cannot be frozen. Failed webview captures fall back to live iframes, which may be blocked by the embedded website or print differently.
- Images that cannot be embedded keep their original URLs and may not work offline or on another computer.
- Custom fonts, pseudo-elements, group borders and theme-specific effects may differ in the export.
- Automated syntax and mocked API tests have passed. Visual fidelity and PDF pagination have not yet been verified in a real Obsidian installation, and the minimum supported app version still requires validation before community submission.

## Troubleshooting

**The HTML opens in an editor:** Change the system's default application for `.html` files to your browser. Opening follows the system file association, which may differ from the default web browser.

**The file saved but did not open:** The notification includes the saved path. Open it manually; an opening error does not remove the exported file.

**Nodes are missing:** Fit the whole canvas on screen and wait for rendering to finish. Content not rendered by Obsidian cannot be captured by this snapshot workflow.

**Web content is blank:** Wait for it to load, then retry. Some webviews do not support capture, and some sites prevent iframe embedding.

**The PDF is clipped or spans multiple pages:** Check the preview and print settings. For oversized snapshots, export again at a smaller zoom level.

## Privacy, network and filesystem access

- No telemetry, ads, paid services or additional accounts are required to use the plugin.
- The plugin writes exported HTML **outside the vault, to the system Downloads directory**, and opens that file with the default HTML application.
- Exporting may fetch the image and background URLs already referenced by your canvas to embed those resources. There is no fixed remote service or export server.
- Unembedded resources and fallback iframes may contact their original sites when the exported HTML is opened. Embedded sites may have their own login requirements.
- Exported files contain visible canvas content and captured webview pixels. Review their contents before sharing them.

## Source and development

`main.js` is the readable CommonJS source loaded directly by Obsidian. No build step or bundled third-party JavaScript dependency is required. Do not edit the snapshot HTML by interpolating untrusted JavaScript.

## License and attribution

This project is released under the [MIT License](LICENSE). Copyright (c) 2026 a14174110-cloud.

Author: [a14174110-cloud](https://github.com/a14174110-cloud).
