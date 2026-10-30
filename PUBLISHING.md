# Publishing and export limitations

Recto exports ordinary PDFs, reflowable EPUB packages, HTML flipbooks, and ZIP
handoff packages. Review the output in its destination reader or printer workflow.

## PDF

- Clean PDF uses the document's trim dimensions. Print PDF adds configured bleed
  and a 14 mm slug for marks and calibration bars.
- Every exported page has MediaBox, TrimBox, and BleedBox coordinates. Print
  geometry is checked independently in portrait and landscape fixtures.
- Custom fonts are drawn as vector outlines. Their appearance survives without
  installed fonts, but the outlined text is not selectable or accessible text.
  Other fonts may fall back to the standard PDF families. See [fonts](FONTS.md).
- Color helpers produce process-color values and spot-color resources. Selecting
  a profile name does not embed an ICC profile or perform ICC color conversion.
  Images can retain RGB colors. Review separations, overprint, and transparency
  with the printer's preflight tools.
- Output is **not certified PDF/X, PDF/A, or PDF/UA**. Incomplete structure-tree
  declarations and unsupported conformance metadata are no longer emitted. Reading
  order overlays and accessibility preflight checks help editing but do not make
  the exported PDF accessible. Full tagging, font mapping, and conformance testing
  remain necessary.
- Export is page based; a spread-format option currently does not combine facing
  pages. Booklet and wrap-cover exports have separate implementations and need
  their own printer acceptance checks.

The CLI retains `--export pdf/x-1a` as a compatibility alias for print PDF settings;
the name does not imply certified output. The CLI reports that limitation.

## EPUB and HTML

EPUB export produces reflowable XHTML, navigation, styles, SVG graphics, and
embedded custom fonts. It does not preserve every canvas position or promise
fixed-layout output. Font distribution must be allowed by the font's license.
Images currently retain their source references: external URLs and browser-local
asset URLs may not work in another reader. Self-contained image packaging and
reader compatibility need further work. Languages default to English.

The EPUB archive puts its uncompressed `mimetype` first, including when custom
fonts are present. SVG elements use the SVG namespace and their content documents
declare the manifest `svg` property. These structural checks are not a replacement
for EPUBCheck or acceptance by a publishing platform.

Flipbooks contain HTML/CSS and reader interaction code. External image/font
references can still require a network connection. Test the exported file in the
browsers and hosting environment you intend to support.

ZIP handoff packages include the native project, print PDF, available embedded
image assets, and instructions. Packaging does not fetch every external linked
asset or establish printer readiness. The internal PDF is generated without
starting a separate PDF download.

## Reproduce validation

```sh
npm ci
npm test
python -m pip install pypdf==6.10.0
python scripts/validate-exports.py
npm run test:e2e
```

The engine tests write synthetic fixtures to ignored `test-results/export-validation/`.
The separate Python validator uses pypdf, the standard ZIP parser (including CRC
checks), and an XML parser to verify page boxes, orientation, text recovery,
manifest targets, navigation, spine references, SVG declarations, font presence,
and packaged PDF geometry. CI runs these checks before deployment. Browser tests
exercise actual downloads, font activation, editing, and file loading.

For local visual inspection, install `pypdfium2` and run the validator with
`--render`. Inspect the generated PNGs for clipping, misplaced marks, missing
glyphs, and unexpected blank pages. Synthetic fixtures do not establish correctness
for every publication, reader, operating system, or printer.

Format references: [W3C EPUB 3.3](https://www.w3.org/TR/epub-33/) and
[PDF Association's PDF/X requirements](https://pdfa.org/pdfx-the-key-facts/).

## Before a release

Resolve the dependency advisories previously reported for jsPDF/DOMPurify and
Vite through a dedicated update with regression checks. This export validation
does not remediate those advisories or certify the release's security.
