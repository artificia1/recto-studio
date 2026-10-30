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
not selectable/searchable and is not a substitute for accessible PDF text.
Custom outline paragraphs currently use left, center, or right placement; full
justification, tracking, and selectable font embedding need further work.
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
necessary. Variable fonts use their default instance; there are no axis controls yet.
