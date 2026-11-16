mod raster_kernel;

use std::ptr::addr_of_mut;
use std::slice;

const TILE_BYTES: usize = 1024 * 1024;
static mut INPUT: [u8; TILE_BYTES] = [0; TILE_BYTES];
static mut OUTPUT: [u8; TILE_BYTES] = [0; TILE_BYTES];
static mut TABLE: [u8; 256] = [0; 256];

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
