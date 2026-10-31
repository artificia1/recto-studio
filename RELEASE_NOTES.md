## Recto Studio 1.2.4

### Editable mathematics

- **File → Insert Equation (LaTeX)** opens a live equation editor.
- Templates for quadratic formulas, integrals, sums, matrices, aligned equations and cases.
- Type size, colour, display/compact math style and accessible descriptions.
- Select an equation and choose **Properties → Edit equation** to revise it.
- Source survives save/reopen, undo/redo and duplication.
- Sharp vector PDF output and standalone SVG downloads, with bundled math glyphs.
- Works offline in the desktop app; no LaTeX installation or remote renderer required.

### Publishing fixes

- EPUB exports use accessible image descriptions and package equations as SVG assets.
- SVG artwork is identified as scalable vector content, avoiding false low-resolution warnings.
- Replacing equation artwork with a photo clears obsolete math metadata.

### InDesign import corrections

- INDD now offers an IDML conversion kit for your installed InDesign.
- Content recovery is explicitly labelled and requires confirmation before replacing a project.
- Recovery retains all detected fragments instead of fabricating original layouts or discarding later fragments.
- Binary files cannot silently enter the IDML importer as a simulated layout.
- See `INDESIGN_IMPORT.md` for workflow and limitations. Native standalone INDD decoding is not included.

Equations are separate layout objects. This release supports mathematical LaTeX
with base/AMS notation, not full `.tex` documents or inline story equations.
PDF math tagging and MathML are not included; equation vector colours are RGB.
See `EQUATIONS.md` for syntax, workflow and output details.

### Installation and updates

Users on **1.2.2 or 1.2.3** can choose **Check for updates → Install update**.
The updater downloads the package, saves pending work, and installs the update.

- Installer: `Recto-Studio-1.2.4-Windows-x64-setup.exe`
- Portable: `Recto-Studio-1.2.4-Windows-x64-portable.zip`

Windows x64 is supported. The installer can install WebView2 if needed; that
initial setup may require a connection. The portable app needs an existing
WebView2 runtime. No Node.js, npm or terminal is needed.

Update packages have updater signatures. The executable does not have a Windows
publisher certificate, so Windows may show a reputation warning. SHA-256
checksums are included with the release.
