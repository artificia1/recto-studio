# Opening InDesign documents

## Editable layouts: IDML

Open the original document in a compatible, licensed InDesign installation,
then use **File → Export → InDesign Markup (IDML)**. Import that `.idml` file
in Recto Studio. This uses InDesign's actual document conversion, followed by
Recto's existing IDML parser. It does not require cloud upload or a conversion
subscription. If you do not have InDesign, ask the document creator for IDML.

When you choose an INDD file in Recto, its import dialog offers an **IDML
conversion kit**. Save and extract the ZIP. Copy `Recto-Export-IDML.jsx` into
InDesign's user Scripts Panel folder, open the source document in InDesign,
and run the script from **Window → Utilities → Scripts**. Choose a separate
IDML destination, then return to Recto and choose **Import converted IDML**.
The script exports the active document without saving or closing the source.

Recto imports supported IDML page geometry, objects, text and styles. It is
not a promise of pixel-identical rendering: fonts, linked image files, effects,
unsupported typography and other advanced features may need relinking or
manual review. Preserve the source and compare important pages and exports.

## Export back to IDML

The IDML export writes linked text frames as one story across spreads. Supported
paragraph styles, inline formatting, parent pages and parent inheritance, and
process-colour artwork round trip through Recto's importer. Install the intended
font faces in the receiving application. Verify the handoff in InDesign before
replacing a production document. Advanced effects, unsupported objects, arbitrary
spot swatch definitions, and exact InDesign composition still require review.

Editable single-contour Bézier artwork and supported linear and radial gradient
fills travel in both directions. Gradient stops retain their process CMYK values.
Check handoffs that use compound paths, special inks, custom gradient midpoints,
or skewed and non-uniformly scaled gradient frames in the receiving application.

Document layers carry their stacking order, names, visibility, locks, and
printing settings. Per-object nonprinting flags carry over too. Use the **Layers**
panel to include or exclude a whole layer from publication output while keeping
its artwork editable.

## Check a Recto export in InDesign

1. Choose **Export → InDesign Validation Kit** in Recto and extract the ZIP.
   The kit includes the IDML export and validation script. Gather any linked
   images and fonts for the handoff.
2. Copy [Recto-Validate-IDML.jsx](public/conversion/Recto-Validate-IDML.jsx) to
   InDesign's user Scripts Panel folder. The conversion kit also includes it.
3. Run the script in InDesign. Choose the Recto IDML file and a location for the
   results. InDesign opens the package, exports its own IDML, then reopens it.
4. Read `roundtrip-report.txt` and open `indesign-roundtrip.idml` in Recto for a
   return check. Compare the rendered pages before approving the handoff.

The report compares page geometry, parent pages, layers, stories and thread
counts, artwork bounds, styles, and swatches. It flags missing fonts and links.
Both temporary documents are closed without saving changes, and the output goes
into a new folder. These checks cover native serialization. Visual fidelity
requires comparing the pages against the source publication.

## INDD recovery is not layout import

The binary INDD database is not decoded by Recto. Its optional content-recovery
mode reads an embedded preview, XMP metadata and heuristic Latin text fragments.
It cannot determine the original page geometry, reading order, styles or object
positions. Text may be missing, duplicated, stale or incomplete.

Recovery requires an explicit choice to replace the current document. The
result is labelled **Recovered content** and uses A4 recovery workspaces,
not reconstructed original pages. All detected text fragments remain in a
single text story; overset content can be inspected and paginated normally.
The original INDD file is never modified. Save the current Recto project before
opening a recovery or another document. If recovery finds no text or preview,
the current project is preserved and an error explains the IDML route.

The previous implementation incorrectly described this fragment extraction
as native layout import and synthesized a few pages. That behaviour has been
removed. Standalone native INDD reconstruction is not implemented in 1.2.4.

References: [Adobe's IDML export format](https://developer.adobe.com/indesign/uxp/dom/api/e/export-format/)
and [running InDesign scripts](https://helpx.adobe.com/ca/indesign/desktop/automation-and-scripting/document-automation/automate-workflows-with-scripts.html).
