# Publishing and export limitations

Recto exports ordinary PDFs, reflowable EPUB packages, HTML flipbooks, and ZIP
handoff packages. Review the output in its destination reader or printer workflow.

## PDF

**Templates → Rosette ornaments** inserts bounded, repeating vector line art.
It is decorative artwork, not an authenticated security-printing feature.
Microprint, latent images, white-underbase separations and multi-depth embossing
dies require a separate printer-approved process; no such plates are generated.

Pages → Print production readiness reports live opacity, unsupported shadows,
spot-ink review and font-source risks, and saves a JSON report. Strict print
export blocks unsupported object shadows and CJK text without an embedded font
source. This is not a conformance validator or a guarantee of glyph coverage.

- Clean PDF uses the document's trim dimensions. Print PDF adds configured bleed
  and a 14 mm slug for marks and calibration bars.
- Every exported page has MediaBox, TrimBox, and BleedBox coordinates. Print
  geometry is checked independently in portrait and landscape fixtures.
- Custom fonts retain their shaped vector appearance. Supported static TTF files
  also supply embedded Unicode text for searching and selection; CFF and web-font
  inputs remain outline-only. This does not provide a tagged accessible PDF.
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
- Export is page based; unsupported spread output is rejected. Booklet and
  wrap-cover exports have separate implementations and need
  their own printer acceptance checks.

The CLI retains `--export pdf/x-1a` as a compatibility alias for print PDF settings;
the name does not imply certified output. The CLI reports that limitation.

## EPUB and HTML

Production EPUB export packages image originals, heading navigation, live
references, linked notes and backlinks. Set publication language and author under
Pages; provide image descriptions or explicitly mark decorative images. Reading
order can be set in Properties. These authoring controls do not guarantee reader
compatibility or complete accessibility. Publication fixtures are checked with
EPUBCheck; check each final book as well.

Production EPUB and print handoff packages block missing assets, broken references
and overset copy. Explicit draft exports can retain empty design placeholders.
Embedding linked images preserves the source bytes in the native project; relink
missing files before distributing it. External image retrieval can fail when a
server disallows access.

Browser and desktop PDF exports preserve supported SVG artwork as vectors.
Headless SVG output uses a 300 dpi rasterization capped at 20 megapixels.

EPUB export produces reflowable XHTML, navigation, styles, SVG graphics, and
embedded custom fonts. It does not preserve every canvas position or promise
fixed-layout output. Font distribution must be allowed by the font's license.
Production EPUB embeds resolved image bytes. External links must be reachable or
embedded first; unresolved links block production export. Reader compatibility
still needs checking. Set the publication language explicitly when appropriate.

The EPUB archive puts its uncompressed `mimetype` first, including when custom
fonts are present. SVG elements use the SVG namespace and their content documents
declare the manifest `svg` property. These structural checks are not a replacement
for EPUBCheck or acceptance by a publishing platform.

Flipbooks contain HTML/CSS and reader interaction code. External image/font
references can still require a network connection. Test the exported file in the
browsers and hosting environment you intend to support.

ZIP handoff packages include the native project, print PDF, resolved original
image assets, embedded fonts, and instructions. External images must be reachable
or embedded first; packaging does not establish printer readiness. The internal PDF is generated without
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

## Live object blending

**Properties → Object blend** provides Normal, Multiply, Screen and Overlay.
Canvas previews use object compositing; ordinary PDF output uses PDF 1.7 live
`/BM` graphics states, and flipbooks use CSS blending. Object opacity, including
zero, applies to PDF fills and strokes. Parent-master artwork uses the same
object renderer as page artwork. Pasteboard objects do not appear in publication
output.

These are per-object modes. Isolated layer/group compositing, transparency
flattening, blend-to-overprint conversion and certified PDF/X-4 output are not
implemented. Reflowable EPUB does not reproduce canvas blending. CMYK operators
and a PDF version number alone do not establish press readiness: review final
appearance and separations with the intended printer/RIP and colour workflow.

## PDF presets and publication reports

Pages → Production & books provides Screen, Desktop printing and Printer review
presets. Printer review includes bleed, crop marks and strict publication checks;
it does not certify PDF/X. A downloadable JSON report lists publication issues,
font use and headings. PDF/A, PDF/UA certification, output-intent color management
and a dedicated separations preview remain separate work.

Content-sized tables share their wrapped line and row layout between canvas and
PDF. PDF export stops if body rows cannot fit, repeated headers/footers exceed
a frame, or a linked continuation is excluded from publication. Add a
continuation page, resize the frame, or revise the row text before retrying.
Rows remain whole; no rows are automatically split across pages. As with other
text, install or embed the intended fonts before final output to avoid fallback
metrics. These safeguards apply to ordinary PDF as well as strict presets.

Pending manuscript revisions appear as preflight warnings. They do not change
the exported text until accepted. Review proposals and notes remain in saved
project files and book archives, not the publication artwork.

## Dependency checks

The project uses jsPDF 4.2.1, DOMPurify 3.4.17, and Vite 6.4.5 or their compatible
patched releases. The dependency audit was clean when these versions were adopted.
CI runs `npm audit --audit-level=moderate` so newly reported moderate, high, or
critical advisories block deployment. A clean package audit does not certify the
application or publication files as secure.
