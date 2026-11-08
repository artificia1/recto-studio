# Manuscripts and formatted stories

Books, magazines, and marketing layouts use the same text frames and story tools.

## Starters, navigation and review

Under **Templates**, choose a fiction chapter, nonfiction chapter or editorial
article starter, enter a title, and add it to the document. Starters use the current
trim and margins, with linked body frames, folios and a continuation running head.
Their body story extends automatically when it overflows. Existing spread layouts
adapt from A4 to the current trim; inspect line lengths and image placeholders
before production. Adding or replacing a layout is one undo step. Replacement
protects locked content, structured manuscripts and publication references;
use **+ New Spread** to keep existing work intact.

Templates also includes **Rectangular sheet planning**. Enter sheet and piece
dimensions, margins, gaps and quantity to compare uniform grids. Rotation is
opt-in because grain direction matters. Saved JSON plans contain first-sheet
positions and the total number of sheets needed. They are planning aids, not
cutting tools or press files; interlocking flaps and mixed-orientation nesting
are not implemented. Include bleed and tooling clearance in your piece bounds.

Under **Pages → Publication navigator**, search headings or the full text of a
threaded story. Switch between outline and story views, or enter a printed label
or physical page number. Repeated section labels show each matching page.
The spread list can move complete spreads earlier or later; a move that would
reverse linked text or table frames is refused. Review facing-page arrangement
and chapter openings after changing the order.

**Pages → Review notes** adds feedback to the active spread, positioned at the
selected object when available. Edit, resolve, reopen and filter notes there.
Pins follow spread identity when order changes; deleting a spread removes its
review notes, and undo restores both. Review notes are saved in the project and
excluded from publication exports. They are local document feedback, not a
continuously synchronized review service.

## Import

Horizontal Japanese/Chinese/Korean composition can enable **Horizontal CJK
punctuation rules** in paragraph styles. This conservative subset keeps common
closing punctuation off line starts and opening brackets off line ends, including
across styled runs. Unbreakable groups wider than the column become overset;
source text is never rewritten. EPUB receives reader-dependent strict line-break
CSS. Import a suitable font file for PDF output; a system font name is insufficient.
Vertical text, tate-chu-yoko, ruby, full JLREQ spacing and bidi composition remain
unimplemented. Grapheme-aware emergency wrapping preserves combining characters
and emoji sequences in the formatted story engine.

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
Footnote/endnote references import as anchored Recto notes with plain-text bodies.
Headers, footers, and page geometry are not
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

## Paragraph composition

In **Styles → Edit → Paragraph flow**, control keep-with-next, keep-together,
minimum lines at column bottom (orphans), and minimum lines at column top
(widows). These rules apply to formatted stories across columns and linked
frames in canvas/PDF. Automatic story extension responds to the resulting flow.
Impossible keep rules fall back to normal flow rather than stalling pagination;
complex wrap obstacles can produce conservative line estimates. Default styles
retain their existing flow until controls are enabled.

Automatic hyphenation offers English (US), German, and French dictionaries.
Displayed break hyphens do not change the saved manuscript text or source offsets.
Other languages retain ordinary word wrapping. EPUB carries language, hyphenation,
keep and widow/orphan CSS; the reader decides its final pagination.

Paragraph styles also expose bold/italic and retain the previous font if a new
font cannot load. Custom fonts continue to use the import system documented in
FONTS.md. Synthetic custom-font variants and variable-font axes retain the
existing export limitations; these controls do not imply every face has separate
bold/italic outlines. Automatic removal of empty pages remains follow-up work.

## Notes and generated lists

DOCX footnotes/endnotes and Markdown `[^name]` references import as anchored notes.
Note bodies currently retain plain text. In the Story Editor, expand the reference
tools to insert a note at the cursor, link to a heading, or mark selected index
text. Use Pages → Contents, notes & references to edit notes and create contents,
index or endnotes lists. Lists can use an empty existing page or a new page at the
end, and refresh after edits and page-number changes. Make a generated list static
before editing its manuscript manually.

Footnotes reserve measured space in their owning frame. Long notes do not split
across pages: shorten the note, enlarge the frame, or convert it to an endnote if
preflight reports insufficient space. For print, create an endnotes list. EPUB
exports linked notes separately with return links. Deleted note markers and
reference targets produce preflight errors rather than silently changing targets.

## Table of Authorities

In the Story Editor, select a citation and choose Cases, Statutes or Treatises in
the reference tools. Enter the same canonical citation for short-form mentions,
then mark it. **Find citation suggestions in this story** offers bounded US-style
case/statute matches for review; it does not verify citations or infer every legal
reference. Other citation systems and treatises use manual marks.

Under **Pages → Contents, notes & references**, create or refresh authorities.
Entries group alphabetically by category, deduplicate physical-page occurrences
and follow section labels/reflow. Ordinary indexes exclude authority marks.
Unmark citation removes the marker while preserving text; undo restores it.
Deleted anchors are omitted from the table and flagged for review in preflight.
Verify the completed table against the requirements of the intended publication.

## Bound catalog text

Select an independent text frame and open **Links → Bound text data**. Enter a
source label, record key field/value and bound field. Upload a JSON array such as
`[{"sku":"A1","price":"$129.00"}]` from a trusted inventory export. Review changes,
then apply the batch in one undo step. Missing/duplicate keys, locked frames and
stale previews block the entire batch. Updated overset frames are reported.

This workflow refreshes manually from a snapshot, without SQL/ODBC connections or
background polling. Format currencies and dates in the source. Snapshots are
limited to 4 MB/10,000 records in the UI; only binding metadata and applied text
are stored in the project. Threaded stories, generated lists and reference-bearing
manuscripts cannot become bound data fields. Database credentials belong in a
trusted external gateway, not in publication files.

## Export compatibility

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

## Artwork workspace and master families

Use **All spreads** above the canvas for a scrollable grid of the publication.
Zoom from 5% to 100%, choose one to eight columns, and drag independent artwork
directly between pages. Drag near a scroll edge to reach distant spreads. Grey
pasteboards beside each spread hold saved scratch artwork; pasteboard items are
excluded from PDF, EPUB and flipbook output, but remain in native project packages.
Double-click a page or return to the spread editor for detailed editing.
Positioning a pasteboard item back inside a page in the spread editor restores it
to publication output; moving it back through the artwork workspace does so too.

The workspace is an artwork overview with simplified text, tables, image fitting
and colour previews. It is not a continuous full-fidelity text-editing canvas or
an unlimited pasteboard. Threaded, anchored and detached master items use their
existing editing tools; moving them through the artwork overview is blocked.

Under **Pages**, choose a parent when creating a child master, or change an
existing master's parent. Owned parent items cascade into descendants in canvas
and PDF. Cycles and deleting parents with children are blocked. **Edit master
items** edits owned geometry/text or copies independent selected artwork into a
master; edit inherited items in their owning parent. Local overrides remain local.
Legacy page tokens are resolved per page; keep each token within one formatted
text run. EPUB and flipbook do not gain master-page layout reproduction here.

Select multiple objects for alignment and **Exact spacing (mm)** in Properties.
Exact horizontal or vertical gaps use the leading object as the anchor and
preserve group geometry. Bounds account for object rotation. **Ctrl/Cmd+G** groups
the selection; **Ctrl/Cmd+Shift+G** ungroups it. Groups are flat selection/movement
units. Nested transforms and compound-path Boolean operations are separate work.
These bulk operations are local and undoable; they are not synchronized as live
collaboration operations.

## Production tools

**Pages → Production & books** saves a self-contained `.rectobook` archive of
chapter snapshots. Add `.recto` files, reorder chapters, choose right-hand
openings, synchronize styles from the first chapter, and export combined PDF or
contents. Synchronization changes the snapshots in the book archive; save that
archive to retain changes. Original chapter files and the open document remain
separate. Chapters currently need matching page dimensions and bleed. Book PDF
renders each chapter's artwork and inserts real blank pages for recto openings.
Book-wide contents exports as text; references inside chapters retain their
targets, while cross-document reference authoring is still pending.

**Styles** supports parent paragraph styles. Choosing a parent inherits its
formatting; changing a property makes that property a local override. Choose
the parent again to restore inherited formatting. Style sets exchange paragraph
and character styles by ID and do not contain licensed font files.

Find/Change searches complete manuscripts, including overset text, and supports
paragraph/character style filters. Replacements retain surrounding formatting,
skip atomic reference markers and are undoable. Locked stories must be unlocked
before replacement. Story Editor spellcheck uses the browser or operating
system's available language support.

**Properties → Import table data** accepts quoted CSV or pasted spreadsheet TSV
with up to 200 rows and 20 columns. Horizontal cell merging retains both cells'
text in the first cell. Splitting keeps that combined text; Undo restores the
original cells. **Properties → Table continuation → Fit rows to content** wraps
cell text and sizes each row to its tallest cell. Rows flow intact through linked
frames, reserving space for repeated headers and footers. Existing tables keep
their equal-row layout unless this mode is selected. **Add continuation page**
appends one page with a linked frame of the same size; it is one undo step.
Cell and table-style edits from any frame update the table's source data.
Overflow appears in Properties and preflight and blocks PDF export until fixed.
A row taller than every frame requires a larger frame or shorter content;
splitting rows across pages and vertical cell merges remain pending.

**Properties → Image focal point** positions a subject inside proportional fill
crops. PDF and canvas use the same crop calculation. Data Merge accepts CSV or
scalar JSON records and remaps local frame/group identities per generated spread.
Merge templates with cross-spread threads or publication references need to be
simplified before duplication.

IDML import retains per-run font, size, bold, italic, underline and color in
structured stories. This improves editable typography; complex IDML effects,
tables and parent-master fidelity still need dedicated import work.

## Proposed manuscript revisions

In **Story Editor → Proposed revisions**, select text (or position the cursor),
choose **Draft edit at selection**, enter a reviewer and proposed passage, then
submit. An empty proposed passage deletes the selection; an empty selection
inserts text. Proposals stay separate from the manuscript until accepted and
are saved in the `.recto` project. PDF and EPUB use the current manuscript.

Review the original and proposed text side by side, then accept or reject.
Acceptance preserves surrounding formatting, reflows the story and is undoable.
If the original text or formatting has changed, acceptance is blocked: reject
the stale proposal and draft another against the current manuscript. Locked
stories and edits across note/reference/index markers are also protected.

**Pages → Manuscript revisions** lists pending proposals across the document,
opens their stories for review, and allows rejection of orphaned proposals.
Resolved records can be removed in one undo step. Review currently supports
100 proposals per document and manuscripts up to 200,000 characters. This is
an explicit proposal workflow; ordinary typing still edits the manuscript
directly. Inline automatic change tracking and concurrent revision merging are
not implemented.
