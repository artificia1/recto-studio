use std::io::{Cursor, Write};

pub fn classic_xref(entries: &[u8], output: &mut [u8]) -> Option<usize> {
    let mut writer = Cursor::new(output);
    writer.write_all(b"xref\n").ok()?;
    let entry = |index: usize| -> Option<(u32, u32, u64)> {
        let raw = entries.get(index * 16..(index + 1) * 16)?;
        Some((
            u32::from_le_bytes(raw[..4].try_into().ok()?),
            u32::from_le_bytes(raw[4..8].try_into().ok()?),
            u64::from_le_bytes(raw[8..].try_into().ok()?),
        ))
    };
    let count = entries.len() / 16;
    let mut start = 0;
    while start < count {
        let (first, _, _) = entry(start)?;
        let mut end = start + 1;
        while end < count && u64::from(entry(end)?.0) == u64::from(first) + (end - start) as u64 {
            end += 1;
        }
        writeln!(writer, "{first} {}", end - start).ok()?;
        for index in start..end {
            let (number, generation, offset) = entry(index)?;
            if generation > 65_535 || offset > 9_999_999_999 { return None; }
            let status = if number == 0 { 'f' } else { 'n' };
            writeln!(writer, "{offset:010} {generation:05} {status} ").ok()?;
        }
        start = end;
    }
    Some(writer.position() as usize)
}

pub fn classic_footer(xref_offset: u64, output: &mut [u8]) -> Option<usize> {
    let mut writer = Cursor::new(output);
    write!(writer, "startxref\n{xref_offset}\n%%EOF").ok()?;
    Some(writer.position() as usize)
}
