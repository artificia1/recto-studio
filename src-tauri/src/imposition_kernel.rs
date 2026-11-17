pub const ZINE_ORDER: [u32; 8] = [5, 4, 3, 2, 6, 7, 8, 1];

pub struct Plan {
    pub pages: u32,
    pub padded: u32,
    pub sheets: u32,
    pub signature_size: u32,
    pub signatures: u32,
    mode: u32,
}

pub struct Side {
    pub sheet: u32,
    pub back: bool,
    pub signature: u32,
    pub creep_steps: u32,
    pub panels: [u32; 8],
}

pub fn plan(pages: u32, mode: u32, signature: u32) -> Option<Plan> {
    if pages > 4096 || mode > 3 || signature == 0 || signature > 4096 { return None; }
    let signature_size = match mode {
        0 => pages.div_ceil(4).max(1) * 4,
        2 => 4,
        3 => 8,
        _ => signature.div_ceil(4) * 4,
    };
    let signatures = pages.div_ceil(signature_size).max(1);
    let padded = signatures * signature_size;
    let sheets = padded / if mode == 3 { 8 } else { 4 };
    Some(Plan { pages, padded, sheets, signature_size, signatures, mode })
}

impl Plan {
    pub fn side_count(&self) -> u32 { self.sheets * if self.mode == 3 { 1 } else { 2 } }

    pub fn side(&self, index: u32) -> Option<Side> {
        if index >= self.side_count() { return None; }
        let mut panels = [0; 8];
        let mut signature = 0;
        let mut creep_steps = 0;
        let sheet = if self.mode == 3 { index } else { index / 2 };
        let back = self.mode != 3 && index % 2 == 1;
        match self.mode {
            3 => {
                signature = sheet;
                panels = ZINE_ORDER.map(|page| sheet * 8 + page);
            }
            2 => { panels[0] = index * 2 + 1; panels[1] = index * 2 + 2; }
            _ => {
                let per_signature = self.signature_size / 4;
                signature = sheet / per_signature;
                creep_steps = sheet % per_signature;
                let low = signature * self.signature_size + 1 + 2 * creep_steps;
                let high = (signature + 1) * self.signature_size - 2 * creep_steps;
                [panels[0], panels[1]] = if back { [low + 1, high - 1] } else { [high, low] };
            }
        }
        for page in &mut panels {
            if *page > self.pages { *page = 0; }
        }
        Some(Side { sheet, back, signature, creep_steps, panels })
    }
}
