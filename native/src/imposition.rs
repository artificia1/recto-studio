#[path = "../../src-tauri/src/imposition_kernel.rs"]
mod kernel;

use serde_json::{json, Value};

pub const TOOL: &str = "recto_plan_imposition";
const MODES: [&str; 4] = ["saddle-stitch", "perfect-bound", "consecutive-2up", "mini-zine-8page"];

pub fn descriptor() -> Value {
    json!({
        "name": TOOL, "description": "Generate printer-order sheets and fold panels from a reader-order page count.",
        "annotations": { "readOnlyHint": true, "destructiveHint": false, "openWorldHint": false },
        "inputSchema": {
            "type": "object", "required": ["pageCount"], "additionalProperties": false,
            "properties": {
                "pageCount": { "type": "integer", "minimum": 1, "maximum": 4096 },
                "pageWidthMm": { "type": "number", "minimum": 1, "maximum": 2000, "default": 210 },
                "pageHeightMm": { "type": "number", "minimum": 1, "maximum": 2000, "default": 297 },
                "bindingMode": { "type": "string", "enum": MODES, "default": "saddle-stitch" },
                "signatureSize": { "type": "integer", "enum": [4, 8, 16, 32] },
                "creepMmPerSheet": { "type": "number", "minimum": 0, "maximum": 0.5, "default": 0.08 },
                "offset": { "type": "integer", "minimum": 0, "maximum": 1000000, "default": 0 },
                "limit": { "type": "integer", "minimum": 1, "maximum": 50, "default": 30 }
            }
        }
    })
}

pub fn run(input: &Value) -> Result<Value, String> {
    let args = input.as_object().ok_or("Pass imposition settings as an object.")?;
    if args.keys().any(|key| !matches!(key.as_str(), "pageCount" | "pageWidthMm" | "pageHeightMm" |
        "bindingMode" | "signatureSize" | "creepMmPerSheet" | "offset" | "limit")) {
        return Err("The imposition arguments contain an unknown field.".into());
    }
    let integer = |key, default, min, max| args.get(key).map_or(Ok(default), |value: &Value|
        value.as_u64().filter(|number| (min..=max).contains(number)).ok_or("Invalid imposition page count or range."));
    let decimal = |key, default, min, max| args.get(key).map_or(Ok(default), |value: &Value|
        value.as_f64().filter(|number| (min..=max).contains(number)).ok_or("Invalid imposition dimension or creep."));
    let count = args.get("pageCount").and_then(Value::as_u64).filter(|value| (1..=4096).contains(value))
        .ok_or("Choose between 1 and 4096 input pages.")? as u32;
    let mode = args.get("bindingMode").map_or(Some(0), |value| {
        value.as_str().and_then(|name| MODES.iter().position(|mode| *mode == name))
    }).ok_or("Choose a supported binding mode.")?;
    let signature = integer("signatureSize", 16, 4, 32)? as u32;
    if ![4, 8, 16, 32].contains(&signature) { return Err("Choose a 4, 8, 16, or 32-page signature.".into()); }
    let width = decimal("pageWidthMm", 210.0, 1.0, 2000.0)?;
    let height = decimal("pageHeightMm", 297.0, 1.0, 2000.0)?;
    let creep = decimal("creepMmPerSheet", 0.08, 0.0, 0.5)?;
    let creep = if mode < 2 { creep } else { 0.0 };
    let offset = integer("offset", 0, 0, 1_000_000)? as u32;
    let limit = integer("limit", 30, 1, 50)? as u32;
    let plan = kernel::plan(count, mode as u32, signature).ok_or("Could not plan imposed sheets.")?;
    let end = (offset + limit).min(plan.side_count());
    let sheet_sides: Vec<_> = (offset..end).filter_map(|index| plan.side(index).map(|side| {
        let panels = side.panels.map(|page| (page > 0).then_some(page));
        let shift = (side.creep_steps as f64) * creep;
        let mut row = json!({
            "sheetIndex": side.sheet, "side": if side.back { "back" } else { "front" }, "sideNumber": index + 1,
            "signatureIndex": side.signature, "leftPageNumber": panels[0], "rightPageNumber": panels[1],
            "leftCreepMm": if shift == 0.0 { 0.0 } else { -shift }, "rightCreepMm": shift
        });
        if mode == 3 { row["panels"] = json!(panels); }
        row
    })).collect();
    Ok(json!({
        "bindingMode": MODES[mode], "totalPagesOriginal": plan.pages, "totalPagesPadded": plan.padded,
        "blankPagesAdded": plan.padded - plan.pages, "sheetsCount": plan.sheets, "signatureSizePages": plan.signature_size,
        "signaturesCount": plan.signatures, "sheetWidthMm": width * if mode == 3 { 4.0 } else { 2.0 },
        "sheetHeightMm": height * if mode == 3 { 2.0 } else { 1.0 }, "pageWidthMm": width, "pageHeightMm": height,
        "creepPerSheetMm": creep, "maxCreepMm": (plan.signature_size / 4 - 1) as f64 * creep,
        "totalSides": plan.side_count(), "sheetSides": sheet_sides, "nextOffset": (end < plan.side_count()).then_some(end)
    }))
}
