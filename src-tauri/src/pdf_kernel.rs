use std::io::{Cursor, Write};

fn classic_record(raw: &[u8]) -> (u32, u32, u64) {
    (
        u32::from_le_bytes(raw[..4].try_into().unwrap()),
        u32::from_le_bytes(raw[4..8].try_into().unwrap()),
        u64::from_le_bytes(raw[8..16].try_into().unwrap()),
    )
}

fn write_classic_rows(entries: &[u8], writer: &mut Cursor<&mut [u8]>, range_length: usize) -> Option<()> {
    if range_length != 0 {
        let (first, _, _) = classic_record(entries.get(..16)?);
        writeln!(writer, "{first} {range_length}").ok()?;
    }
    for row in entries.chunks_exact(16) {
        let (number, generation, offset) = classic_record(row);
        if generation > 65_535 || offset > 9_999_999_999 { return None; }
        let status = if number == 0 { 'f' } else { 'n' };
        writeln!(writer, "{offset:010} {generation:05} {status} ").ok()?;
    }
    Some(())
}

pub fn classic_rows(entries: &[u8], output: &mut [u8], range_length: usize) -> Option<usize> {
    let mut writer = Cursor::new(output);
    write_classic_rows(entries, &mut writer, range_length)?;
    Some(writer.position() as usize)
}

pub fn classic_xref(entries: &[u8], output: &mut [u8]) -> Option<usize> {
    let mut writer = Cursor::new(output);
    writer.write_all(b"xref\n").ok()?;
    let entry = |index: usize| -> Option<(u32, u32, u64)> {
        Some(classic_record(entries.get(index * 16..(index + 1) * 16)?))
    };
    let count = entries.len() / 16;
    let mut start = 0;
    while start < count {
        let (first, _, _) = entry(start)?;
        let mut end = start + 1;
        while end < count && u64::from(entry(end)?.0) == u64::from(first) + (end - start) as u64 {
            end += 1;
        }
        write_classic_rows(&entries[start * 16..end * 16], &mut writer, end - start)?;
        start = end;
    }
    Some(writer.position() as usize)
}

pub fn classic_footer(xref_offset: u64, output: &mut [u8]) -> Option<usize> {
    let mut writer = Cursor::new(output);
    write!(writer, "startxref\n{xref_offset}\n%%EOF").ok()?;
    Some(writer.position() as usize)
}

/// Build the /ObjStm index and copy serialized PDF objects into their indexed positions.
pub fn object_stream(records: &[u8], objects: &[u8], output: &mut [u8]) -> Option<(usize, usize)> {
    let mut writer = Cursor::new(output);
    let size = |record: &[u8]| u32::from_le_bytes(record[4..8].try_into().unwrap()) as usize;
    let mut offset = 0usize;
    for record in records.chunks_exact(8) {
        let number = u32::from_le_bytes(record[..4].try_into().unwrap());
        write!(writer, "{number} {offset} ").ok()?;
        offset = offset.checked_add(size(record) + 1)?;
    }
    let first = writer.position() as usize;
    let mut cursor = 0usize;
    for record in records.chunks_exact(8) {
        let end = cursor.checked_add(size(record))?;
        writer.write_all(objects.get(cursor..end)?).ok()?;
        writer.write_all(b"\n").ok()?;
        cursor = end;
    }
    if cursor != objects.len() { return None; }
    Some((first, writer.position() as usize))
}

/// Encode PDF /W fields as big-endian integers and generate its sparse /Index.
/// Input records carry object number, type, byte offset or stream ID, and generation or stream index.
pub fn stream_xref(entries: &[u8], output: &mut [u8]) -> Option<usize> {
    const RECORD: usize = 24;
    fn fields(raw: &[u8]) -> [u64; 3] {
        [
            u64::from(raw[4]),
            u64::from_le_bytes(raw[8..16].try_into().unwrap()),
            u64::from(u32::from_le_bytes(raw[16..20].try_into().unwrap())),
        ]
    }
    let number = |record: &[u8]| u32::from_le_bytes(record[..4].try_into().unwrap());
    let mut maxima = [0_u64; 3];
    let mut previous: Option<u32> = None;
    let mut ranges = 0_usize;
    let mut index = 8;
    for (row, record) in entries.chunks_exact(RECORD).enumerate() {
        let current = number(record);
        if previous.is_some_and(|last| last >= current) || record[4] > 2 { return None; }
        if previous.and_then(|last| last.checked_add(1)) != Some(current) {
            if ranges > 0 {
                let start = u32::from_le_bytes(output.get(index - 4..index)?.try_into().ok()?);
                output.get_mut(index - 4..index)?.copy_from_slice(&(row as u32 - start).to_le_bytes());
            }
            output.get_mut(index..index + 4)?.copy_from_slice(&current.to_le_bytes());
            output.get_mut(index + 4..index + 8)?.copy_from_slice(&(row as u32).to_le_bytes());
            index += 8;
            ranges += 1;
        }
        previous = Some(current);
        for (max, field) in maxima.iter_mut().zip(fields(record)) { *max = (*max).max(field); }
    }
    if ranges == 0 { return None; }
    let start = u32::from_le_bytes(output.get(index - 4..index)?.try_into().ok()?);
    output.get_mut(index - 4..index)?.copy_from_slice(&(entries.len() as u32 / RECORD as u32 - start).to_le_bytes());
    let widths = maxima.map(|field| ((64 - field.leading_zeros()).max(1) as usize).div_ceil(8));
    output[..4].copy_from_slice(&[widths[0] as u8, widths[1] as u8, widths[2] as u8, 0]);
    output[4..8].copy_from_slice(&(ranges as u32).to_le_bytes());
    for record in entries.chunks_exact(RECORD) {
        for (field, width) in fields(record).into_iter().zip(widths) {
            output.get_mut(index..index + width)?.copy_from_slice(&field.to_be_bytes()[8 - width..]);
            index += width;
        }
    }
    Some(index)
}
