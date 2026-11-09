# Working with fonts

Select a text frame, open Typography in the Properties inspector, and click the
font import area or drop a font file on it. TTF, OTF, WOFF, and WOFF2 are supported.
The font's internal name is used in the picker, including its face/style name.
Choose individual font files for bold and italic faces.

Imported font bytes are saved with the project and restored when it is opened.
Only share or redistribute embedded fonts when their license permits it.
Each imported file is limited to 32 MB. Invalid files and fonts the browser cannot
activate show an error and are not added as installed fonts.

The normal PDF exporter subsets supported TrueType and CFF OpenType faces in text
frames, master text, footnotes and tables. Embedded CID fonts include Unicode
mappings for search and copying. Shaped runs that need different visual and logical
ordering use outlines with a searchable Unicode layer where the font covers the
characters. Embedding and subsetting permissions still apply. Use the accessible
preset when the PDF also needs a semantic structure tree.
Custom outline paragraphs currently use left, center, or right placement; full
justification and tracking need further work.
Specialized cover and imposition exporters retain their existing text handling.

EPUB packages include font files and font declarations. Flipbooks embed font data.
Reader/browser support and font licensing still apply. EPUB readers may override
publisher fonts in their own settings.

Google Fonts load over the network and are refreshed after loading. System and
Google font names alone do not provide font bytes for offline sharing or faithful
PDF export: import the corresponding font file for that purpose.

Check glyph coverage for each language in the publication. Bitmap-only or
colour emoji fonts, Mac DFONT suitcases, and legacy Type 1 and EOT files have
limited support. Use an individual TTF or OTF face when a file fails to load.

Imported variable fonts expose their advertised axes under **Properties → Variable
font axes**. Sliders preview the face live; Apply creates a named instance used by
layout measurements, browser rendering and PDF export. Coordinates persist in
the project and in EPUB/flipbook font CSS. Optical size is manual when an `opsz`
axis exists. Bold/italic flags do not choose axis coordinates automatically.
Variable TrueType and CFF2 instances embed static, unhinted subsets at the chosen
axes. CFF2 retains the cubic outlines in a CID-keyed CFF program with Unicode
mappings. Colour-only fonts still need separate handling. Each applied instance
stores a copy of the source font bytes.

For static TrueType and CFF OpenType faces that permit embedding and prohibit
subsetting, supported PDF exports keep the complete font program. Standalone
TrueType uses the original sfnt bytes. CFF uses the untouched CFF table from
OTF, WOFF, or WOFF2, including its original glyphs, hints and subroutines. Name-keyed CFF uses searchable
single-byte encodings that share the same program. CID-keyed CFF uses its
original CID mapping. CFF2 and variable TrueType require a static instance when
subsetting is permitted.

For TTC and OTC collections, choose a face in the font picker. Recto stores the
selected face as a standalone font in the project, including its original
glyphs, variation tables, and embedding flags. Each input collection can be up
to 32 MiB.

Open **Links → Document fonts & replacement** to audit font references, import a
licensed TTF/OTF/WOFF/WOFF2 source, and replace a family throughout the document.
The audit includes paragraph and character styles, master text, tables, text on
paths and formatted runs. Counts are font references, not unique frames. A system
font may display locally while its source file remains unavailable for export.

Replacement reflows stories and reports overset frames. Undo restores font
choices; save/reopen preserves imported sources. Review line endings and page
count after substitution: a different face is not guaranteed to have matching
metrics. Recto does not activate Adobe Fonts or extract protected commercial font
files. Obtain font files or suitable replacements through your licensing workflow.
