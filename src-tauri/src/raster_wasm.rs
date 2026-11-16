mod raster_kernel;
mod layout_kernel;
mod pdf_kernel;

use std::ptr::addr_of_mut;
use std::slice;

const TILE_BYTES: usize = 1024 * 1024;
static mut INPUT: [u8; TILE_BYTES] = [0; TILE_BYTES];
static mut OUTPUT: [u8; TILE_BYTES] = [0; TILE_BYTES];
static mut TABLE: [u8; 256] = [0; 256];

fn number(bytes: &[u8]) -> f64 {
    f64::from_le_bytes(bytes.try_into().expect("eight-byte number"))
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
    let tokens = input.chunks_exact(16).map(|token| (number(&token[..8]), token[8] != 0));
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
