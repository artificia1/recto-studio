# Manuscript compilation

Compile a Markdown or DOCX manuscript into an editable Recto project, a reader-order interior PDF, a PNG proof, and a JSON report. The compiler uses Recto's manuscript importer and layout engine with mirrored margins, heading styles, running heads, folios, and widow and orphan settings.

```sh
npm ci
npm run cli -- compile recipe.json --workspace examples/manuscript
```

The example uses a short original manuscript. Its output folder must be new. For comparison, set `previousPdf` to an earlier reader-order PDF and set `proofPage` to the page to inspect. The report includes a changed-pixel count when the rendered pages share dimensions. Check page identities after repagination.

## Offset printing

Set `pagesPerSignature` to 4, 8, 16, or 32. The compiler appends the smallest number of blank pages needed for complete signatures and writes `signature-plan.json` with two-up front and back ordering. Set `targetSignatures` to require a specific count. If the text does not fit that count, the compiler reports the measured page count for review. The printer supplies the sheet specification and creep allowance.

Set `sheetProof` to `true` to inspect the order in an imposed PDF using the reader-order interior's vector pages. Keep the reader-order PDF for delivery unless the printer has supplied its own sheet requirements. The sheet proof clips to trim and uses zero creep.

`paperSpec.caliperMm` is the measured thickness of one paper leaf. The report estimates text-block thickness from the final leaf count, including padding. GSM and finish describe the stock. Use the printer's cover template for binding allowances.

The default PDF preset is `press`. To request `pdfx1a` or `pdfx4`, set `printResources` to a Recto project with the intended embedded typeface and CMYK output profile. Verify PDF/X candidates in your independent preflight tool and submit a reader-order interior or printer-approved imposition as specified by your printer.

## Docker

```sh
docker build -t recto-compile .
docker run --rm -v "$PWD/examples/manuscript:/workspace" recto-compile compile recipe.json
```

The mounted workspace needs write access for the container user. The same image can run `mcp --workspace /workspace --allow-write` over stdio.

## GitHub Actions

Use the same recipe in CI. The example assumes the author repository contains `recipe.json` and that its output folder is named `edition`. Use the commit SHA of Recto Studio you have tested in place of the action reference for reproducible runs.

```yaml
name: Book proof
on: [push]
permissions:
  contents: read
jobs:
  proof:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: artificia1/recto-studio@main
        with:
          recipe: recipe.json
      - uses: actions/upload-artifact@v4
        with:
          name: book-proof
          path: edition/
          if-no-files-found: error
```

MCP clients use the recipe fields directly in `recto_compile_publication`. Writes require the server's existing `--allow-write` flag. For a physical proof, send the compiled interior and a printer-approved cover to the chosen service after reviewing its trim, page-count, binding, and submission requirements.

## Proof handoff

`recto_plan_publication` measures an edition without writing files. After compilation, use `recto_inspect_delivery_pdf` to check boxes, fonts, and ICC profiles or `recto_compare_pdf_proofs` to compare selected pages in two PDFs. All three operations use the selected workspace.

The compiler writes `printer-handoff.json` with the final interior checksum, trim, page budget, and stock information. With Poppler installed, run `python scripts/check-manuscript-edition.py edition` to independently check the checksum, page count, and every page's trim. The repository's headless delivery workflow applies this check to editions produced by the GitHub Action and the Docker image.

Use `recto_locate_pdf_text` to find selectable text after pagination changes. Pass the PDF path and a quote. The response includes the file checksum, physical page numbers, normalized text-fragment bounds, and a highlighted PNG of the first match. Scan results can be paged with `nextPage`. A scanned PDF needs an OCR text layer for this tool.

Use `recto_locate_pdf_text` to find selectable text after pagination changes. Pass the PDF path and a quote. The response includes the file checksum, physical page numbers, normalized text-fragment bounds, and a highlighted PNG of the first match. Scan results can be paged with `nextPage`. A scanned PDF needs an OCR text layer for this tool.
