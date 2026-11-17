#[derive(Clone, Copy)]
pub struct LineCursor {
    pub column: f64,
    pub y: f64,
}

pub struct Frame {
    pub x: f64,
    pub y: f64,
    pub padding: f64,
    pub bottom: f64,
    pub width: f64,
    pub gutter: f64,
    pub columns: f64,
}

pub struct Grid {
    pub start: f64,
    pub pitch: f64,
}

pub struct Band {
    pub left: f64,
    pub width: f64,
}

pub fn place_line(cursor: &mut LineCursor, frame: Frame, height: f64, grid: Grid,
    mut free_band: impl FnMut(f64, f64, f64, f64) -> Band) -> Option<(f64, f64)> {
    for _ in 0..4096 {
        if grid.pitch > 0.0 {
            cursor.y = grid.start - frame.y +
                ((frame.y + cursor.y - grid.start) / grid.pitch - 0.00001).ceil().max(0.0) * grid.pitch;
        }
        if cursor.y + height > frame.bottom + 0.0001 {
            cursor.column += 1.0;
            cursor.y = frame.padding;
        }
        if cursor.column >= frame.columns || cursor.y + height > frame.bottom + 0.0001 {
            return None;
        }
        let left = frame.x + frame.padding + cursor.column * (frame.width + frame.gutter);
        let band = free_band(left, frame.width, frame.y + cursor.y, height);
        if band.width > 1.0 {
            return Some((band.left - left, band.width));
        }
        cursor.y += height;
    }
    None
}

fn f64_at(bytes: &[u8], offset: usize) -> f64 {
    f64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap())
}

fn band_bounds(points: &[u8], closed: bool, top: f64, bottom: f64) -> Option<(f64, f64)> {
    let mut left = f64::INFINITY;
    let mut right = f64::NEG_INFINITY;
    let mut add = |x: f64| { left = left.min(x); right = right.max(x); };
    let point = |index: usize| (f64_at(points, index * 16), f64_at(points, index * 16 + 8));
    let count = points.len() / 16;
    for index in 0..count {
        let (x, y) = point(index);
        if y >= top && y <= bottom { add(x); }
        if index == 0 && !closed { continue; }
        let (ax, ay) = point(if index == 0 { count - 1 } else { index - 1 });
        if ay != y {
            for boundary in [top, bottom] {
                if boundary >= ay.min(y) && boundary <= ay.max(y) {
                    add(ax + (x - ax) * (boundary - ay) / (y - ay));
                }
            }
        }
    }
    (left <= right).then_some((left, right))
}

/// Reuse interval storage across consecutive probes in the same placement.
pub fn free_band(mut geometry: &[u8], left: f64, width: f64, top: f64, height: f64,
    intervals: &mut Vec<(f64, f64)>) -> Band {
    intervals.clear();
    let right = left + width;
    while let Some(header) = geometry.get(..32) {
        let count = u32::from_le_bytes(header[..4].try_into().unwrap()) as usize;
        if count < 2 || count > (geometry.len() - 32) / 16 { break; }
        let (points, next) = geometry[32..].split_at(count * 16);
        geometry = next;
        let gap = f64_at(header, 8);
        let lower = top - gap;
        let upper = top + height + gap;
        if f64_at(header, 24) < lower || f64_at(header, 16) > upper { continue; }
        if let Some((a, b)) = band_bounds(points, header[4] != 0, lower, upper) {
            let a = left.max(a - gap);
            let b = right.min(b + gap);
            if b > a { intervals.push((a, b)); }
        }
    }
    intervals.sort_unstable_by(|a, b| a.0.total_cmp(&b.0).then_with(|| a.1.total_cmp(&b.1)));
    let mut best = Band { left, width: 0.0 };
    let mut cursor = left;
    for &(start, end) in intervals.iter() {
        if start - cursor > best.width { best = Band { left: cursor, width: start - cursor }; }
        cursor = cursor.max(end);
    }
    if right - cursor > best.width { best = Band { left: cursor, width: right - cursor }; }
    best
}
