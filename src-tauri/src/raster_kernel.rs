pub fn apply_tone(rgba: &mut [u8], table: &[u8; 256], grayscale: bool) {
    for pixel in rgba.chunks_exact_mut(4) {
        if grayscale {
            let light = (0.2126 * f64::from(pixel[0])
                + 0.7152 * f64::from(pixel[1])
                + 0.0722 * f64::from(pixel[2]))
                .round() as usize;
            pixel[..3].fill(table[light]);
        } else {
            for channel in &mut pixel[..3] {
                *channel = table[usize::from(*channel)];
            }
        }
    }
}

#[cfg(any(target_arch = "wasm32", test))]
pub fn mark_proof_difference(before: &[u8], after: &mut [u8]) -> usize {
    let mut changed = 0;
    for (old, current) in before.chunks_exact(4).zip(after.chunks_exact_mut(4)) {
        if old[0].abs_diff(current[0]) > 16
            || old[1].abs_diff(current[1]) > 16
            || old[2].abs_diff(current[2]) > 16
        {
            current[..3].copy_from_slice(&[225, 40, 80]);
            changed += 1;
        }
    }
    changed
}

/// Return whether the source has any non-opaque pixels while writing RGB.
pub fn write_rgb(rgba: &[u8], rgb: &mut [u8], paper: bool) -> bool {
    let mut transparent = false;
    for (pixel, output) in rgba.chunks_exact(4).zip(rgb.chunks_exact_mut(3)) {
        let opacity = u16::from(pixel[3]);
        if paper {
            for (channel, result) in pixel[..3].iter().zip(output) {
                let ink = (255 - u16::from(*channel)) * opacity;
                *result = (255 - (ink + 127) / 255) as u8;
            }
        } else {
            output.copy_from_slice(&pixel[..3]);
        }
        transparent |= opacity < 255;
    }
    transparent
}

pub fn write_alpha(rgba: &[u8], alpha: &mut [u8]) {
    for (pixel, opacity) in rgba.chunks_exact(4).zip(alpha) {
        *opacity = pixel[3];
    }
}

#[cfg(target_arch = "wasm32")]
pub fn restore_straight_alpha(rgba: &mut [u8]) {
    for pixel in rgba.chunks_exact_mut(4) {
        let opacity = u16::from(pixel[3]);
        if opacity > 0 && opacity < 255 {
            for channel in &mut pixel[..3] {
                let straight = (u16::from(*channel) * 255 + opacity / 2) / opacity;
                *channel = straight.min(255) as u8;
            }
        }
    }
}
