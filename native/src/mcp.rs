use cap_std::fs::Dir;
use serde_json::{json, Value};
use std::io::{self, BufRead, Read, Write};

const MAX_LINE: u64 = 1024 * 1024;
const PROTOCOL: &str = "2025-11-25";
const TOOL: &str = "recto_inspect_publication";

fn descriptor() -> Value {
    json!({
        "name": TOOL,
        "description": "Inventory the saved project's spreads, pages, and element counts. Reads source JSON.",
        "annotations": { "readOnlyHint": true, "destructiveHint": false, "openWorldHint": false },
        "inputSchema": {
            "type": "object", "additionalProperties": false, "required": ["project"],
            "properties": {
                "project": { "type": "string", "minLength": 1, "maxLength": 1024 },
                "revision": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
                "offset": { "type": "integer", "minimum": 0, "maximum": 1000000 },
                "limit": { "type": "integer", "minimum": 1, "maximum": 50 }
            }
        }
    })
}

fn inspect(root: &Dir, args: &Value) -> Result<Value, String> {
    let args = args.as_object().ok_or("Pass a project in the tool arguments.")?;
    if args.keys().any(|key| !matches!(key.as_str(), "project" | "revision" | "offset" | "limit")) {
        return Err("The inspection arguments contain an unknown field.".into());
    }
    let path = args.get("project").and_then(Value::as_str).ok_or("Pass a workspace-relative project path.")?;
    let revision = args.get("revision").map(|value| {
        value.as_str().filter(|text| text.len() == 64 && text.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)))
            .ok_or("Pass a lowercase SHA-256 revision.")
    }).transpose()?;
    let bound = |key, default, min, max| {
        args.get(key).map_or(Ok(default), |value|
            value.as_u64().filter(|number| (min..=max).contains(number)).ok_or("Invalid inspection pagination."))
    };
    let offset = bound("offset", 0, 0, 1_000_000)? as usize;
    let limit = bound("limit", 30, 1, 50)? as usize;
    crate::project::inspect_workspace(root, path, revision, offset, limit)
}

pub fn serve(root: &Dir, mut input: impl BufRead, mut output: impl Write) -> io::Result<()> {
    let mut line = Vec::new();
    let mut negotiated = false;
    loop {
        line.clear();
        if (&mut input).take(MAX_LINE + 1).read_until(b'\n', &mut line)? == 0 { break; }
        if line.len() as u64 > MAX_LINE {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "MCP message exceeds 1 MiB."));
        }
        let message = serde_json::from_slice::<Value>(&line);
        let response = match message {
            Ok(request) => {
                let id = request.get("id");
                let method = request.get("method").and_then(Value::as_str);
                if request["jsonrpc"].as_str() != Some("2.0") || method.is_none() ||
                    id.is_some_and(|id| !(id.is_string() || id.is_i64() || id.is_u64())) {
                    error(Value::Null, -32600, "Invalid request")
                } else if let Some(id) = id {
                    let params = &request["params"];
                    let result = match method.unwrap() {
                        "initialize" if !negotiated => {
                            let requested = params["protocolVersion"].as_str().unwrap_or(PROTOCOL);
                            let version = if requested == "2025-06-18" { requested } else { PROTOCOL };
                            negotiated = true;
                            Ok(json!({ "protocolVersion": version, "capabilities": { "tools": {} },
                                "serverInfo": { "name": "recto-native", "version": env!("CARGO_PKG_VERSION") } }))
                        }
                        "server/discover" => Err((-32601, "Method not found")),
                        "ping" => Ok(json!({})),
                        _ if !negotiated => Err((-32002, "Server has not initialized")),
                        "tools/list" => Ok(json!({ "tools": [descriptor()] })),
                        "tools/call" if params["name"].as_str() == Some(TOOL) => {
                            Ok(match inspect(root, &params["arguments"]) {
                                Ok(value) => json!({ "structuredContent": value, "content": [{ "type": "text", "text": value.to_string() }] }),
                                Err(message) => json!({ "isError": true, "content": [{ "type": "text", "text": message }] }),
                            })
                        }
                        "tools/call" => Err((-32602, "Unknown tool")),
                        _ => Err((-32601, "Method not found")),
                    };
                    match result {
                        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
                        Err((code, message)) => error(id.clone(), code, message),
                    }
                } else {
                    // Notifications never receive a JSON-RPC reply.
                    continue;
                }
            }
            Err(_) => error(Value::Null, -32700, "Parse error"),
        };
        serde_json::to_writer(&mut output, &response)?;
        output.write_all(b"\n")?;
        output.flush()?;
    }
    Ok(())
}

fn error(id: Value, code: i32, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}
