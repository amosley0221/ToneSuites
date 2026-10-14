# Features

Generated from each module's menu inventory (`src/modules/*/menus.ts`) by `npm run features`.
Every command in the design exists in the app; this tracks which ones are fully working.

✅ done · 🟡 partial · ⬜ planned (listed in the menu, shows "on the roadmap" when used)

## Pixel

236 done · 3 partial · 280 planned

### File

- ✅ New… `Ctrl N`
- ✅ Open… `Ctrl O`
- ✅ Open recent…
- ✅ Browse folder as workspace…
- ✅ Open from NAS / Google Drive…
- **Import**
  - ✅ Place embedded…
  - ⬜ Place linked…
  - ⬜ From camera or phone…
  - ⬜ From scanner (TWAIN/WIA)…
  - ⬜ Video frames to layers…
  - ✅ Paste from clipboard
  - ✅ Import & place…
- **Export**
  - ✅ Export as… `Ctrl Shift E`
  - ✅ Quick export PNG `Ctrl Alt E`
  - ⬜ Save for web (legacy)…
  - ⬜ Layers to files…
  - ⬜ Artboards to files…
- **Automate**
  - ⬜ Batch…
  - ⬜ Photomerge (panorama)…
  - ⬜ Merge to HDR…
  - ⬜ Focus stack…
  - ⬜ Lens correction…
  - ⬜ Contact sheet…
  - ⬜ Crop and straighten photos
- **Scripts**
  - ⬜ Image processor…
  - ⬜ Export layers to files…
  - ⬜ Load files into stack…
  - ⬜ Statistics…
  - ⬜ Browse…
- ⬜ Print… `Ctrl P`
- ✅ Save `Ctrl S`
- ✅ Save as… `Ctrl Shift S`
- ✅ Save a copy… `Ctrl Alt S`
- ✅ Revert `F12`
- ✅ Convert & export… `Ctrl Shift E`
- ✅ File info… `Ctrl Alt Shift I`
- ✅ Close `Ctrl W`

### Edit

- ✅ Undo `Ctrl Z`
- ✅ Redo `Ctrl Shift Z`
- ✅ Toggle last state `Ctrl Alt Z`
- ⬜ Fade… `Ctrl Shift F`
- ✅ Cut `Ctrl X`
- ✅ Copy `Ctrl C`
- ✅ Copy merged `Ctrl Shift C`
- ✅ Paste `Ctrl V`
- **Paste special**
  - ✅ Paste in place `Ctrl Shift V`
  - ✅ Paste into `Ctrl Alt Shift V`
  - ⬜ Paste outside
- ✅ Clear `Del`
- ✅ Fill… `Shift F5`
- ⬜ Content-aware fill…
- ✅ Stroke…
- ⬜ Content-aware scale `Ctrl Alt Shift C`
- ⬜ Puppet warp
- ⬜ Perspective warp
- ✅ Free transform `Ctrl T`
- **Transform**
  - ⬜ Again `Ctrl Shift T`
  - ✅ Scale
  - ✅ Rotate
  - ⬜ Skew
  - ⬜ Distort
  - ⬜ Perspective
  - ⬜ Warp
  - ⬜ Split warp
  - ✅ Rotate 180°
  - ✅ Rotate 90° CW
  - ✅ Rotate 90° CCW
  - ✅ Flip horizontal
  - ✅ Flip vertical
- ⬜ Auto-align layers…
- ⬜ Auto-blend layers…
- ⬜ Sky replacement…
- ⬜ Define brush preset…
- ⬜ Define pattern…
- ⬜ Define custom shape…
- **Purge**
  - ✅ Histories
  - ✅ Clipboard
- ⬜ Color settings… `Ctrl Shift K`
- ⬜ Assign profile…
- ⬜ Convert to profile…
- ✅ Keyboard shortcuts…
- ⬜ Menus…
- ✅ Preferences…

### Image

- **Mode**
  - ⬜ Bitmap
  - ⬜ Grayscale
  - ⬜ Duotone
  - ⬜ Indexed color
  - ✅ RGB color ✓
  - ⬜ CMYK color
  - ⬜ Lab color
  - ⬜ Multichannel
  - ✅ 8 bits/channel ✓
  - ⬜ 16 bits/channel
  - ⬜ 32 bits/channel
  - ⬜ Color table…
- **Adjustments**
  - ✅ Brightness/Contrast…
  - ✅ Levels… `Ctrl L`
  - ✅ Curves… `Ctrl M`
  - ✅ Exposure…
  - ✅ Vibrance…
  - ✅ Hue/Saturation… `Ctrl U`
  - ✅ Color balance… `Ctrl B`
  - ✅ Black & white… `Ctrl Alt Shift B`
  - ✅ Photo filter…
  - ✅ Channel mixer…
  - ⬜ Color lookup (LUT)…
  - ✅ Invert `Ctrl I`
  - ✅ Posterize…
  - ✅ Threshold…
  - ✅ Gradient map…
  - ⬜ Selective color…
  - ⬜ Shadows/Highlights…
  - ⬜ HDR toning…
  - ✅ Desaturate `Ctrl Shift U`
  - ⬜ Match color…
  - ⬜ Replace color…
  - ✅ Equalize
- ✅ Auto tone `Ctrl Shift L`
- ✅ Auto contrast `Ctrl Alt Shift L`
- ✅ Auto color `Ctrl Shift B`
- ✅ Image size… `Ctrl Alt I`
- ✅ Canvas size… `Ctrl Alt C`
- **Image rotation**
  - ✅ 180°
  - ✅ 90° clockwise
  - ✅ 90° counter clockwise
  - ✅ Arbitrary…
  - ✅ Flip canvas horizontal
  - ✅ Flip canvas vertical
- ✅ Crop
- ✅ Trim…
- ✅ Reveal all
- ✅ Duplicate…
- ⬜ Apply image…
- ⬜ Calculations…
- **Variables**
  - ⬜ Define…
  - ⬜ Data sets…
- ⬜ Apply data set…
- ⬜ Trap…
- **Analysis**
  - ⬜ Set measurement scale
  - ⬜ Ruler tool
  - ⬜ Count tool
  - ⬜ Record measurements
  - ⬜ Place scale marker…

### Layer

- **New**
  - ✅ Layer… `Ctrl Shift N`
  - ✅ Group…
  - ⬜ Artboard…
  - ✅ Layer via copy `Ctrl J`
  - ✅ Layer via cut `Ctrl Shift J`
  - ✅ Background from layer
- ✅ Duplicate layer…
- **Delete**
  - ✅ Layer
  - ✅ Hidden layers
- ✅ Rename layer…
- **Layer style**
  - ✅ Blending options…
  - ⬜ Bevel & emboss…
  - ✅ Stroke…
  - ⬜ Inner shadow…
  - ⬜ Inner glow…
  - ⬜ Satin…
  - ✅ Color overlay…
  - ⬜ Gradient overlay…
  - ⬜ Pattern overlay…
  - ✅ Outer glow…
  - ✅ Drop shadow…
  - ✅ Copy layer style
  - ✅ Paste layer style
  - ✅ Clear layer style
  - ⬜ Global light…
  - ⬜ Create layers
  - ⬜ Scale effects…
- **Smart filter**
  - ⬜ Disable smart filters
  - ⬜ Clear smart filters
- **New fill layer**
  - ✅ Solid color…
  - ⬜ Gradient…
  - ⬜ Pattern…
- **New adjustment layer**
  - ✅ Brightness/Contrast…
  - ✅ Levels…
  - ✅ Curves…
  - ✅ Exposure…
  - ✅ Vibrance…
  - ✅ Hue/Saturation…
  - ✅ Color balance…
  - ✅ Black & white…
  - ✅ Photo filter…
  - ✅ Channel mixer…
  - ⬜ Color lookup…
  - ✅ Invert
  - ✅ Posterize…
  - ✅ Threshold…
  - ✅ Gradient map…
  - ⬜ Selective color…
- ✅ Layer content options…
- **Layer mask**
  - ✅ Reveal all
  - ✅ Hide all
  - ✅ Reveal selection
  - ✅ Hide selection
  - ✅ From transparency
  - ✅ Delete
  - ✅ Apply
  - ✅ Enable / disable
  - ⬜ Unlink
  - ⬜ Select & mask…
- **Vector mask**
  - ⬜ Reveal all
  - ⬜ Hide all
  - ⬜ Current path
  - ⬜ Delete
  - ⬜ Enable / disable
  - ⬜ Link / unlink
- ⬜ Create clipping mask `Ctrl Alt G`
- **Smart objects**
  - ⬜ Convert to smart object
  - ⬜ Convert to linked…
  - ⬜ Edit contents
  - ⬜ Replace contents…
  - ⬜ Reset transform
  - ⬜ Export contents…
  - ⬜ Embed linked
  - ⬜ Update modified content
  - ⬜ Rasterize
  - **Stack mode**
    - ⬜ Median
    - ⬜ Mean
- **Video layers**
  - ⬜ New video layer from file…
- **Rasterize**
  - ✅ Type
  - ✅ Shape
  - ✅ Fill content
  - ⬜ Vector mask
  - ⬜ Smart object
  - ✅ Layer style
  - ✅ Layer
  - ✅ All layers
- ⬜ New layer-based slice
- ✅ Group layers `Ctrl G`
- ✅ Ungroup layers `Ctrl Shift G`
- ✅ Hide layers
- **Arrange**
  - ✅ Bring to front `Ctrl Shift ]`
  - ✅ Bring forward `Ctrl ]`
  - ✅ Send backward `Ctrl [`
  - ✅ Send to back `Ctrl Shift [`
  - ✅ Reverse
- **Combine shapes**
  - ⬜ Unite
  - ⬜ Subtract front
  - ⬜ Intersect
  - ⬜ Exclude overlap
- **Align**
  - ✅ Left edges
  - ✅ Horizontal centers
  - ✅ Right edges
  - ✅ Top edges
  - ✅ Vertical centers
  - ✅ Bottom edges
- **Distribute**
  - ⬜ Horizontal centers
  - ⬜ Vertical centers
- ✅ Lock layers…
- ⬜ Link layers
- ⬜ Select linked layers
- ✅ Merge down `Ctrl E`
- ✅ Merge visible
- ✅ Flatten image
- **Matting**
  - ⬜ Color decontaminate
  - ⬜ Defringe…
  - ⬜ Remove black matte
  - ⬜ Remove white matte

### Type

- ⬜ Add fonts…
- **Panels**
  - ✅ Character
  - ✅ Paragraph
  - ⬜ Glyphs
  - ⬜ Character styles
  - ⬜ Paragraph styles
- **Anti-alias**
  - ⬜ None
  - ⬜ Sharp
  - ⬜ Crisp
  - ⬜ Strong
  - ✅ Smooth ✓
  - ⬜ Windows LCD
  - ⬜ Windows
- **Orientation**
  - ✅ Horizontal ✓
  - ⬜ Vertical
- **OpenType**
  - ⬜ Standard ligatures ✓
  - ⬜ Contextual alternates
  - ⬜ Discretionary ligatures
  - ⬜ Swash
  - ⬜ Oldstyle figures
  - ⬜ Stylistic alternates
  - ⬜ Titling alternates
  - ⬜ Ornaments
  - ⬜ Fractions
  - ⬜ Ordinals
  - **Stylistic sets**
    - ⬜ Set 1
- ⬜ Create work path
- ⬜ Convert to shape
- ✅ Rasterize type layer
- ⬜ Convert to paragraph text
- ⬜ Warp text…
- ⬜ Match font…
- **Font preview size**
  - ⬜ Small
  - ⬜ Large
- **Language options**
  - ⬜ Default (Latin)
- ✅ Update all text layers
- ⬜ Replace all missing fonts
- ⬜ Resolve missing fonts…
- ✅ Paste lorem ipsum
- ⬜ Load default type styles
- ⬜ Save default type styles

### Select

- ✅ All `Ctrl A`
- ✅ Deselect `Ctrl D`
- ✅ Reselect `Ctrl Shift D`
- ✅ Inverse `Ctrl Shift I`
- ⬜ All layers `Ctrl Alt A`
- ⬜ Deselect layers
- ⬜ Find layers `Ctrl Alt Shift F`
- ⬜ Isolate layers
- 🟡 Color range…
- ⬜ Focus area…
- ⬜ Subject
- ⬜ Sky
- ⬜ Select & mask… `Ctrl Alt R`
- **Modify**
  - ✅ Border…
  - ✅ Smooth…
  - ✅ Expand…
  - ✅ Contract…
  - ✅ Feather… `Shift F6`
- ✅ Grow
- ✅ Similar
- ⬜ Transform selection
- ⬜ Edit in quick mask mode
- ✅ Load selection…
- ✅ Save selection…

### Filter

- ✅ Last filter `Ctrl Alt F`
- ⬜ Convert for smart filters
- ✅ Filter gallery…
- ⬜ Adaptive wide angle… `Ctrl Alt Shift A`
- ⬜ Camera RAW filter… `Ctrl Shift A`
- ⬜ Lens correction… `Ctrl Shift R`
- ⬜ Liquify… `Ctrl Shift X`
- ⬜ Vanishing point… `Ctrl Alt V`
- **Blur**
  - ✅ Average
  - ✅ Blur
  - ✅ Blur more
  - ✅ Box blur…
  - ✅ Gaussian blur…
  - ⬜ Lens blur…
  - ✅ Motion blur…
  - ⬜ Radial blur…
  - ⬜ Shape blur…
  - ⬜ Smart blur…
  - ⬜ Surface blur…
- **Blur gallery**
  - ⬜ Field blur…
  - ⬜ Iris blur…
  - ⬜ Tilt-shift…
  - ⬜ Path blur…
  - ⬜ Spin blur…
- **Distort**
  - ⬜ Displace…
  - ⬜ Pinch…
  - ⬜ Polar coordinates…
  - ⬜ Ripple…
  - ⬜ Shear…
  - ⬜ Spherize…
  - ⬜ Twirl…
  - ⬜ Wave…
  - ⬜ ZigZag…
- **Noise**
  - ✅ Add noise…
  - ✅ Despeckle
  - ✅ Dust & scratches…
  - ✅ Median…
  - ⬜ Reduce noise…
- **Pixelate**
  - ✅ Color halftone…
  - ⬜ Crystallize…
  - ⬜ Facet
  - ⬜ Fragment
  - ⬜ Mezzotint…
  - ✅ Mosaic…
  - ⬜ Pointillize…
- **Render**
  - ⬜ Flame…
  - ⬜ Picture frame…
  - ⬜ Tree…
  - ✅ Clouds
  - ⬜ Difference clouds
  - ⬜ Fibers…
  - ⬜ Lens flare…
  - ⬜ Lighting effects…
- **Sharpen**
  - ⬜ Shake reduction…
  - ✅ Sharpen
  - ⬜ Sharpen edges
  - ✅ Sharpen more
  - ⬜ Smart sharpen…
  - ✅ Unsharp mask…
- **Stylize**
  - ⬜ Diffuse…
  - ✅ Emboss…
  - ⬜ Extrude…
  - ✅ Find edges
  - ✅ Oil paint…
  - ✅ Solarize
  - ⬜ Tiles…
  - ⬜ Trace contour…
  - ⬜ Wind…
- **Video**
  - ⬜ De-interlace…
  - ⬜ NTSC colors
- **Other**
  - ⬜ Custom…
  - ✅ High pass…
  - ⬜ HSB/HSL
  - ✅ Maximum…
  - ✅ Minimum…
  - ✅ Offset…
- ⬜ AI filters (optional — needs a model)

### View

- **Proof setup**
  - ⬜ Custom…
  - ⬜ Working CMYK
  - ⬜ Working cyan plate
  - ⬜ Working magenta plate
  - ⬜ Working yellow plate
  - ⬜ Working black plate
  - ⬜ Internet standard RGB (sRGB)
  - ⬜ Monitor RGB
  - ⬜ Color blindness — protanopia
  - ⬜ Color blindness — deuteranopia
- ⬜ Proof colors `Ctrl Y`
- ⬜ Gamut warning `Ctrl Shift Y`
- **Pixel aspect ratio**
  - ✅ Square ✓
- ⬜ 32-bit preview options…
- ✅ Zoom in `Ctrl +`
- ✅ Zoom out `Ctrl -`
- ✅ Fit on screen `Ctrl 0`
- ✅ Fit layer(s) on screen
- ✅ 100% `Ctrl 1`
- ✅ 200%
- ✅ Print size
- ✅ Flip horizontal
- ⬜ Pattern preview
- **Screen mode**
  - ✅ Standard ✓
  - ⬜ Full screen with menu bar
  - ⬜ Full screen
- ✅ Extras `Ctrl H`
- **Show**
  - ✅ Layer edges
  - ✅ Selection edges
  - ⬜ Target path `Ctrl Shift H`
  - ✅ Grid `Ctrl '`
  - ✅ Guides `Ctrl ;`
  - ⬜ Canvas guides
  - ⬜ Artboard guides
  - ⬜ Count
  - ⬜ Smart guides
  - ⬜ Slices
  - ⬜ Notes
  - ✅ Pixel grid
  - ✅ Brush preview
  - ⬜ Mesh
  - ⬜ Edit pins
  - ✅ All
  - ✅ None
- ✅ Rulers `Ctrl R`
- ✅ Snap `Ctrl Shift ;`
- **Snap to**
  - ✅ Guides
  - ⬜ Grid
  - ⬜ Layers
  - ⬜ Slices
  - ✅ Document bounds
  - ✅ All
  - ✅ None
- ✅ Lock guides `Ctrl Alt ;`
- ✅ Clear guides
- ⬜ Clear canvas guides
- ✅ New guide…
- ⬜ New guide layout…
- ✅ New guides from shape
- ⬜ Lock slices
- ⬜ Clear slices

### Window

- **Arrange**
  - ⬜ Tile all vertically
  - ⬜ Tile all horizontally
  - ⬜ 2-up horizontal
  - ⬜ 2-up vertical
  - ⬜ Consolidate all to tabs
  - ⬜ Match zoom
  - ⬜ Match location
  - ⬜ New window for this document
- **Workspace**
  - ✅ Essentials ✓
  - ⬜ Photography
  - ⬜ Painting
  - ⬜ Graphic & web
  - ⬜ Motion
  - ✅ Reset Essentials
  - ⬜ New workspace…
- 🟡 Actions `Alt F9`
- ✅ Adjustments
- ✅ Brush settings `F5`
- ✅ Brushes
- ✅ Channels
- ✅ Character
- ⬜ Character styles
- ⬜ Clone source
- ✅ Color `F6`
- ⬜ Comments
- ⬜ Glyphs
- ⬜ Gradients
- ⬜ Histogram
- ✅ History
- ⬜ Info `F8`
- ⬜ Layer comps
- ✅ Layers `F7`
- ⬜ Measurement log
- ⬜ Navigator
- ⬜ Notes
- ✅ Paragraph
- ⬜ Paragraph styles
- 🟡 Paths
- ⬜ Patterns
- ✅ Properties
- ⬜ Shapes
- ✅ Styles
- ✅ Swatches
- ⬜ Timeline (frame & video)
- ⬜ Tool presets
- ✅ Options
- ✅ Tools
- ✅ Tone Sync (replaces Libraries)

### Help

- ✅ Command palette `Ctrl K`
- ✅ Keyboard shortcuts
- ✅ What's new
- ✅ Check for updates…
- ⬜ Tone Pixel help
- ✅ About Tone
- ⬜ Photoshop → Pixel migration guide
- ⬜ System info…

## Cells

94 done · 1 partial · 23 planned

### File

- ✅ New… `Ctrl N`
- ✅ Open… `Ctrl O`
- ✅ Open recent…
- ✅ Browse folder as workspace…
- ✅ Open from NAS / Google Drive…
- ✅ Import CSV / TSV as new sheet…
- ✅ Import sheets from Excel workbook…
- ⬜ Share…
- ⬜ Page setup…
- ⬜ Print… `Ctrl P`
- ✅ Save `Ctrl S`
- ✅ Save as… `Ctrl Shift S`
- ✅ Save a copy… `Ctrl Alt S`
- ✅ Revert `F12`
- ✅ Convert & export… `Ctrl Shift E`
- ✅ File info… `Ctrl Alt Shift I`
- ✅ Close `Ctrl W`

### Edit

- ✅ Undo `Ctrl Z`
- ✅ Redo `Ctrl Y`
- ✅ Cut `Ctrl X`
- ✅ Copy `Ctrl C`
- ✅ Paste `Ctrl V`
- ✅ Paste values only `Ctrl Shift V`
- ✅ Fill down `Ctrl D`
- ✅ Fill right `Ctrl R`
- **Clear**
  - ✅ Contents
  - ✅ Formats
  - ✅ All
- ✅ Find & replace… `Ctrl F`
- ✅ Go to cell… `Ctrl G`
- ✅ Select all `Ctrl A`

### View

- **Freeze**
  - ✅ Top row
  - ✅ First column
  - ✅ At selection
  - ✅ Unfreeze panes
- ✅ Gridlines
- ✅ Show formulas `Ctrl ``
- ✅ Zoom in `Ctrl =`
- ✅ Zoom out `Ctrl -`
- ✅ Actual size
- ⬜ Split panes
- ⬜ Full screen

### Insert

- ✅ Rows above
- ✅ Rows below
- ✅ Columns left
- ✅ Columns right
- ✅ Delete rows
- ✅ Delete columns
- ✅ New sheet `Shift F11`
- ✅ Chart…
- ✅ Pivot table…
- ✅ AutoSum `Alt =`
- ⬜ Image…
- ⬜ Link…
- ⬜ Note
- ⬜ Checkbox
- ⬜ Sparkline

### Format

- ✅ Bold `Ctrl B`
- ✅ Italic `Ctrl I`
- ✅ Underline `Ctrl U`
- ✅ Strikethrough
- **Number**
  - ✅ General
  - ✅ Number  1,234.00
  - ✅ Integer  1,234
  - ✅ Currency  $ 1,234.00
  - ✅ Percent  0.00%
  - ✅ Date  2026-01-31
  - ✅ Date & time
  - ✅ Text
  - ✅ Increase decimals
  - ✅ Decrease decimals
- **Align**
  - ✅ Left
  - ✅ Center
  - ✅ Right
- ✅ Wrap text
- ✅ Merge cells
- ✅ Unmerge cells
- **Borders**
  - ✅ All borders
  - ✅ Outside borders
  - ✅ Bottom border
  - ✅ No borders
- ✅ Conditional formatting…
- ✅ Clear formatting
- ✅ Column width…
- ✅ Row height…
- ✅ Autofit column width
- **Sheet**
  - ✅ Rename…
  - ✅ Duplicate
  - ✅ Delete
  - ✅ Move left
  - ✅ Move right
- ⬜ Table styles…

### Data

- ✅ Sort A → Z
- ✅ Sort Z → A
- ⬜ Sort range (multiple keys)…
- ✅ Filter `Ctrl Shift L`
- ✅ Clear filters
- ✅ Pivot table…
- ✅ Remove duplicate rows
- ✅ Trim whitespace
- ⬜ Split text to columns…
- ⬜ Data validation…
- ⬜ Named ranges…
- ⬜ Refresh external data

### Tools

- ✅ Recalculate now
- 🟡 Function list…
- ⬜ Goal seek…
- ⬜ Solver…
- ⬜ Trace precedents
- ⬜ Protect sheet…
- ⬜ Spelling
- ⬜ Scripts…

### Help

- ✅ Command palette `Ctrl K`
- ✅ Keyboard shortcuts
- ✅ What's new
- ✅ Check for updates…
- ⬜ Tone Cells help
- ✅ About Tone

## Deck

76 done · 4 partial · 26 planned

### File

- ✅ New… `Ctrl N`
- ✅ Open… `Ctrl O`
- ✅ Open recent…
- ✅ Browse folder as workspace…
- ✅ Open from NAS / Google Drive…
- ✅ Import outline (.toneoutline)…
- ⬜ Import PowerPoint (.pptx)…
- **Export as**
  - ✅ PDF…
  - ✅ PowerPoint (.pptx)…
  - ✅ Current slide as PNG…
  - ✅ Outline (.md)…
  - ⬜ Video (.mp4)…
- ⬜ Slide size…
- ⬜ Print handouts… `Ctrl P`
- ✅ Save `Ctrl S`
- ✅ Save as… `Ctrl Shift S`
- ✅ Save a copy… `Ctrl Alt S`
- ✅ Revert `F12`
- ✅ Convert & export… `Ctrl Shift E`
- ✅ File info… `Ctrl Alt Shift I`
- ✅ Close `Ctrl W`

### Edit

- ✅ Undo `Ctrl Z`
- ✅ Redo `Ctrl Y`
- ✅ Cut `Ctrl X`
- ✅ Copy `Ctrl C`
- ✅ Paste `Ctrl V`
- ✅ Duplicate `Ctrl D`
- ✅ Delete `Del`
- ✅ Select all `Ctrl A`
- ✅ Deselect
- ⬜ Find… `Ctrl F`
- ⬜ Replace… `Ctrl H`

### View

- ✅ Normal
- ✅ Animation timeline
- ✅ Speaker notes
- ✅ Zoom to fit `Ctrl 0`
- ✅ Default zoom
- ⬜ Slide sorter
- ⬜ Guides & grid
- ⬜ Rulers

### Insert

- **New slide**
  - ✅ Title
  - ✅ Title + content
  - ✅ Two column
  - ✅ Image full bleed
  - ✅ Section header
  - ✅ Blank
- ✅ New slide (same layout) `Ctrl M`
- 🟡 Text box
- ✅ Image…
- **Shape**
  - ✅ Rectangle
  - ✅ Ellipse
  - ✅ Line
- 🟡 Table
- ⬜ Chart…
- ⬜ Embed…
- ⬜ Video…
- ⬜ Audio…
- ⬜ Link…

### Slide

- ✅ New slide
- ✅ Duplicate slide
- ✅ Delete slide
- **Layout**
  - ✅ Title
  - ✅ Title + content
  - ✅ Two column
  - ✅ Image full bleed
  - ✅ Section header
  - ✅ Blank
- ✅ Masters & layouts…
- **Transition**
  - ✅ None
  - ✅ Fade
  - ✅ Push
  - 🟡 Morph
  - ✅ Apply to all slides
- ✅ Animate selection
- ✅ Present from start `F5`
- ✅ Present from current slide `Shift F5`
- ✅ Presenter view `Alt F5`
- 🟡 Rehearse timings
- ⬜ Presenter view in second window
- ⬜ Record narration…

### Arrange

- ✅ Bring to front `Ctrl Shift ]`
- ✅ Bring forward `Ctrl ]`
- ✅ Send backward `Ctrl [`
- ✅ Send to back `Ctrl Shift [`
- **Align**
  - ✅ Left
  - ✅ Center
  - ✅ Right
  - ✅ Top
  - ✅ Middle
  - ✅ Bottom
- ⬜ Distribute
- ⬜ Group `Ctrl G`
- ⬜ Ungroup `Ctrl Shift G`
- ⬜ Rotate
- ⬜ Lock

### Tools

- ⬜ Spelling…
- ⬜ Check accessibility…
- ⬜ Compress media…
- ⬜ Preview morph
- ✅ Preview animations

### Help

- ✅ Command palette `Ctrl K`
- ✅ Keyboard shortcuts
- ✅ What's new
- ✅ Check for updates…
- ⬜ Tone Deck help
- ✅ About Tone

## Write

91 done · 2 partial · 10 planned

### File

- ✅ New… `Ctrl N`
- ✅ Open… `Ctrl O`
- ✅ Open recent…
- ✅ Browse folder as workspace…
- ✅ Open from NAS / Google Drive…
- ✅ Page setup…
- ⬜ Print… `Ctrl P`
- ✅ Save `Ctrl S`
- ✅ Save as… `Ctrl Shift S`
- ✅ Save a copy… `Ctrl Alt S`
- ✅ Revert `F12`
- ✅ Convert & export… `Ctrl Shift E`
- ✅ File info… `Ctrl Alt Shift I`
- ✅ Close `Ctrl W`

### Edit

- ✅ Undo `Ctrl Z`
- ✅ Redo `Ctrl Y`
- ✅ Cut `Ctrl X`
- ✅ Copy `Ctrl C`
- 🟡 Paste `Ctrl V`
- 🟡 Paste as plain text `Ctrl Shift V`
- ✅ Select all `Ctrl A`
- ✅ Find… `Ctrl F`
- ✅ Replace… `Ctrl H`

### View

- ✅ Zoom in `Ctrl =`
- ✅ Zoom out `Ctrl -`
- ✅ Actual size
- ✅ Fit page width
- ✅ Review pane
- ✅ Outline & inspector
- ✅ Focus mode
- **Markup**
  - ✅ All markup
  - ✅ No markup (final)
  - ✅ Original

### Insert

- ✅ Image…
- ✅ Table
- ✅ Link…
- ✅ Footnote…
- ✅ Table of contents…
- ✅ Update table of contents
- ✅ Page break `Ctrl Enter`
- ✅ Horizontal rule
- ✅ Comment… `Ctrl Alt M`
- ✅ Date
- ⬜ Equation
- ⬜ Symbol…

### Format

- **Style**
  - ✅ Body `Ctrl Alt 0`
  - ✅ Title
  - ✅ Heading 1 `Ctrl Alt 1`
  - ✅ Heading 2 `Ctrl Alt 2`
  - ✅ Heading 3 `Ctrl Alt 3`
  - ✅ Quote
  - ✅ Code block
- ✅ Bold `Ctrl B`
- ✅ Italic `Ctrl I`
- ✅ Underline `Ctrl U`
- ✅ Strikethrough `Ctrl Shift X`
- ✅ Inline code
- ✅ Highlight
- **Align**
  - ✅ Left `Ctrl L`
  - ✅ Center `Ctrl E`
  - ✅ Right `Ctrl R`
  - ✅ Justify `Ctrl J`
- **Line spacing**
  - ✅ Single
  - ✅ 1.15
  - ✅ 1.5
  - ✅ Double
  - ✅ Default (1.65)
- **Lists**
  - ✅ Bulleted list `Ctrl Shift 8`
  - ✅ Numbered list `Ctrl Shift 7`
  - ✅ Increase indent `Ctrl ]`
  - ✅ Decrease indent `Ctrl [`
- **Table**
  - ✅ Insert row above
  - ✅ Insert row below
  - ✅ Insert column left
  - ✅ Insert column right
  - ✅ Delete row
  - ✅ Delete column
  - ✅ Delete table
  - ✅ Merge cells
  - ✅ Split cell
  - ✅ Toggle header row
- ✅ Clear formatting `Ctrl Space`
- ⬜ Edit styles…

### Review

- ✅ Track changes on / off
- ✅ Accept next change
- ✅ Reject next change
- ✅ Accept all changes
- ✅ Reject all changes
- ✅ New comment…
- ✅ Delete all comments
- ✅ Word count…
- ⬜ Compare documents…

### Tools

- ✅ Word count…
- ⬜ Spelling & grammar… `F7`
- ⬜ Language…
- ⬜ Mail merge…
- ⬜ Macros…

### Help

- ✅ Command palette `Ctrl K`
- ✅ Keyboard shortcuts
- ✅ What's new
- ✅ Check for updates…
- ⬜ Tone Write help
- ✅ About Tone

## Paper

72 done · 1 partial · 20 planned

### File

- ✅ New… `Ctrl N`
- ✅ Open… `Ctrl O`
- ✅ Open recent…
- ✅ Browse folder as workspace…
- ✅ Open from NAS / Google Drive…
- ✅ Create blank PDF
- ✅ Merge files…
- ✅ Insert pages from file…
- ✅ Split…
- ✅ Extract pages…
- 🟡 Save compressed copy…
- ✅ Export page as PNG…
- ✅ Convert to Write document
- ⬜ Print… `Ctrl P`
- ✅ Save `Ctrl S`
- ✅ Save as… `Ctrl Shift S`
- ✅ Save a copy… `Ctrl Alt S`
- ✅ Revert `F12`
- ✅ Convert & export… `Ctrl Shift E`
- ✅ File info… `Ctrl Alt Shift I`
- ✅ Close `Ctrl W`

### Edit

- ✅ Undo `Ctrl Z`
- ✅ Redo `Ctrl Shift Z`
- ✅ Find… `Ctrl F`
- ✅ Find next `F3`
- ✅ Find previous `Shift F3`
- ✅ Add text box
- ✅ Whiteout
- ⬜ Edit existing text
- ⬜ Edit image
- ✅ Delete selected annotation
- ✅ Remove all annotations

### View

- ✅ Zoom in `Ctrl =`
- ✅ Zoom out `Ctrl -`
- ✅ Actual size (680 px) `Ctrl 0`
- ✅ Fit width
- ✅ Fit page
- ✅ Page thumbnails
- ⬜ Two-page view
- ⬜ Bookmarks panel
- ✅ First page
- ✅ Previous page
- ✅ Next page
- ✅ Last page
- ✅ Go to page… `Ctrl G`

### Page

- ✅ Rotate clockwise `Ctrl R`
- ✅ Rotate counter-clockwise `Ctrl Shift R`
- ✅ Delete page
- ✅ Insert blank page after
- ✅ Move page up
- ✅ Move page down
- ✅ Organize pages… `Ctrl Shift O`
- ✅ Insert from file…
- ✅ Extract pages…
- ✅ Split document…
- ⬜ Crop pages…
- ⬜ Header & footer…
- ⬜ Watermark…
- ⬜ Bates / page numbers…

### Tools

- **Annotate**
  - ✅ Pen
  - ✅ Sticky note
  - ✅ Stamp
- **Highlight**
  - ✅ Highlight text
  - ✅ Highlight area
  - ✅ Strikethrough
- **Sign**
  - ✅ Draw / type signature…
  - ✅ Place signature
  - ⬜ Request signature by email
  - ⬜ Certificate (digital ID) signature
- **Fill form**
  - ✅ Fill form fields
  - ✅ Form builder…
  - ⬜ Auto-fill from profile
  - ✅ Flatten form on save
- **Redact**
  - ✅ Mark for redaction
  - ✅ Search & redact…
  - ✅ Apply redactions
- ⬜ Recognize text (OCR)…
- ✅ Convert & export…
- ⬜ Compare files…
- ⬜ Measure

### Protect

- ⬜ Encrypt with password…
- ⬜ Permissions…
- ⬜ Remove security
- ✅ Mark for redaction
- ✅ Apply redactions
- ✅ Save copy without metadata…
- ⬜ Certify with digital ID…

### Help

- ✅ Command palette `Ctrl K`
- ✅ Keyboard shortcuts
- ✅ What's new
- ✅ Check for updates…
- ⬜ Tone Paper help
- ✅ About Tone

---

Total: 569 done · 11 partial · 359 planned
