use rustybuzz::{Face, UnicodeBuffer, Variation};
use rustybuzz::ttf_parser::Tag;
use std::{ptr::addr_of_mut, slice, str};

const FONT_LIMIT: usize = 4 * 1024 * 1024;
const TEXT_LIMIT: usize = 16 * 1024;
const GLYPH_LIMIT: usize = 32 * 1024;
const POSITION_BYTES: usize = 24;
const AXES_LIMIT: usize = 32;

static mut FONT: [u8; FONT_LIMIT] = [0; FONT_LIMIT];
static mut INPUT: [u8; TEXT_LIMIT + AXES_LIMIT * 8] = [0; TEXT_LIMIT + AXES_LIMIT * 8];
static mut OUTPUT: [u8; GLYPH_LIMIT * POSITION_BYTES] = [0; GLYPH_LIMIT * POSITION_BYTES];

#[no_mangle]
pub extern "C" fn font_ptr() -> *mut u8 { addr_of_mut!(FONT).cast() }

#[no_mangle]
pub extern "C" fn shape_input() -> *mut u8 { addr_of_mut!(INPUT).cast() }

#[no_mangle]
pub extern "C" fn shape_output() -> *mut u8 { addr_of_mut!(OUTPUT).cast() }

#[no_mangle]
pub extern "C" fn shape_run(font_length: usize, text_length: usize, axis_count: usize) -> i32 {
    if font_length == 0 || font_length > FONT_LIMIT || text_length > TEXT_LIMIT || axis_count > AXES_LIMIT { return -1; }
    // The host fills both input regions before the synchronous call. Output is disjoint.
    let font_bytes = unsafe { slice::from_raw_parts(font_ptr(), font_length) };
    let input = unsafe { slice::from_raw_parts(shape_input(), text_length + axis_count * 8) };
    let (text_bytes, axes) = input.split_at(text_length);
    let (Some(mut face), Ok(text)) = (Face::from_slice(font_bytes, 0), str::from_utf8(text_bytes)) else { return -1; };
    let variations: Vec<_> = axes.chunks_exact(8).map(|axis| Variation {
        tag: Tag::from_bytes(axis[..4].try_into().unwrap()),
        value: f32::from_le_bytes(axis[4..].try_into().unwrap()),
    }).collect();
    face.set_variations(&variations);
    let mut buffer = UnicodeBuffer::new();
    buffer.push_str(text);
    buffer.guess_segment_properties();
    let result = rustybuzz::shape(&face, &[], buffer);
    if result.len() > GLYPH_LIMIT { return -1; }
    let output = unsafe { slice::from_raw_parts_mut(shape_output(), result.len() * POSITION_BYTES) };
    for (record, (info, pos)) in output.chunks_exact_mut(POSITION_BYTES)
        .zip(result.glyph_infos().iter().zip(result.glyph_positions())) {
        let fields = [info.glyph_id, info.cluster, pos.x_advance as u32, pos.y_advance as u32,
            pos.x_offset as u32, pos.y_offset as u32];
        for (bytes, value) in record.chunks_exact_mut(4).zip(fields) {
            bytes.copy_from_slice(&value.to_le_bytes());
        }
    }
    result.len() as i32
}
