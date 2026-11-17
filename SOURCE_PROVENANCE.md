# Source provenance

Recto Studio was created by **Abhinav Sidhu**. The root [MIT license](LICENSE)
credits Abhinav Sidhu and Recto Studio Contributors. Third-party fonts,
libraries, and generated assets retain their accompanying notices.

Generate a per-file attribution manifest for any source commit with
`node scripts/source-provenance.mjs <commit-or-tag> > source-provenance.json`.
Omit the revision to use `HEAD`. The manifest identifies every tracked file,
including binary assets and configuration, by path and Git object ID. It records
the repository and project credit alongside those entries. The source files and
their upstream notices retain their original bytes.

Production builds disable standalone browser source maps and strip debug
information from the desktop executable. The public repository and
distributable artifacts can still be inspected.
