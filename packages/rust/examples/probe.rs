//! The probe of make fuzz (scripts/fuzz.mts): reads one base64 input per line from the file of its first argument and
//! writes one JSON line per input to the file of its second argument: {"refused":true} for an error of unserialize with a
//! kind other than internal, {"crash":"..."} for an internal error, an error of serialize or a panic, and otherwise the
//! typed tree and the bytes that the crate writes back.

#[path = "../tests/common/tree.rs"]
mod tree;

use std::process::ExitCode;

use polyspec_php_serialize::{serialize, unserialize};
use serde_json::json;

fn reply(input: &[u8]) -> String {
    let value = match unserialize(input) {
        Ok(value) => value,
        Err(error) if error.kind() == "internal" => {
            return json!({ "crash": error.to_string() }).to_string()
        }
        Err(_) => return "{\"refused\":true}".to_owned(),
    };
    let tree = match tree::tree(&value) {
        Ok(tree) => tree,
        Err(error) => return json!({ "crash": format!("tree: {error}") }).to_string(),
    };
    match serialize(&value) {
        Ok(bytes) => json!({ "tree": tree, "written": tree::base64(&bytes) }).to_string(),
        Err(error) => json!({ "crash": format!("serialize: {error}") }).to_string(),
    }
}

fn run() -> Result<(), String> {
    let mut arguments = std::env::args().skip(1);
    let (Some(input), Some(output)) = (arguments.next(), arguments.next()) else {
        return Err("usage: probe <inputs> <replies>".to_owned());
    };
    let text = std::fs::read_to_string(&input).map_err(|error| format!("{input}: {error}"))?;
    let mut lines = Vec::new();
    for line in text.split('\n') {
        if line.is_empty() && !lines.is_empty() {
            continue;
        }
        let bytes = tree::bytes_of(line)?;
        // B-7: a panic is a crash of the crate, the finding that the fuzz reports.
        lines.push(match std::panic::catch_unwind(|| reply(&bytes)) {
            Ok(reply) => reply,
            Err(_panic) => json!({ "crash": "panic" }).to_string(),
        });
    }
    std::fs::write(&output, format!("{}\n", lines.join("\n")))
        .map_err(|error| format!("{output}: {error}"))
}

fn main() -> ExitCode {
    // The tree of a value is as deep as the value: a thread with a large stack holds the deepest input of the fuzz.
    let worker = std::thread::Builder::new().stack_size(1 << 30).spawn(run);
    let result = match worker {
        Ok(handle) => match handle.join() {
            Ok(result) => result,
            Err(_panic) => Err("the probe panicked".to_owned()),
        },
        Err(error) => Err(format!("thread: {error}")),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}
