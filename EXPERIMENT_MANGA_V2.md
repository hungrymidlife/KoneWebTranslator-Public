# KoneWebTranslator manga experiment — independent branch


## Integrated experimental changes
0. Full ZIP pixel/metadata comparison: `local-trans/experiment_compare.py`
1. CTD mask-aware Phase1 and overlapping tiled Phase2 in live OCR: `detector_vendor/`
2. Manga reading order for homogeneous vertical/horizontal boxes: `region_reading_order.py`; mixed order preserved
3. Existing segmentation-driven LaMa mask plus editable source mask; all originals immutable
4. Mask brush editing, exact original-pixel restoration on erasure, bounded added-mask-only LaMa ROI: `experiment_mask_roi.py`, Studio editor
5. Dynamic-programming Korean balanced line breaks constrained by existing bubble-safe rectangle: `smart_linebreak.py`, existing bubble layout
6. Backend Pillow proof preview from same `Project.render_image` as final save (before JPEG/WebP recompression)
7. 80-step Undo/Redo of layer edits, opt-in bold/color markup, original+clean+Korean raster PSD layers

## Real ZIP translation test
**Not yet run here.** Requires user's Windows models and local Gemma/Hayai services.
1. On a separate experimental worktree, start Studio, Hayai and translation server.
2. Drag an original manga ZIP onto `EXPERIMENT_RUN_ZIP.bat`. If you also have a translated ZIP from main, pass it as the second argument.
3. Script writes `kwt_experiment_results/<zip>_<date>/` with translated ZIP, metadata, report, diagnostic ZIP.
4. The original ZIP is never overwritten; main code is never changed.
5. Open the experimental Studio to inspect LaMa mask brush, accurate Pillow preview, PSD export and rich spans.

These features are included in the published source; validate generated ZIP files locally. Differences in pixel values alone are not ground truth for Korean translation accuracy.

## Automated tests
`python -m unittest discover -s tests -p "test_*experiment*.py" -v`
`python -m unittest discover -s tests -p "test_smart_linebreak.py" -v`
`cd studio && npm ci && npm run build`
The Python tests use synthetic in-memory images. Full ZIP translation is only available when real model weights and servers are present.

## Known limitations
- Phase1/2 are experimental and can increase CPU inference time, not guaranteed to improve every page.
- Rich text syntax: **bold** and [[color:#ff0000]]color[[/color]], enabled per edited layer; the Konva drag preview is plain but Pillow proof is styled.
- PSD text layer is rasterized, movable but not a native Photoshop Type Tool layer.
- Partial LaMa can show seams on complex art; inspect affected areas before promotion.


## Mask & PSD stability hotfix (2026-10-29)
- Cross-origin source/mask images now use authenticated CORS fetch + Blob URL in Studio, preventing tainted-canvas getImageData() errors.
- PSD export now writes atomically to `<result ZIP stem>_psd_layers/NNNN_<page>.psd` beside the completed translated ZIP and reports the absolute path in the Studio UI.
- PSD text remains a raster layer, not native Photoshop text. These features are included in the current public source.

## Native Photoshop text companion
Every exported raster PSD now also writes a companion `NNNN_<page>.jsx` in the same
folder. In Photoshop, choose File > Scripts > Browse and select the JSX. It
opens the PSD, hides its Korean raster layer, and generates editable Type Tool
layers from the saved OCR/translation layout. Save As a new PSD. Text font and
rich-span fidelity depend on Photoshop fonts; raster PSD is the reference.

## Phase 2–7 final implementation supplement
- Segmentation-derived line boxes are stored as OCR metadata; separated lines are
  sent to Hayai once per line, falling back to the original full-region OCR.
- Speech bubble variable-width layout stores exact text row coordinates, with
  conservative rectangle fallback. Studio and PSD replay those saved rows.
- The draggable edit canvas uses a debounced Pillow-rendered proof as its page
  background; Konva is now used for hitboxes/transforms and temporary drag text.
- Mask brush edits support local undo/redo (Ctrl+Z/Ctrl+Y) before applying LaMa.
- PSD export saves the raster PSD plus optional Photoshop JSX that generates native
  editable Korean Type Tool layers when executed in Photoshop.
- Automatic end-to-end ZIP translation with actual Windows models is not verified
  in this environment. Test the translated ZIPs with the installed Windows models before redistribution.

## Fullscreen comparison and per-layer manual editing (2026-10-29)

- Fullscreen toolbar has an **original image toggle**. ON shows Japanese source on
  the left and Korean editing canvas on the right; OFF restores the single canvas.
  The toggle is also available in the toolbar's overflow menu on narrow windows.
- Each selected text region has its own **Pillow sync** checkbox (default ON).
  Turning OFF that ONE region excludes it from the server's composite PNG proof,
  displays it using draggable Konva text, disables automatic bubble-shape reflow
  and automatic font-fitting, and respects manually entered line breaks.
  Other regions still use the Pillow proof and remain unchanged.
- Click an existing region, then drag the small round grip just past the
  **top-right corner** to rotate. The standard Transformer rotation handle and
  degree input are also available. Handles are now six screen pixels wide.
- Region rotation is in degrees (clockwise positive), about the bbox center,
  stored in the .studio_edits.json sidecar and rendered when saving the ZIP/PSD.
- The **exact save preview** always includes all regions: this is intentional
  so manual layouts show the final Pillow output. Konva manual edit glyph metrics
  can differ from Pillow; switch to exact preview before saving when necessary.
- New regression: `python -m unittest discover -s tests -p test_experiment_editor_rotation.py -v`.
- These features are included in the current public source. Windows Tauri full integration still requires testing.
