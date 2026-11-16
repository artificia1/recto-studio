const TABLE_BYTES: usize = 256;
const HEADER_BYTES: usize = 1 + TABLE_BYTES;
const MAX_PIXEL_BYTES: usize = 1024 * 1024;

/// Apply the editor's lookup table to straight RGBA pixels, preserving alpha.
pub fn adjust_packet(packet: &[u8]) -> Option<Vec<u8>> {
    let grayscale = match packet.first()? {
        0 => false,
        1 => true,
        _ => return None,
    };
    let table: &[u8; TABLE_BYTES] = packet.get(1..HEADER_BYTES)?.try_into().ok()?;
    let rgba = packet.get(HEADER_BYTES..)?;
    if rgba.is_empty() || rgba.len() > MAX_PIXEL_BYTES || rgba.len() % 4 != 0 {
        return None;
    }

    let mut output = rgba.to_vec();
    apply_tone(&mut output, table, grayscale);
    Some(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn packet(grayscale: u8, pixels: &[u8]) -> Vec<u8> {
        let mut packet = vec![grayscale];
        packet.extend((0..=255u8).rev());
        packet.extend_from_slice(pixels);
        packet
    }

    #[test]
    fn maps_rgb_and_preserves_transparent_and_translucent_alpha() {
        let pixels = [20, 120, 240, 73, 11, 22, 33, 0];
        assert_eq!(adjust_packet(&packet(0, &pixels)), Some(vec![235, 135, 15, 73, 244, 233, 222, 0]));
    }

    #[test]
    fn rounds_luminance_before_mapping_it() {
        let pixels = [255, 0, 0, 73, 0, 255, 0, 0, 0, 0, 255, 255];
        assert_eq!(adjust_packet(&packet(1, &pixels)), Some(vec![201, 201, 201, 73, 73, 73, 73, 0, 237, 237, 237, 255]));
    }

    #[test]
    fn accepts_the_limit_and_rejects_invalid_or_oversized_packets() {
        assert!(adjust_packet(&packet(0, &vec![0; MAX_PIXEL_BYTES])).is_some());
        assert!(adjust_packet(&packet(0, &vec![0; MAX_PIXEL_BYTES + 4])).is_none());
        assert!(adjust_packet(&packet(0, &[])).is_none());
        assert!(adjust_packet(&packet(0, &[1, 2, 3])).is_none());
        assert!(adjust_packet(&packet(2, &[1, 2, 3, 4])).is_none());
        assert!(adjust_packet(&[0, 1, 2]).is_none());
    }
}
use crate::raster_kernel::apply_tone;
