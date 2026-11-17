mod mcp;
mod project;
mod imposition;

use cap_std::{ambient_authority, fs::Dir};
use std::{env, fs::File, io, path::Path, process::ExitCode};

const HELP: &str = "Recto native inspection\n\n  recto-native inspect <publication.recto>\n  recto-native mcp --workspace <folder>\n  recto-native --version";

fn run() -> Result<(), String> {
    let args: Vec<_> = env::args_os().skip(1).collect();
    let command = args.first().and_then(|arg| arg.to_str()).unwrap_or("--help");
    match command {
        "--help" | "-h" | "help" if args.len() <= 1 => println!("{HELP}"),
        "--version" | "-v" if args.len() == 1 => println!("recto-native {}", env!("CARGO_PKG_VERSION")),
        "inspect" if args.len() == 2 => {
            let path = Path::new(&args[1]);
            project::check_extension(path)?;
            let file = File::open(path).map_err(|error| format!("Could not open the project: {error}"))?;
            let metadata = file.metadata().map_err(|error| error.to_string())?;
            let report = project::inspect(file, metadata.is_file(), metadata.len(), None, 0, 50)?;
            println!("{}", serde_json::to_string_pretty(&report).map_err(|error| error.to_string())?);
        }
        "mcp" if args.len() == 2 && args[1] == "--help" => println!("recto-native mcp --workspace <folder>"),
        "mcp" if args.len() == 3 && args[1] == "--workspace" => {
            let root = Dir::open_ambient_dir(&args[2], ambient_authority()).map_err(|error| format!("Could not open the workspace: {error}"))?;
            mcp::serve(&root, io::stdin().lock(), io::stdout().lock()).map_err(|error| error.to_string())?;
        }
        _ => return Err(HELP.into()),
    }
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => { eprintln!("{error}"); ExitCode::FAILURE }
    }
}
