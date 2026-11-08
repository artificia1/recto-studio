# Working with fonts

Select a text frame, open Typography in the Properties inspector, and click the
font import area or drop a font file on it. TTF, OTF, WOFF, and WOFF2 are supported.
The font's internal name is used in the picker, including its face/style name.
Choose individual font files for bold and italic faces.

Imported font bytes are saved with the project and restored when it is opened.
Only share or redistribute embedded fonts when their license permits it.
Each imported file is limited to 32 MB. Invalid files and fonts the browser cannot
activate show an error and are not added as installed fonts.

The normal PDF exporter uses the font's shaped vector outlines for imported fonts
in text frames, master text, footnotes, and tables. This preserves appearance for
TrueType and CFF outlines, including compressed web-font inputs. Outlined text is
supplemented with searchable Unicode text for supported static TTF faces whose
embedding permissions allow it. CFF, WOFF and WOFF2 retain outline-only output.
Neither path is a substitute for a tagged accessible PDF.
Custom outline paragraphs currently use left, center, or right placement; full
justification and tracking need further work.
Specialized cover and imposition exporters retain their existing text handling.

EPUB packages include font files and font declarations. Flipbooks embed font data.
Reader/browser support and font licensing still apply. EPUB readers may override
publisher fonts in their own settings.

Google Fonts load over the network and are refreshed after loading. System and
Google font names alone do not provide font bytes for offline sharing or faithful
PDF export: import the corresponding font file for that purpose.

No font contains every Unicode character. Missing glyphs, bitmap-only/color emoji
fonts, font collections (TTC/OTC/DFONT), legacy Type 1/EOT fonts, and unusual font
formats are not universally supported. Export an individual TTF/OTF face when
necessary.

Imported variable fonts expose their advertised axes under **Properties → Variable
font axes**. Sliders preview the face live; Apply creates a named instance used by
layout measurements, browser rendering and PDF outlines. Coordinates persist in
the project and in EPUB/flipbook font CSS. Optical size is manual when an `opsz`
axis exists. Bold/italic flags do not choose axis coordinates automatically.
PDF variable instances remain outlined, with no claim of searchable variable-font
embedding. Reader support still varies. Each applied instance currently stores a
copy of the source font bytes; avoid creating large numbers of instances in a book.

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
