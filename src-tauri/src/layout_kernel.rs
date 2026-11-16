#[derive(Clone, Copy)]
pub struct Item {
    pub kind: u8,
    pub width: f64,
    pub stretch: f64,
    pub shrink: f64,
    pub penalty: f64,
    pub flagged: bool,
}

#[derive(Clone, Copy, Default)]
struct Metrics {
    width: f64,
    stretch: f64,
    shrink: f64,
}

struct Break {
    item: usize,
    previous: usize,
    line: usize,
    fitness: usize,
    cost: f64,
    ratio: f64,
    metrics: Metrics,
}

pub fn optimal_breaks(items: &[Item], widths: &[f64], tolerance: f64, hyphen_cost: f64) -> Option<Vec<(usize, f64)>> {
    if items.is_empty() { return Some(Vec::new()); }
    let mut active = vec![Break {
        item: usize::MAX, previous: 0, line: 0, fitness: 1,
        cost: 0.0, ratio: 0.0, metrics: Metrics::default(),
    }];
    let mut terminal = None;
    for (index, item) in items.iter().enumerate() {
        let legal = (item.kind == 2 && item.penalty < 10_000.0)
            || (item.kind == 1 && index > 0 && items[index - 1].kind == 0);
        let mut candidates: [Option<Break>; 4] = Default::default();
        let mut order = [0; 4];
        let mut count = 0;
        for (previous, node) in active.iter_mut().enumerate() {
            if legal {
                let penalty = if item.kind == 2 { item.penalty } else { 0.0 };
                let end_width = if penalty > 0.0 { item.width } else { 0.0 };
                let diff = widths[node.line.min(widths.len() - 1)] - (node.metrics.width + end_width);
                let ratio = if diff > 0.0 && node.metrics.stretch > 0.0 {
                    diff / node.metrics.stretch
                } else if diff < 0.0 {
                    if node.metrics.shrink > 0.0 { diff / node.metrics.shrink } else { -10.0 }
                } else { 0.0 };
                if ratio >= -1.0 && ratio <= tolerance {
                    let fitness = if ratio < -0.5 { 0 } else if ratio <= 0.5 { 1 } else if ratio <= 1.0 { 2 } else { 3 };
                    let r = ratio.abs();
                    let badness = 1.0 + 100.0 * (r * r * r);
                    let mut cost = (badness + penalty.max(0.0)).powi(2);
                    if penalty < 0.0 && penalty > -10_000.0 { cost -= penalty * penalty; }
                    if item.flagged && previous > 0 && items[node.item].flagged { cost += hyphen_cost; }
                    if node.fitness.abs_diff(fitness) > 1 { cost += 1000.0; }
                    cost += node.cost;
                    let candidate = &mut candidates[fitness];
                    if candidate.is_none() {
                        order[count] = fitness;
                        count += 1;
                    }
                    if candidate.as_ref().is_none_or(|best| cost < best.cost) {
                        *candidate = Some(Break { item: index, previous, line: node.line + 1,
                            fitness, cost, ratio, metrics: Metrics::default() });
                    }
                }
            }
            if item.kind <= 1 { node.metrics.width += item.width; }
            if item.kind == 1 {
                node.metrics.stretch += item.stretch;
                node.metrics.shrink += item.shrink;
            }
        }
        for &fitness in &order[..count] {
            let candidate = candidates[fitness].take()?;
            if index + 1 == items.len() && terminal.is_none_or(|best: usize| candidate.cost < active[best].cost) {
                terminal = Some(active.len());
            }
            active.push(candidate);
        }
    }
    let mut index = terminal?;
    let mut path = Vec::with_capacity(active[index].line);
    while index != 0 {
        let node = &active[index];
        path.push((node.item, node.ratio));
        index = node.previous;
    }
    path.reverse();
    Some(path)
}

/// Find all line starts for a uniform-width run of measured tokens. A wide token
/// requires the host's grapheme-aware recovery, so leave that run to the host.
pub fn uniform_line_starts(
    tokens: impl Iterator<Item = (f64, bool)>,
    minimum_width: f64,
    mut next_width: impl FnMut() -> f64,
    mut record: impl FnMut(usize),
) -> bool {
    let mut used = 0.0;
    let mut width = next_width();
    for (index, (advance, whitespace)) in tokens.enumerate() {
        if advance > minimum_width { return false; }
        let limit = if whitespace { width + 0.0001 } else { width };
        if used != 0.0 && used + advance > limit {
            record(index);
            used = 0.0;
            width = next_width();
        }
        used += advance;
    }
    true
}
