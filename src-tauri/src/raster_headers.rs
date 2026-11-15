const MAX_PIXELS: u64 = 40_000_000;
pub const MAX_HEADER_BYTES: usize = 16 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub struct RasterDimensions {
    pub width: u32,
    pub height: u32,
    pub cmyk: bool,
}

pub fn probe(bytes: &[u8], media_type: &str) -> Option<RasterDimensions> {
    if bytes.len() > MAX_HEADER_BYTES {
        return None;
    }
    let (width, height, cmyk) = match media_type {
        "image/png" if bytes.starts_with(b"\x89PNG\r\n\x1a\n") => (
            u32::from_be_bytes(bytes.get(16..20)?.try_into().ok()?),
            u32::from_be_bytes(bytes.get(20..24)?.try_into().ok()?),
            false,
        ),
        "image/gif" if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") => (
            u16::from_le_bytes(bytes.get(6..8)?.try_into().ok()?).into(),
            u16::from_le_bytes(bytes.get(8..10)?.try_into().ok()?).into(),
            false,
        ),
        "image/jpeg" if bytes.starts_with(b"\xff\xd8") => jpeg_dimensions(bytes)?,
        "image/webp" if bytes.starts_with(b"RIFF") && bytes.get(8..12)? == b"WEBP" => {
            webp_dimensions(bytes)?
        }
        _ => return None,
    };
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_PIXELS {
        return None;
    }
    Some(RasterDimensions { width, height, cmyk })
}

fn jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32, bool)> {
    let mut offset = 2;
    while *bytes.get(offset)? == 0xff {
        while bytes.get(offset) == Some(&0xff) {
            offset += 1;
        }
        let marker = *bytes.get(offset)?;
        offset += 1;
        match marker {
            0xda | 0xd9 => return None,
            1 | 0xd0..=0xd8 => continue,
            _ => {}
        }
        let length = usize::from(u16::from_be_bytes(bytes.get(offset..offset + 2)?.try_into().ok()?));
        if length < 2 {
            return None;
        }
        let segment = bytes.get(offset..offset + length)?;
        if matches!(marker, 0xc0..=0xcf) && !matches!(marker, 0xc4 | 0xc8 | 0xcc) && length >= 8 {
            let height = u16::from_be_bytes([segment[3], segment[4]]);
            let width = u16::from_be_bytes([segment[5], segment[6]]);
            return Some((width.into(), height.into(), segment[7] == 4));
        }
        offset += length;
    }
    None
}

fn webp_dimensions(bytes: &[u8]) -> Option<(u32, u32, bool)> {
    let header = bytes.get(..30)?;
    let (width, height) = match &header[12..16] {
        b"VP8X" => (
            u32::from_le_bytes([header[24], header[25], header[26], 0]) + 1,
            u32::from_le_bytes([header[27], header[28], header[29], 0]) + 1,
        ),
        b"VP8 " => (
            u32::from(u16::from_le_bytes([header[26], header[27]]) & 0x3fff),
            u32::from(u16::from_le_bytes([header[28], header[29]]) & 0x3fff),
        ),
        b"VP8L" if header[20] == 0x2f => {
            let bits = u32::from_le_bytes(header[21..25].try_into().ok()?);
            ((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
        }
        _ => return None,
    };
    Some((width, height, false))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probes_png_gif_and_webp_without_decoding_pixels() {
        let png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x03\0\0\0\x02";
        let gif = b"GIF89a\x03\0\x02\0";
        let mut webp = [0; 30];
        webp[..16].copy_from_slice(b"RIFF\0\0\0\0WEBPVP8X");
        webp[24] = 2;
        webp[27] = 1;
        let expected = Some(RasterDimensions { width: 3, height: 2, cmyk: false });
        assert_eq!(probe(png, "image/png"), expected);
        assert_eq!(probe(gif, "image/gif"), expected);
        assert_eq!(probe(&webp, "image/webp"), expected);
    }

    #[test]
    fn detects_cmyk_and_handles_truncated_jpeg_markers() {
        let jpeg = [0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 8, 8, 0, 2, 0, 3, 4];
        assert_eq!(probe(&jpeg, "image/jpeg"), Some(RasterDimensions { width: 3, height: 2, cmyk: true }));
        for end in 0..jpeg.len() {
            assert!(probe(&jpeg[..end], "image/jpeg").is_none());
        }
    }

    #[test]
    fn rejects_excessive_dimensions_and_payloads() {
        assert!(probe(b"GIF89a\xff\xff\xff\xff", "image/gif").is_none());
        assert!(probe(&vec![0; MAX_HEADER_BYTES + 1], "image/png").is_none());
    }
}
