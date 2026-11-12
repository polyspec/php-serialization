//! Requirements: RQ-001 to RQ-010. Checks the crate against contracts/php-serialize.json, which real PHP writes (make
//! contracts): one trial per entry, named by its group and its id.

mod common;

use common::build::build;
use common::tree::{base64, bytes_of, tree};
use libtest_mimic::{Arguments, Failed, Trial};
use polyspec_php_serialization::{serialize, unserialize, Error};
use serde_json::Value;

const CONTRACT: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../contracts/php-serialize.json"
);

fn field<'a>(entry: &'a Value, name: &str) -> Result<&'a str, Failed> {
    entry
        .get(name)
        .and_then(Value::as_str)
        .ok_or_else(|| Failed::from(format!("the entry has no text {name}")))
}

/// The kind that `raises` of an entry names, with the category and status of RQ-010.
fn raised(entry: &Value) -> Result<&str, Failed> {
    let raises = entry.get("raises").ok_or("the entry has no raises")?;
    if raises.get("status") != Some(&Value::Null)
        || raises.get("category").and_then(Value::as_str) != Some("value")
    {
        return Err("raises names a status or a category other than value".into());
    }
    field(raises, "kind")
}

fn check_error(error: &Error, kind: &str) -> Result<(), Failed> {
    if error.kind() != kind {
        return Err(format!("raised {} ({error}), expected {kind}", error.kind()).into());
    }
    if error.status().is_some() {
        return Err("an error has a status".into());
    }
    Ok(())
}

/// cases and forms: the tree of the bytes and the bytes that serialize writes back (RQ-001 to RQ-005).
fn read_case(entry: &Value, written: &str) -> Result<(), Failed> {
    let value =
        unserialize(&bytes_of(field(entry, "bytes")?)?).map_err(|error| error.to_string())?;
    let expected = entry.get("tree").ok_or("the entry has no tree")?;
    let actual = tree(&value).map_err(|error| error.to_string())?;
    if &actual != expected {
        return Err(format!("tree {actual} differs from {expected}").into());
    }
    let bytes = serialize(&value).map_err(|error| error.to_string())?;
    if base64(&bytes) != written {
        return Err(format!("wrote {}", String::from_utf8_lossy(&bytes)).into());
    }
    // The building of a value takes the tree that PHP holds and writes the same bytes (RQ-008).
    let built = build(expected)?.map_err(|error| error.to_string())?;
    let bytes = serialize(&built).map_err(|error| error.to_string())?;
    if base64(&bytes) != written {
        return Err(format!("the built value wrote {}", String::from_utf8_lossy(&bytes)).into());
    }
    Ok(())
}

fn trial(group: &str, entry: &Value) -> Result<(), Failed> {
    match group {
        "cases" => read_case(entry, field(entry, "bytes")?),
        "forms" => read_case(entry, field(entry, "written")?),
        // The deepest values that PHP reads, written back unchanged (RQ-006).
        "deep" => {
            let bytes = bytes_of(field(entry, "bytes")?)?;
            let value = unserialize(&bytes).map_err(|error| error.to_string())?;
            if serialize(&value).map_err(|error| error.to_string())? != bytes {
                return Err("wrote other bytes".into());
            }
            Ok(())
        }
        "rejected" | "stricter" => match unserialize(&bytes_of(field(entry, "bytes")?)?) {
            Ok(_) => Err("read the refused bytes".into()),
            Err(error) => {
                if error.offset().is_none() {
                    return Err("an error of unserialize has no offset".into());
                }
                check_error(&error, raised(entry)?)
            }
        },
        // Values that PHP holds and the value refuses when it is built (RQ-008, RQ-009).
        "refused_values" => match build(entry.get("tree").ok_or("the entry has no tree")?)? {
            Ok(_) => Err("built the refused value".into()),
            Err(error) => check_error(&error, raised(entry)?),
        },
        other => Err(format!("unknown group {other}").into()),
    }
}

fn main() -> std::process::ExitCode {
    let arguments = Arguments::from_args();
    let trials = match std::fs::read_to_string(CONTRACT)
        .map_err(|error| error.to_string())
        .and_then(|text| serde_json::from_str::<Value>(&text).map_err(|error| error.to_string()))
    {
        Ok(contract) => {
            let mut trials = Vec::new();
            for group in [
                "cases",
                "forms",
                "deep",
                "rejected",
                "stricter",
                "refused_values",
            ] {
                let entries = contract
                    .get(group)
                    .and_then(Value::as_array)
                    .cloned()
                    .into_iter()
                    .flatten();
                for (index, entry) in entries.enumerate() {
                    let group = group.to_owned();
                    trials.push(match entry.get("id").and_then(Value::as_str) {
                        Some(id) => {
                            Trial::test(format!("{group}::{id}"), move || trial(&group, &entry))
                        }
                        None => Trial::test(format!("{group}::{index}"), || {
                            Err("the entry has no id".into())
                        }),
                    });
                }
            }
            trials
        }
        Err(message) => vec![Trial::test("contract", move || Err(message.clone().into()))],
    };
    libtest_mimic::run(&arguments, trials).exit_code()
}
