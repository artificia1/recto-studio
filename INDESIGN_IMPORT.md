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
