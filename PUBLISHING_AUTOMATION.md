# Recto MCP · Local publishing automation

Recto Studio’s optional Model Context Protocol server uses the same local
publishing engines as the editor. It communicates over standard input and output.
The web editor and desktop application do not launch or connect to it.

## Start the server

From a Recto Studio source checkout, use Node.js 24 and run `npm ci` once. In
your MCP client’s local server settings, set the executable to Node and give it
the full path to `bin/recto.js`. Pass the path to a folder containing copies of the
publications, datasets, and assets you want to share with that client.

```json
{
  "mcpServers": {
    "recto": {
      "command": "node",
      "args": [
        "/absolute/path/to/recto-studio/bin/recto.js",
        "mcp",
        "--workspace",
        "/absolute/path/to/publishing-workspace"
      ]
    }
  }
}
```

Use an absolute Node executable path if your client cannot find it. On Windows,
use forward slashes (for example, `C:/Publishing/Recto Projects`) or JSON-escaped
backslashes in the configuration. Tool paths inside that folder are relative
and use forward slashes, for example `catalogs/autumn.recto`.

To verify the executable from your source checkout, run
`node bin/recto.js mcp --help`. After restarting or reloading the configured
client, ask it to call `recto_available_features` to verify the connection.

The default connection allows inspection and previews. Add `"--allow-write"`
as the last argument to enable drafts, exports, document creation, and profile
files. Writes require fresh names and an existing parent directory. Originals
stay in place. The server does not expose an HTTP endpoint, fetch remote photos,
or run plugins, shell commands, or document scripts. Your MCP host receives
the text and metadata returned by tools. Use a dedicated workspace and a
trusted host for confidential publications.

## Try it on a publication

Start with a `.recto` file in the configured workspace. With the default
read-only connection, ask your client:

> Inspect page 4 of `magazine.recto` and run print preflight. If a story is
> overset, preview reducing the story’s tracking by 5 thousandths of an em.
> Show me what clears and what remains.

With `--allow-write` enabled, review the preview and ask:

> Save that preview as `magazine-proof.recto`, then export the draft with the
> `print` preset to `magazine-proof.pdf`. Report any export warnings.

For batch work, use a saved template with `{{field}}` placeholders:

> Render `program.recto` once per record in `speakers.csv`. Use the `photo`
> column for workspace-relative speaker photos, output a new `proofs` folder,
> and tell me how many PDFs were written.

## Workflows

| Workflow | Tools |
| --- | --- |
| Find a physical page, frame, style, or story | `recto_inspect_publication`, `recto_read_spread`, `recto_read_story` |
| Preview and save edits | `recto_preview_story_edit`, `recto_preview_layout_edit`, `recto_save_draft` |
| Start a document or convert a file | `recto_create_publication`, `recto_import_publication` (IDML and Scribus) |
| Translate a publication | `recto_export_publication` with `xliff`, `recto_preview_translation`, `recto_save_draft` |
| Check or deliver a publication | `recto_run_preflight`, `recto_compile_pdf`, `recto_export_publication` (EPUB, fixed-layout EPUB, IDML, XLIFF) |
| Render a personalized catalog | `recto_render_batch` with CSV or a JSON array |
| Review and export a book interior | `recto_inspect_book`, `recto_compile_book` |
| Share an editor theme | `recto_appearance`, `recto_save_appearance` |

**Story edits.** Read the uncomposed story and work with its UTF-16 offsets and
exact expected text. A replacement preserves formatting outside the edited
range and rejects edits through protected note, index, and reference markers.
Tracking is signed thousandths of an em. For example, `-5` gives a decrease of
0.06 pt at 12 pt. Preview compares headless preflight, overset, page count,
paragraph movement, and note movement. Save with the preview’s plan ID.
The connection keeps up to four recent plans for 15 minutes. A changed source
file invalidates its preview.

**Layout edits.** Use the preview tool to place text and shapes by page ID,
align or distribute frames, relink images, edit table cells, add footnotes or endnotes,
generate publication lists, assign a parent page, and change selected layer,
edition, metadata, and saved view settings. Frame geometry and gaps use
millimetres. Table rows and columns are one-based. Open the resulting draft
in Recto to refine the design.

**Translation.** Start from a Recto XLIFF 2.0 exchange. The review checks source
identities and protected inline codes. A draft, locked, unknown, or conflicting
unit blocks the selected set. After reviewing the counts, pass explicit ready
unit IDs to create a partial edition. The preview reports layout and font
risks for review. The translation exchange and the source
publication must both match the preview at save time.

**Batch output.** Use `{{field}}` tokens in a saved template. For a photo column,
put `{{photo}}` in the image source, include `photo` in `photoFields`, and put
workspace-relative raster paths such as `photos/speaker.png` in the dataset.
The batch compiles every record before creating its new output directory, then
writes a manifest with file and revision details. Split large jobs into batches
of up to 100 records and 500 output pages.

**Books.** Open a portable `.rectobook` archive containing chapter snapshots.
The inspection reports physical page numbers, inserted blank pages, and any
saved cover requirements. Export the assembled interior PDF using that revision.

**Appearance.** Every theme, accent, custom hex, button style, control density,
and pasteboard tone is available in a portable `.rectoappearance` profile.
Open **Appearance → Load profile** to apply one to your current editor profile.
**Save profile** exports your current settings for another machine or the
automation server. Publication files and other editor profiles keep their
existing settings.

## Scope

Call `recto_available_features` and the client’s tool listing for the current
coverage. The server works with saved files. Live canvas gestures, unsaved
editor state, collaboration, native dialogs, and the desktop updater remain in
the interactive app. Advanced artwork, style editing, and cover and delivery
package workflows still use the editor. Headless layout can differ for fonts without embedded data.
Review final line breaks, and run independent preflight for PDF/X candidates.
