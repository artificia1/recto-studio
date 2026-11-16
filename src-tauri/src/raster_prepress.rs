const MAX_TILE_BYTES: usize = 1024 * 1024;

pub fn prepare_tile(rgba: &[u8], mode: &str) -> Option<Vec<u8>> {
    if rgba.is_empty() || rgba.len() > MAX_TILE_BYTES || rgba.len() % 4 != 0 {
        return None;
    }
    let count = rgba.len() / 4;
    let mut rgb = Vec::with_capacity(count * 3);
    match mode {
        "split" => {
            let mut transparent = false;
            for pixel in rgba.chunks_exact(4) {
                rgb.extend_from_slice(&pixel[..3]);
                transparent |= pixel[3] != 255;
            }
            // An optional alpha plane follows RGB, in the same pixel order.
            if transparent {
                rgb.reserve_exact(count);
                rgb.extend(rgba.chunks_exact(4).map(|pixel| pixel[3]));
            }
        }
        "paper" => {
            for pixel in rgba.chunks_exact(4) {
                let alpha = u16::from(pixel[3]);
                rgb.extend(pixel[..3].iter().map(|channel| {
                    let ink = (255 - u16::from(*channel)) * alpha;
                    (255 - (ink + 127) / 255) as u8
                }));
            }
        }
        _ => return None,
    }
    Some(rgb)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_straight_rgb_and_omits_opaque_masks() {
        assert_eq!(prepare_tile(&[1, 2, 3, 255], "split"), Some(vec![1, 2, 3]));
        assert_eq!(prepare_tile(&[1, 2, 3, 255, 4, 5, 6, 0], "split"), Some(vec![1, 2, 3, 4, 5, 6, 255, 0]));
    }

    #[test]
    fn composites_over_white_at_each_alpha_boundary() {
        let source = [0, 80, 255, 0, 0, 80, 255, 128, 0, 80, 255, 255];
        assert_eq!(prepare_tile(&source, "paper"), Some(vec![255, 255, 255, 127, 167, 255, 0, 80, 255]));
    }

    #[test]
    fn bounds_packets_and_checks_modes() {
        assert!(prepare_tile(&vec![0; MAX_TILE_BYTES], "split").is_some());
        assert!(prepare_tile(&vec![0; MAX_TILE_BYTES + 4], "split").is_none());
        assert!(prepare_tile(&[0; 3], "split").is_none());
        assert!(prepare_tile(&[0; 4], "unknown").is_none());
    }
}
