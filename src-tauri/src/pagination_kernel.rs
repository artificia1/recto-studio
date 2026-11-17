pub struct TableRow {
    pub height: f64,
    pub minimum: f64,
    pub lines: u32,
    pub group_end: usize,
}

pub fn table_rows(rows: &[TableRow], frame: f64, mut used: f64, footer: f64, padding: f64, leading: f64,
    consumed: f64, allow_split: bool, mut append: impl FnMut(usize, f64, u32) -> bool) -> Option<()> {
    let minimum = leading + padding * 2.0;
    let mut index = 0;
    while index < rows.len() {
        let row = &rows[index];
        let available = frame - used - footer;
        let mut group_end = row.group_end.max(index + 1);
        let mut scan = index + 1;
        while scan < group_end {
            group_end = group_end.max(rows.get(scan)?.group_end);
            scan += 1;
        }
        if group_end > index + 1 {
            let group = rows.get(index..group_end)?;
            if group.iter().map(|entry| entry.height).sum::<f64>() > available + 0.001 { break; }
            for (position, entry) in group.iter().enumerate() {
                if !append(index + position, entry.height, 0) { return None; }
                used += entry.height;
            }
            index = group_end;
        } else {
            let prior = if index == 0 { consumed } else { 0.0 };
            let required = minimum.max(row.minimum - prior).max(f64::from(row.lines) * leading + padding * 2.0);
            if required > available + 0.001 && (!allow_split || available < minimum) { break; }
            let height = required.min(available);
            let count = ((height - padding * 2.0 + 0.0001) / leading).floor().max(1.0) as u32;
            if !append(index, height, count) { return None; }
            used += height;
            if count < row.lines || prior + height < row.minimum - 0.001 { break; }
            index += 1;
        }
    }
    Some(())
}

#[derive(Clone, Copy)]
pub struct Note {
    pub rows: u32,
    pub label_rows: u32,
    pub anchor: u32, // u32::MAX denotes incoming continuation
    pub started: bool,
}

pub struct NotePlacement {
    pub index: usize,
    pub column: u32,
    pub row: u32,
    pub start: u32,
    pub count: u32,
    pub label: u32,
}

pub fn footnote_columns(notes: &[Note], columns: u32, capacity: u32,
    mut place: impl FnMut(NotePlacement) -> bool) -> Option<(Vec<(usize, u32)>, u32, u32)> {
    let mut carry: Vec<_> = notes.iter().enumerate().filter_map(|(index, note)|
        (note.anchor == u32::MAX).then_some((index, 0))).collect();
    let mut max_rows = 0;
    let mut unplaced = 0;
    for column in 0..columns {
        let anchors: Vec<_> = notes.iter().enumerate().filter_map(|(index, note)| (note.anchor == column).then_some(index)).collect();
        let mut row = 0u32;
        let mut next = Vec::new();
        for (index, start) in carry {
            let note = notes[index];
            let label = if start > 0 || note.started { note.label_rows } else { 0 };
            let room = capacity.saturating_sub(row + anchors.len() as u32 + label);
            if room == 0 { next.push((index, start)); continue; }
            let count = room.min(note.rows - start);
            if !place(NotePlacement { index, column, row, start, count, label }) { return None; }
            row += label + count;
            if start + count < note.rows { next.push((index, start + count)); }
        }
        for (position, index) in anchors.iter().copied().enumerate() {
            let room = capacity.saturating_sub(row + (anchors.len() - position - 1) as u32);
            if room == 0 { unplaced += 1; next.push((index, 0)); continue; }
            let count = room.min(notes[index].rows);
            if !place(NotePlacement { index, column, row, start: 0, count, label: 0 }) { return None; }
            row += count;
            if count < notes[index].rows { next.push((index, count)); }
        }
        carry = next;
        max_rows = max_rows.max(row);
    }
    Some((carry, max_rows, unplaced))
}
