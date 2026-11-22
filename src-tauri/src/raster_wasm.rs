mod raster_kernel;
mod layout_kernel;
mod pdf_kernel;
mod story_geometry;
mod pagination_kernel;
mod imposition_kernel;

use std::ptr::addr_of_mut;
use std::slice;

const TILE_BYTES: usize = 1024 * 1024;
static mut INPUT: [u8; TILE_BYTES] = [0; TILE_BYTES];
static mut OUTPUT: [u8; TILE_BYTES] = [0; TILE_BYTES];
static mut TABLE: [u8; 256] = [0; 256];

fn number(bytes: &[u8]) -> f64 {
    f64::from_le_bytes(bytes.try_into().expect("eight-byte number"))
}

fn integer(bytes: &[u8]) -> u32 {
    u32::from_le_bytes(bytes.try_into().unwrap())
}

#[no_mangle]
pub extern "C" fn layout_table_rows(count: usize, frame: f64, used: f64, footer: f64, padding: f64, leading: f64,
    consumed: f64, allow_split: bool) -> i32 {
    if count > 8192 || leading <= 0.0 { return -1; }
    let input = unsafe { slice::from_raw_parts(raster_input(), count * 24) };
    let output = unsafe { slice::from_raw_parts_mut(raster_output(), count * 16) };
    let rows: Vec<_> = input.chunks_exact(24).map(|row| pagination_kernel::TableRow {
        height: number(&row[..8]), minimum: number(&row[8..16]),
        lines: integer(&row[16..20]), group_end: integer(&row[20..24]) as usize,
    }).collect();
    let mut slots = output.chunks_exact_mut(16);
    let mut written = 0;
    let result = pagination_kernel::table_rows(&rows, frame, used, footer, padding, leading, consumed, allow_split, |index, height, lines| {
        let Some(slot) = slots.next() else { return false; };
        slot[..4].copy_from_slice(&(index as u32).to_le_bytes());
        slot[4..8].copy_from_slice(&lines.to_le_bytes());
        slot[8..16].copy_from_slice(&height.to_le_bytes());
        written += 1;
        true
    });
    if result.is_some() { written } else { -1 }
}

#[no_mangle]
pub extern "C" fn layout_note_columns(count: usize, columns: u32, capacity: u32) -> i32 {
    if count > 4096 || columns == 0 || columns > 128 || capacity > 65535 { return -1; }
    let input = unsafe { slice::from_raw_parts(raster_input(), count * 16) };
    let output = unsafe { slice::from_raw_parts_mut(raster_output(), TILE_BYTES) };
    let notes: Vec<_> = input.chunks_exact(16).map(|record| pagination_kernel::Note {
        rows: integer(&record[..4]), label_rows: integer(&record[4..8]),
        anchor: integer(&record[8..12]), started: record[12] != 0,
    }).collect();
    if notes.iter().any(|note| note.rows > 65535 || note.label_rows > 65535) { return -1; }
    let mut cursor = 16;
    let result = pagination_kernel::footnote_columns(&notes, columns, capacity, |placement| {
        let Some(record) = output.get_mut(cursor..cursor + 24) else { return false; };
        let fields = [placement.index as u32, placement.column, placement.row, placement.start, placement.count, placement.label];
        for (bytes, value) in record.chunks_exact_mut(4).zip(fields) { bytes.copy_from_slice(&value.to_le_bytes()); }
        cursor += 24;
        true
    });
    let Some((carry, max_rows, unplaced)) = result else { return -1; };
    let end = cursor + carry.len() * 8;
    let Some(carry_buffer) = output.get_mut(cursor..end) else { return -1; };
    for (record, (index, start)) in carry_buffer.chunks_exact_mut(8).zip(&carry) {
        record[..4].copy_from_slice(&(*index as u32).to_le_bytes());
        record[4..].copy_from_slice(&start.to_le_bytes());
    }
    let header = [((cursor - 16) / 24) as u32, carry.len() as u32, max_rows, unplaced];
    for (bytes, value) in output[..16].chunks_exact_mut(4).zip(header) { bytes.copy_from_slice(&value.to_le_bytes()); }
    end as i32
}

#[no_mangle]
pub extern "C" fn imposition_plan(pages: u32, mode: u32, signature: u32) -> usize {
    let Some(plan) = imposition_kernel::plan(pages, mode, signature) else { return 0; };
    let count = plan.side_count() as usize;
    let output = unsafe { slice::from_raw_parts_mut(raster_output(), 20 + count * 48) };
    for (field, value) in output[..20].chunks_exact_mut(4).zip([plan.pages, plan.padded, plan.sheets, plan.signature_size, plan.signatures]) {
        field.copy_from_slice(&value.to_le_bytes());
    }
    for (index, record) in output[20..].chunks_exact_mut(48).enumerate() {
        let Some(side) = plan.side(index as u32) else { return 0; };
        let fields = [side.sheet, u32::from(side.back), side.signature, side.creep_steps];
        for (field, value) in record.chunks_exact_mut(4).zip(fields.into_iter().chain(side.panels)) {
            field.copy_from_slice(&value.to_le_bytes());
        }
    }
    count
}

#[no_mangle]
pub extern "C" fn layout_place_line(length: usize) -> i32 {
    use story_geometry::{free_band, place_line, Frame, Grid, LineCursor};
    const HEADER: usize = 96;
    if !(HEADER..=TILE_BYTES).contains(&length) { return -1; }
    let input = unsafe { slice::from_raw_parts(raster_input(), length) };
    let field = |index: usize| number(&input[index * 8..(index + 1) * 8]);
    let mut cursor = LineCursor { column: field(0), y: field(1) };
    let frame = Frame { x: field(2), y: field(3), padding: field(4), bottom: field(5),
        width: field(6), gutter: field(7), columns: field(8) };
    let grid = Grid { start: field(10), pitch: field(11) };
    let mut intervals = Vec::new();
    let position = place_line(&mut cursor, frame, field(9), grid, |left, width, top, height| {
        free_band(&input[HEADER..], left, width, top, height, &mut intervals)
    });
    let (inset, width) = position.unwrap_or((0.0, 0.0));
    let output = unsafe { slice::from_raw_parts_mut(raster_output(), 32) };
    for (bytes, value) in output.chunks_exact_mut(8).zip([cursor.column, cursor.y, inset, width]) {
        bytes.copy_from_slice(&value.to_le_bytes());
    }
    i32::from(position.is_some())
}

#[no_mangle]
pub extern "C" fn layout_flatten_path(count: usize, closed: bool) -> usize {
    const MAX_POINTS: usize = 8192;
    if count == 0 || count > MAX_POINTS { return 0; }
    let input = unsafe { slice::from_raw_parts(raster_input(), count * 48) };
    let output = unsafe { slice::from_raw_parts_mut(raster_output(), MAX_POINTS * 16) };
    let point = |node: usize, offset: usize| {
        let start = node * 48 + offset;
        (number(&input[start..start + 8]), number(&input[start + 8..start + 16]))
    };
    let mut slots = output.chunks_exact_mut(16);
    let mut written = 0;
    let mut emit = |(x, y): story_geometry::Point| {
        let Some(slot) = slots.next() else { return false; };
        slot[..8].copy_from_slice(&x.to_le_bytes());
        slot[8..].copy_from_slice(&y.to_le_bytes());
        written += 1;
        true
    };
    emit(point(0, 0));
    for index in 1..count + usize::from(closed) {
        let next = index % count;
        let a = point(index - 1, 0);
        let b = point(index - 1, 16);
        let c = point(next, 32);
        let d = point(next, 0);
        if !story_geometry::flatten_cubic(a, b, c, d, 0, &mut emit) { return 0; }
    }
    written
}

#[no_mangle]
pub extern "C" fn layout_optimal_breaks(count: usize, width_count: usize, tolerance: f64, hyphen_cost: f64) -> i32 {
    if count > 2048 || width_count == 0 || width_count > 2048 { return -2; }
    let input = unsafe { slice::from_raw_parts(raster_input(), count * 40 + width_count * 8) };
    let (items, widths) = input.split_at(count * 40);
    let items: Vec<_> = items.chunks_exact(40).map(|item| layout_kernel::Item {
        kind: item[0], flagged: item[1] != 0, width: number(&item[8..16]), stretch: number(&item[16..24]),
        shrink: number(&item[24..32]), penalty: number(&item[32..40]),
    }).collect();
    let widths: Vec<_> = widths.chunks_exact(8).map(number).collect();
    let Some(path) = layout_kernel::optimal_breaks(&items, &widths, tolerance, hyphen_cost) else { return -1; };
    let output = unsafe { slice::from_raw_parts_mut(raster_output(), path.len() * 16) };
    for (record, (index, ratio)) in output.chunks_exact_mut(16).zip(path) {
        record[..4].copy_from_slice(&(index as u32).to_le_bytes());
        record[8..].copy_from_slice(&ratio.to_le_bytes());
    }
    (output.len() / 16) as i32
}

#[no_mangle]
pub extern "C" fn layout_uniform_lines(
    count: usize, columns: usize, y: f64, padding: f64, bottom: f64, height: f64,
) -> i32 {
    layout_story_lines(count, columns, y, padding, bottom, height)
}

#[no_mangle]
pub extern "C" fn layout_story_lines(
    count: usize, columns: usize, mut y: f64, padding: f64, bottom: f64, height: f64,
) -> i32 {
    if count > 4096 || columns == 0 || columns > 128 { return -1; }
    let input = unsafe { slice::from_raw_parts(raster_input(), count * 16 + columns * 8) };
    let (input, widths) = input.split_at(count * 16);
    let width_at = |i: usize| number(&widths[i * 8..(i + 1) * 8]);
    let minimum_width = widths.chunks_exact(8).map(number).fold(f64::INFINITY, f64::min);
    let mut column = 0;
    let mut next_width = || {
        if y + height > bottom + 0.0001 && column + 1 < columns {
            column += 1;
            y = padding;
        }
        y += height;
        width_at(column)
    };
    let output = unsafe { slice::from_raw_parts_mut(raster_output(), count * 4) };
    let tokens = input.chunks_exact(16).map(|token| (number(&token[..8]), token[8]));
    let mut written = 0;
    if !layout_kernel::uniform_line_starts(tokens, minimum_width, &mut next_width, |index| {
        output[written..written + 4].copy_from_slice(&(index as u32).to_le_bytes());
        written += 4;
    }) { return -1; }
    (written / 4) as i32
}

#[no_mangle]
pub extern "C" fn pdf_classic_xref(count: usize) -> usize {
    if count > TILE_BYTES / 16 { return 0; }
    let input = unsafe { slice::from_raw_parts(raster_input(), count * 16) };
    let output = unsafe { slice::from_raw_parts_mut(raster_output(), TILE_BYTES) };
    pdf_kernel::classic_xref(input, output).unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn pdf_classic_footer(offset: u64) -> usize {
    let output = unsafe { slice::from_raw_parts_mut(raster_output(), 64) };
    pdf_kernel::classic_footer(offset, output).unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn pdf_classic_rows(count: usize, range_length: usize) -> usize {
    if count == 0 || count > TILE_BYTES / 20 { return 0; }
    let input = unsafe { slice::from_raw_parts(raster_input(), count * 16) };
    let output = unsafe { slice::from_raw_parts_mut(raster_output(), TILE_BYTES) };
    pdf_kernel::classic_rows(input, output, range_length).unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn pdf_stream_xref(count: usize) -> usize {
    if count == 0 || count > TILE_BYTES / 24 { return 0; }
    let input = unsafe { slice::from_raw_parts(raster_input(), count * 24) };
    let output = unsafe { slice::from_raw_parts_mut(raster_output(), TILE_BYTES) };
    pdf_kernel::stream_xref(input, output).unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn pdf_object_stream(count: usize, length: usize) -> usize {
    if count == 0 || count > 50 || length > TILE_BYTES || length < count * 8 { return 0; }
    let input = unsafe { slice::from_raw_parts(raster_input(), length) };
    let output = unsafe { slice::from_raw_parts_mut(raster_output(), TILE_BYTES) };
    let (records, objects) = input.split_at(count * 8);
    let (header, body) = output.split_at_mut(4);
    let Some((first, size)) = pdf_kernel::object_stream(records, objects, body) else { return 0; };
    header.copy_from_slice(&(first as u32).to_le_bytes());
    size + 4
}

#[no_mangle]
pub extern "C" fn raster_mark_diff(length: usize) -> usize {
    if length > TILE_BYTES || length % 4 != 0 {
        return usize::MAX;
    }
    // The two scratch arrays are disjoint. The host provides corresponding RGBA tiles.
    let before = unsafe { slice::from_raw_parts(raster_input(), length) };
    let after = unsafe { slice::from_raw_parts_mut(raster_output(), length) };
    raster_kernel::mark_proof_difference(before, after)
}

#[no_mangle]
pub extern "C" fn raster_proof_bounds(length: usize, width: usize, first: usize) -> usize {
    if length > TILE_BYTES || length % 4 != 0 || width == 0 || first.checked_add(length / 4).is_none() { return usize::MAX; }
    let before = unsafe { slice::from_raw_parts(raster_input(), length) };
    let after = unsafe { slice::from_raw_parts_mut(raster_output(), length) };
    let metadata = unsafe { slice::from_raw_parts_mut(raster_table(), 16) };
    let (changed, bounds) = raster_kernel::mark_proof_region(before, after, width, first);
    for (field, value) in metadata.chunks_exact_mut(4).zip(bounds) {
        field.copy_from_slice(&(value as u32).to_le_bytes());
    }
    changed
}

#[no_mangle]
pub extern "C" fn raster_capacity() -> usize { TILE_BYTES }

#[no_mangle]
pub extern "C" fn raster_input() -> *mut u8 { addr_of_mut!(INPUT).cast() }

#[no_mangle]
pub extern "C" fn raster_output() -> *mut u8 { addr_of_mut!(OUTPUT).cast() }

#[no_mangle]
pub extern "C" fn raster_table() -> *mut u8 { addr_of_mut!(TABLE).cast() }

#[no_mangle]
pub extern "C" fn raster_run(mode: u32, length: usize, grayscale: bool) -> usize {
    if length == 0 || length > TILE_BYTES || length % 4 != 0 { return 0; }
    // This Wasm module has no threads or host callbacks. The caller fills scratch
    // buffers before this synchronous call and copies results out afterward.
    let input = unsafe { slice::from_raw_parts_mut(raster_input(), length) };
    match mode {
        0 | 1 => {
            let paper = mode == 1;
            let rgb_length = length / 4 * 3;
            // INPUT and OUTPUT are distinct, fixed-size static arrays.
            let output = unsafe { slice::from_raw_parts_mut(raster_output(), length) };
            let (rgb, alpha) = output.split_at_mut(rgb_length);
            if raster_kernel::write_rgb(input, rgb, paper) && !paper {
                raster_kernel::write_alpha(input, alpha);
                length
            } else {
                rgb_length
            }
        }
        2 => {
            let table = unsafe { &*addr_of_mut!(TABLE) };
            raster_kernel::apply_tone(input, table, grayscale);
            length
        }
        3 => {
            raster_kernel::restore_straight_alpha(input);
            length
        }
        _ => 0,
    }
}
