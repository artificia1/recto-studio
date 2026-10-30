# Manuscripts and formatted stories

Books, magazines, and marketing layouts use the same text frames and story tools.

## Import

Select a text frame and use **File → Place Text**, or drop a `.docx`, `.md`,
`.markdown`, or UTF-8 `.txt` file onto the document. Dropping onto a document with
no text frames prepares a new frame inside the margins.

The import dialog previews the manuscript and maps source paragraph styles to
existing Recto styles. Review the warnings, then choose **Place manuscript**.
Cancel leaves the publication untouched. Placement replaces the complete selected
story, including its linked frames, as one undo step.

Markdown supports headings, paragraphs, emphasis, quotes, visible list markers,
and scene breaks. Code blocks become plain paragraphs. Link/image labels remain
text. HTML is literal text and is never executed. This is an editorial subset,
not a complete CommonMark implementation.

DOCX preserves paragraph style references, bold/italic/underline, inherited Word
run styles, explicit formatting-off values, Unicode text, tabs, line breaks, and
empty paragraphs. Word typography maps to the publication's paragraph styles.

Word tables become paragraphs; images need separate placement; list numbering and
nesting need review. Tracked changes use accepted text. Fields retain cached text.
Footnote/endnote references use bracketed IDs, with note text appended for review;
they are not automatic Recto notes. Headers, footers, and page geometry are not
imported. These limitations appear in the preview where applicable. Manuscripts
are limited to 32 MB and expanded DOCX archives to 64 MB.

## Edit and flow

The Story Editor opens the complete manuscript from any frame in its thread. Its
editing pane is paired with a formatted preview. Select text to apply emphasis or
reusable character styles. The paragraph style control applies to touched
paragraphs, or the paragraph at the cursor. Character styles can be created from
the selected text's formatting.

Linking frames retains both stories, paragraph boundaries, spaces, and formatting.
Resizing or changing typography reflows using measured widths. The final frame
keeps all remaining copy, including overset. Deleting a frame retains the story in
the remaining thread; unlinking partitions it into independent stories. Save,
autosave, and undo retain structured content. Legacy plain-text projects remain
supported. Preview displays up to 150 paragraphs; placement retains everything.

The shared formatted layout supports columns, alignment, baseline grids, and
object wrapping. Legacy drop caps, GREP styling, optical margins, and Knuth-Plass
composition are not yet integrated into this formatted path.

Select a story frame and choose **File → Auto-paginate selected story** to append
linked pages using the document margins. Formatting is retained, and the whole
operation is one undo step. Existing pages and independent frames are retained.
This command runs on request. In a facing-page document it appends left/right
page pairs, with mirrored inside/outside margins; a right-hand singleton is used
when that is the next physical position. Its 200-page limit prevents runaway
generation; a failure rolls back the whole operation.

New pages are inserted after the story's last spread, before subsequent chapters.
For ongoing flow, select a frame and enable **Pages → Story pagination →
Automatically add pages for selected story**. Text edits and typography changes
then extend that story when it overflows, as part of the edit's undo step. The
setting survives save/reopen. Other stories remain manual. Shortening copy keeps
existing pages and frames so intentional layouts are not deleted. A failure
retains the edited manuscript and shows a message in Story pagination.
In **Pages → New chapter opening**, append a chapter with a styled heading and
body paragraph, an opening inset, and optional right-hand opening. Facing-page
documents get a blank page when needed. The entire addition is one undo step.
This does not split an imported manuscript into chapters automatically.

**Pages → Sections & numbering** starts a section at a selected page with a title,
prefix, and Arabic or Roman numbering. Printed labels can restart; physical page
positions remain unique. Roman labels above 3999 use Arabic digits. Removing a
section restores the preceding section's numbering. Settings survive save/reopen.

**Pages → Running header & page number** creates a reusable master based on the
spread's existing master and adds header text plus a bottom-margin page number.
Other spreads retain their own masters. Assign the generated master to another
spread to reuse it. Top and bottom margins must each be at least 10 mm.
Supported tokens include `{{chapterTitle}}`, `{{sectionTitle}}`, `{{docTitle}}`,
`{{page}}` (printed label), `{{physicalPage}}`, and `{{totalPages}}`.
Canvas and PDF resolve headings from formatted stories in physical page order.
Master headers are not currently included in EPUB or flipbook output.

Automatic removal of empty pages, keep rules, and widow/orphan controls remain
follow-up work.

## Output and compatibility

PDF uses the formatted layout. Custom font outlines use the registered face;
synthetic bold/italic variants are not guaranteed in custom-font PDF output.
Existing PDF font-substitution and accessibility limitations in
[PUBLISHING.md](PUBLISHING.md) still apply.

EPUB writes the semantic story once at its first frame, preserving headings,
paragraphs, and emphasis without duplicates at frame boundaries. This represents
reading order, not print-page appearance. IDML export still uses its simplified
per-frame representation; rich-format round-tripping through IDML is not included.

The `.recto` model adds versioned `storyContent` to the first frame and derived
`textContent`/source offsets to frames. Paragraphs hold style references, local
formatting, and text runs with optional character-style references. Plain `text`
and `rawStoryText` remain compatibility views. Use the state manager to update
these fields together. The canonical manuscript owns the content; frame slices
are derived views.
