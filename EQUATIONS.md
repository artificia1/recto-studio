# Equations

Use **File → Insert Equation (LaTeX)** to create mathematical artwork. Type or
paste LaTeX, or choose a template for a fraction, integral, sum, matrix, aligned
equations or a piecewise function. The preview updates while you type. Invalid
syntax disables insertion and leaves the document unchanged.

Choose a type size (6–144 pt), ink colour and display or compact math style.
Add a plain-language accessible description. **Insert equation** places a
scalable SVG frame on the selected object's page, or the first page of the
current spread. Move, resize, rotate, duplicate and wrap it like other images.
Select it and use **Properties → Edit equation** to revise its source. Edits
preserve the frame dimensions unless you enable **Resize frame to the equation's
natural size**. Undo, redo, local autosave and `.recto` files retain the source.
Replacing its artwork with a photo or PSD turns it into a regular image frame.

**Save SVG** exports the formula independently, with embedded glyph outlines.
No external font download or LaTeX installation is required. Math typesetting
and its fonts are bundled and work offline; the web app needs to have loaded
its equation module first.

## Syntax and output

- Mathematical LaTeX with the base and AMS packages: fractions, radicals,
  Greek letters, limits, matrices, `aligned`, `cases`, and related notation.
- Optional `$…$`, `$$…$$`, `\(…\)` and `\[…\]` delimiters are accepted.
- Up to 6,000 source characters per equation, with bounded macro expansion.
- PDF exports regenerate vector paths from the stored source. If an equation
  cannot render, the export reports an error instead of silently omitting it.
  Equation PDF export currently requires the desktop app or browser; headless
  command-line PDF export does not render equations yet.
  Paths use RGB colour; this feature does not certify PDF/X or CMYK output.
- EPUB preserves the SVG image and its accessible description. Actual reading
  and zoom behaviour depends on the EPUB reader. MathML and PDF math tagging
  are not generated in this release.
- Equations are separate layout objects, not inline story characters. Compact
  style changes math spacing; it does not insert math inside a paragraph.
- Full `.tex` document compilation, external packages, file commands, HTML and
  URL commands are not supported. Equation labels are not cross-references.

## Components

MathJax 3.2.2 supplies the self-contained TeX/SVG engine and bundled TeX outlines.
Its base and AMS packages are explicitly selected; runtime extension loading
is disabled. svg2pdf.js supplies vector PDF conversion. Both load on demand.
See `public/licenses/equations/` for third-party licence notices.
