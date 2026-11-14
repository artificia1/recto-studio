# Recto MCP · Local publishing automation

Recto Studio’s optional Model Context Protocol server uses the same local
publishing engines as the editor. It communicates over standard input and output.
The server starts from your MCP client. The desktop app can exchange local
review files through a workspace you choose.

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
| Inspect the layout visually | `recto_render_preview_image`, `recto_view_shared_canvas` |
| Review a proposal in the desktop editor | `recto_offer_desktop_proposal` |
| Start a document or convert a file | `recto_create_publication`, `recto_import_publication` (IDML and Scribus) |
| Translate a publication | `recto_export_publication` with `xliff`, `recto_preview_translation`, `recto_save_draft` |
| Check or deliver a publication | `recto_run_preflight`, `recto_compile_pdf`, `recto_export_publication` (EPUB, fixed-layout EPUB, IDML, XLIFF) |
| Render a personalized catalog | `recto_render_batch` with CSV or a JSON array |
| Deliver a book | `recto_inspect_book`, `recto_compile_book`, `recto_export_book_package` |
| Share an editor theme | `recto_appearance`, `recto_save_appearance` |

**Story edits.** Read the uncomposed story and work with its UTF-16 offsets and
exact expected text. A replacement preserves formatting outside the edited
range and rejects edits through protected note, index, and reference markers.
Tracking is signed thousandths of an em. For example, `-5` gives a decrease of
0.06 pt at 12 pt. Preview compares headless preflight, overset, page count,
paragraph movement, and note movement. Save with the preview’s plan ID.
The connection keeps up to four recent plans for 15 minutes. A changed source
file invalidates its preview.

**Layout edits.** Place text, shapes, images, and tables by page ID. Move and
resize frames, apply existing object or paragraph styles, adjust raster levels
and curves, add vector hatching or mesh fills, or assign a patterned stroke.
Alignment, image relinking, table cells, notes, publication lists, parents,
layers, editions, and saved view settings are also available. Frame geometry
and gaps use millimetres. Table rows and columns are one-based. Use table
operations to merge cells, enable row splitting, or append a continuation page.

**Visual feedback.** Call `recto_render_preview_image` with a project and
revision, or with a `planId`. Choose a one-based `page` or `spread`, or omit
both for the active spread. The server returns an `image/png` content block for
an image-capable client, plus page numbers and proof warnings. This view uses
the headless PDF renderer and the trim area. For the actual visible desktop
canvas with zoom, pasteboard and guides, use a shared canvas snapshot. To
iterate, pass the last `planId` as `basePlanId` to another preview. Read a pending
spread or story by passing its `planId` in place of a project path.

**Desktop review.** In the desktop app choose **File → Review Publishing
Changes**, select the MCP workspace, and choose whether to include the canvas.
Recto writes a project snapshot and shows its filename, a proposal filename,
and the optional PNG filename. Give those names to your client. It can use
`recto_view_shared_canvas` to look at the capture and `recto_offer_desktop_proposal`
to send a staged plan to the dialog. Review the edit and click **Apply to
document** to update the canvas with one Undo step. Local document changes or
collaboration invalidate the review. The files stay in your workspace for review.

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
To export the interior, separate cover, EPUB, and delivery report together,
approve the cover in Recto and save the book archive with its delivery recipe.

**Appearance.** Every theme, accent, custom hex, button style, control density,
and pasteboard tone is available in a portable `.rectoappearance` profile.
Open **Appearance → Load profile** to apply one to your current editor profile.
**Save profile** exports your current settings for another machine or the
automation server. Publication files and other editor profiles keep their
existing settings.

## Scope

Call `recto_available_features` and the client’s tool listing for the current
coverage. The desktop editor controls each share and approval. Continuous
screen sharing, native dialogs, collaboration, the updater, advanced style
creation, and freehand drawing remain in the editor. Headless layout can differ
for fonts without embedded data.
Review final line breaks, and run independent preflight for PDF/X candidates.
