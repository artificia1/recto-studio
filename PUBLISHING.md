# Publishing and export limitations

Recto exports ordinary and tagged PDFs, PDF/UA-1 editions, PDF/X candidates, reflowable EPUB packages, HTML flipbooks, and ZIP
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
- Supported CFF OpenType, TrueType and selected-axis variable TrueType fonts embed
  as searchable subsets. The accessible preset requires an embeddable face with
  Unicode coverage for the publication. See [fonts](FONTS.md) for format limits.
  Other fonts may fall back to the standard PDF families. See [fonts](FONTS.md).
- Import a CMYK printer output ICC profile under Setup → ICC colour management
  and enable PDF conversion to transform supported sRGB raster assets and vector
  colours with LittleCMS WASM. The profile bytes are embedded as an OutputIntent.
  A profile name alone still performs no conversion. Explicit CMYK values retain
  their ink values; unknown-source CMYK JPEGs are rejected during conversion.
- Output is **not externally certified PDF/X, PDF/A, or PDF/UA**. The PDF/X
  candidates and PDF/UA-1 edition have distinct checks and limitations below.
  The ordinary tagged screen preset does not declare PDF/UA conformance.
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

These are per-object modes. Isolated layer/group compositing and automatic
blend-to-overprint conversion are not implemented. Reflowable EPUB does not reproduce canvas blending. CMYK operators
and a PDF version number alone do not establish press readiness: review final
appearance and separations with the intended printer/RIP and colour workflow.

## PDF presets and publication reports

Pages → Production & books provides tagged screen, accessible PDF/UA-1, desktop
printing, printer review, flattened CMYK and two PDF/X candidate presets.
Printer review includes bleed, crop marks and strict publication checks;
it does not certify PDF/X. A downloadable JSON report lists publication issues,
font use and headings. Setup → Separations preview samples current artwork,
allows plate toggling and highlights total ink coverage over the chosen threshold.
This display proof is not a RIP separation proof. PDF/A is not implemented.

Content-sized tables share their wrapped line and row layout between canvas and
PDF. PDF export stops if body rows cannot fit, repeated headers/footers exceed
a frame, or a linked continuation is excluded from publication. Add a
continuation page, resize the frame, or revise the row text before retrying.
Rows remain whole by default. Enable **Split rows across frames** in Table
continuation to split ordinary rows at complete text lines. Source text is
retained when continuation widths differ. Vertical merges are available with
**Merge cell down**; merged groups stay together and must fit a frame. A merge
cannot cross header/body/footer boundaries. As with other
text, install or embed the intended fonts before final output to avoid fallback
metrics. These safeguards apply to ordinary PDF as well as strict presets.

Pending manuscript revisions appear as preflight warnings. They do not change
the exported text until accepted. Review proposals and notes remain in saved
project files and book archives, not the publication artwork.

## Print flattening and PDF/X candidates

The flattened preset renders transparency regions with PDF.js at 300 dpi, converts
the opaque pixels to the selected CMYK output profile and retains original vectors
outside those regions using non-overlapping clipping bands. It does not rasterize
every page. Curves remain cubic vectors outside flattened regions. Export guards
bound memory and job size; supported resolution is 150–600 dpi through the API.

Use embeddable fonts so the renderer does not substitute fonts. Raster
regions composite onto white paper. Shadows that the exporter cannot reproduce,
annotations, and spot inks intersecting transparency regions stop the export.
PDF.js rendering and the ICC conversion do not establish exact RIP equivalence;
compare overprints, blends and colour appearance in the intended printer workflow.
Fluorescent, metallic, white-ink and substrate-specific printing need a separate proof.

**PDF/X-1a:2003 candidate** uses this flattener, an ICC v2 output profile and
PDF 1.4 with classic cross-reference tables. **PDF/X-4 candidate** uses PDF 1.6,
preserves live transparency and supplies a CMYK page blending space. Both embed
PDF/X identification metadata and require embedded fonts, nested page boxes,
converted process colours, no interactive annotations and a CMYK output profile.
SVG/equation artwork must be supplied as an sRGB raster for these conservative
process-colour presets; ordinary PDF retains supported SVG vectors.

These gates are not a complete ISO validator. The export result exposes
`pressReport` with `certified: false` and `independentValidationRequired: true`.
Have the final file checked with a dedicated PDF/X preflight tool and approved by
the printer. veraPDF does not validate PDF/X. Passing a synthetic fixture or
writing identification metadata does not establish GWG certification; see the
[GWG conformance process](https://gwg.org/resources/ghent-pdf-output-suite/conformance-certification/).

**Process-colour trapping** spreads lighter opaque fills into adjacent darker
fills using polygon offsets and intersections in physical millimetres. It applies
only to closed, unstroked process-colour fills. Intervening artwork is excluded,
and traps exceeding the TAC limit are omitted with a warning. This is not a full
RIP trapping engine for text, photographs, spot inks or transparent artwork.
Confirm width and ink behaviour with the printer. The PDF remains `/Trapped /False`
because this partial operation does not establish that the entire file is trapped.

## Accessible PDF/UA-1 editions

The accessible preset writes a structure tree with semantic H1–H6 headings,
paragraphs, lists (`L`, `LI`, `Lbl`, `LBody`), notes, image descriptions and table
rows/cells (`Table`, `TR`, `TH`, `TD`, scope and merge spans). Split rows retain
one logical cell; repeated headers are artifacts after their first occurrence.
Page backgrounds, running furniture and decorative graphics are artifacts.
Shaped outlines are accompanied by embedded Unicode text and ActualText.

Apply paragraph styles with the intended PDF tag, starting headings at H1 without
skipping levels. For lists, use the List item tag and type the bullet or number
as part of the paragraph. Import embeddable TrueType or OpenType fonts covering every used
character. Set title/language, describe meaningful images and choose content-sized
table rows. The whole publication is exported; interactive links/forms are blocked
until annotation tagging is supported. PDF/UA-2 needs a separate PDF 2.0 pipeline
and is not offered.

CI validates one-page, linked-table, CFF and variable TrueType fixtures with **veraPDF 1.30.3 / PDF/UA-1**.
This checks machine-verifiable requirements, not whether a description is useful,
the reading order makes sense, or assistive technology delivers a good experience.
Review each publication with a screen reader and an accessibility checklist.
Do not treat the export as a legal compliance certificate.

To repeat the independent checks after `npm test`, install Java 17 or newer:

```sh
python scripts/install-verapdf.py
VERAPDF_HOME="$PWD/test-results/validators/verapdf" python scripts/validate-accessible-pdf.py
```

The installer is downloaded from the official site and checked against a pinned
SHA-256. It stays in ignored test output and is not shipped with the app.

## Editions and headless batches

Open **Pages → Production & books → Publication editions** to create editions
and select the ones to include in PDF or EPUB output. Assign an edition to a
selected object there, or use **Paragraph edition** in Story Editor for the
paragraph at the cursor. Use paragraph editions inside a linked story. The export
recomposes the selected copy without changing the source document.

`recto render` writes one PDF per record from the whole template. The data source
can be a local JSON array, CSV, or standard input. Use `--preset pdfx4` to prepare
PDF/X-4 candidates, and repeat `--edition` to include more than one edition.

```sh
node bin/recto.js render catalog.recto --data records.json --output catalogs
psql --no-psqlrc --csv -c 'SELECT name, product FROM catalog' | node bin/recto.js render catalog.recto --data - --output catalogs
```

Use a read-only PostgreSQL role for the query. Database connections stay with
`psql`. Render accepts up to 10,000 records and 4 MiB of input data, and requires
a new output directory. It publishes the completed batch and manifest together.

For custom data formats, `--importer ./adapter.mts` selects a trusted local
TypeScript or JavaScript module. Export a default object implementing
`DatasetImporterV1` from `bin/plugin-api.d.ts`. Its `parseRecords` method receives
the input bytes and filename and returns records of scalar fields. These modules
run with the CLI's permissions. Use modules you trust.

## Proof review and production references

Open **Pages → Production & books → Compare proofs**. Download a clean review
PDF, then load it alongside a revised or annotated copy. The comparison lists
text, artwork, page-size and page-count changes by physical position. The selected
page can show both previews or highlight changed pixels. The scan uses bounded
previews, so fine details still need a full-resolution review. Export a JSON
comparison report to keep a record of the page checks.

Import text-bearing PDF comments from the revised proof. Recto places a note
automatically when its page matches uniquely in the original proof, revised proof
and current publication. Unmatched notes are retained under **Review notes** and
can be placed manually. The two PDFs are processed locally. Reviews are limited
to 75 MiB and 500 pages per PDF.

**Printer profiles** save reusable bleed, image-resolution, ink and ICC
requirements in the local editor. An active profile checks both document and
book PDFs. Resolution checks use available source dimensions. Ink checks cover
explicit CMYK values, and raster, blend and converted-ink limits need a final
printer proof.

Select an image or the first frame of a table, then open **Contents, notes &
references → Numbered caption**. Figures and tables number separately in each
section, including chapters assembled into a book. Insert a live reference from
Story Editor, and generate lists of figures or tables from the same Pages panel.

## Moving a publication from Scribus

Open **File → Import Scribus Document** and choose an `.sla` or `.sla.gz`
saved with Scribus 1.6. Review the import report before opening the project,
then save it as `.recto`. Recto brings over editable text and supported text
threads, parent page assignments, layers, basic shapes and single-contour Bézier
paths. Linked images come in as empty frames with their filenames so you can
relink them from files you choose. Recto reads the document locally and leaves
external file paths untouched.

Check the report for skipped objects and simplified formatting. Facing spreads
open as individual pages. Mixed trims, asymmetric bleed, and per-page margins
are normalized to document settings. Check fonts, line breaks and overset after
opening. Import supports 500 pages, 5,000 objects and 32 MiB of expanded XML.

Scribus 1.6 linear and circular radial fills carry over with editable stops when
they use opaque process colours and extend the endpoint colours. The report
flags unsupported fill settings. Edit compatible fills in **Properties →
Gradient fill**. Use **Convert to editable path** to turn a basic shape into
Bézier nodes while retaining its frame, fill and stroke.

PDF export writes the fills as CMYK vector shadings and uses the selected ICC
output profile for RGB stops when conversion is active. IDML and the HTML
flipbook also carry supported fills. Check the print proof before production.

Press export checks that the embedded CMYK output intent matches the selected
profile byte for byte. It also checks nested PDF artwork and patterns for
unmanaged RGB operators and missing font programs. Use the printer's supplied
preflight profile to validate the delivered PDF, then use the Ghent Output Suite
to exercise the production RIP and press workflow.

## Reusing artwork and navigating PDFs

Select independent artwork, then use **Templates → Artwork library → Save
selection**. Use **Place** to insert a new editable copy on the chosen page at
the page margins. Copies keep their internal stacking and grouping. Download
and import `.recto-artwork` entries to share them between devices. Use direct
formatting and embedded PNG, JPEG or WebP artwork for portable entries.

Tagged screen and accessible PDFs include a nested bookmark list generated
from the publication headings. Each bookmark opens the page that contains its
heading. In a tagged export of a subset of the document, the bookmark list
contains the headings on those exported pages.

## Dependency checks

The project uses jsPDF 4.2.1, DOMPurify 3.4.17, and Vite 6.4.5 or their compatible
patched releases. The dependency audit was clean when these versions were adopted.
CI runs `npm audit --audit-level=moderate` so newly reported moderate, high, or
critical advisories block deployment. A clean package audit does not certify the
application or publication files as secure.
