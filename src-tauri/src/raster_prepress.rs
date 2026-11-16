const MAX_TILE_BYTES: usize = 1024 * 1024;

pub fn prepare_tile(rgba: &[u8], mode: &str) -> Option<Vec<u8>> {
    if rgba.is_empty() || rgba.len() > MAX_TILE_BYTES || rgba.len() % 4 != 0 {
        return None;
    }
    let paper = match mode {
        "split" => false,
        "paper" => true,
        _ => return None,
    };
    let rgb_length = rgba.len() / 4 * 3;
    let mut output = vec![0; rgb_length];
    if write_rgb(rgba, &mut output, paper) && !paper {
        output.reserve_exact(rgba.len() - rgb_length);
        output.resize(rgba.len(), 0);
        write_alpha(rgba, &mut output[rgb_length..]);
    }
    Some(output)
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
use crate::raster_kernel::{write_alpha, write_rgb};
