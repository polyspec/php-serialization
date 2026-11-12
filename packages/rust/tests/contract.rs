//! Requirements: RQ-001 to RQ-012. Checks the crate against contracts/php-serialize.json, which real PHP writes (make
//! contracts), and contracts/host-values.json, the values of a language that the format refuses and the classes of
//! php_value: one trial per entry, named by its group and its id. An entry gives the arguments of unserialize (data) and
//! of serialize (value) in the case convention of binding (G-5), which this test reads through from_host.

mod common;

use binding_core::Failure;
use common::build::build;
use common::g5::{hex, Host};
use common::tree::{base64, bytes_of, tree};
use libtest_mimic::{Arguments, Failed, Trial};
use polyspec_php_serialization::{
    check_reference, check_std_class, from_host, serialize, unserialize, Error, PhpFloat,
};
use serde_json::Value;

const CONTRACT: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../contracts/php-serialize.json"
);

const HOST_VALUES: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../contracts/host-values.json"
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
    let data = data(entry)?;
    let value = unserialize(&data).map_err(|error| error.to_string())?;
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
    // The argument of serialize in the form of G-5, which a language gives, writes the same bytes (RQ-012). A value
    // that holds an object or a reference twice has no such form.
    if let Some(argument) = entry.get("value") {
        let bytes = serialize(&value_of(argument)?).map_err(|error| error.to_string())?;
        if base64(&bytes) != written {
            return Err(
                format!("the value of G-5 wrote {}", String::from_utf8_lossy(&bytes)).into(),
            );
        }
    }
    Ok(())
}

/// The argument of unserialize, `{"hex": ...}`, which is the bytes that PHP wrote (base64 in bytes).
fn data(entry: &Value) -> Result<Vec<u8>, Failed> {
    let data = hex(entry.get("data").ok_or("the entry has no data")?)?;
    if data != bytes_of(field(entry, "bytes")?)? {
        return Err("data is not the bytes".into());
    }
    Ok(data)
}

/// The value of PHP of a value of G-5 that a language gives.
fn value_of(argument: &Value) -> Result<polyspec_php_serialization::PhpValue, Failed> {
    let mut host = Host::default();
    let top = host.describe(argument)?;
    from_host(&mut host, top).map_err(|failure| Failed::from(describe(&failure)))
}

fn describe(failure: &Failure<Error>) -> String {
    match failure {
        Failure::Kind(error) => format!("raised {} ({error})", error.kind()),
        Failure::Raised(_) => String::from("the host raised"),
        Failure::Callback(error) => format!("a callback failed: {error}"),
    }
}

/// The kind of a failure of from_host or of a constructor, as `raises` names it.
fn check_failure(result: Result<(), Failure<Error>>, entry: &Value) -> Result<(), Failed> {
    match (result, entry.get("raises")) {
        (Ok(()), None) => Ok(()),
        (Ok(()), Some(_)) => Err("took the refused value".into()),
        (Err(Failure::Kind(error)), Some(_)) => check_error(&error, raised(entry)?),
        (Err(failure), _) => Err(describe(&failure).into()),
    }
}

/// The groups of contracts/host-values.json: one group per member (G-5).
fn host_trial(group: &str, entry: &Value) -> Result<(), Failed> {
    let mut host = Host::default();
    let given = |name: &str| {
        entry
            .get(name)
            .ok_or_else(|| Failed::from(format!("the entry has no {name}")))
    };
    match group {
        "serialize" => {
            let top = host.describe(given("value")?)?;
            let result = from_host(&mut host, top).map(drop);
            check_failure(result, entry)
        }
        "php_float.constructor" | "php_float.value" | "php_float.value_of" => {
            let value = given("value")?.as_f64().ok_or("value is no float")?;
            let made = PhpFloat::new(value).value();
            if made.to_bits() != value.to_bits() {
                return Err(format!("{made}, want {value}").into());
            }
            Ok(())
        }
        "std_class.constructor" | "std_class.properties" => {
            let properties = host.properties(given("properties")?)?;
            check_failure(check_std_class(&mut host, Some(properties)), entry)
        }
        "reference.constructor" | "reference.value" => {
            let value = host.describe(given("value")?)?;
            check_failure(check_reference(&mut host, Some(value)), entry)
        }
        other => Err(format!("unknown group {other}").into()),
    }
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
        "rejected" | "stricter" => match unserialize(&data(entry)?) {
            Ok(_) => Err("read the refused bytes".into()),
            Err(error) => {
                if error.offset().is_none() {
                    return Err("an error of unserialize has no offset".into());
                }
                check_error(&error, raised(entry)?)
            }
        },
        // Values that PHP holds and the value refuses when it is built (RQ-008, RQ-009).
        "refused_values" => {
            match build(entry.get("tree").ok_or("the entry has no tree")?)? {
                Ok(_) => return Err("built the refused value".into()),
                Err(error) => check_error(&error, raised(entry)?)?,
            }
            // The same value given by a language is refused the same way (RQ-012).
            let mut host = Host::default();
            let top = host.describe(entry.get("value").ok_or("the entry has no value")?)?;
            check_failure(from_host(&mut host, top).map(drop), entry)
        }
        other => Err(format!("unknown group {other}").into()),
    }
}

fn read(path: &str) -> Result<Value, String> {
    std::fs::read_to_string(path)
        .map_err(|error| error.to_string())
        .and_then(|text| serde_json::from_str::<Value>(&text).map_err(|error| error.to_string()))
}

/// One trial per entry of each group, `trial` checking it.
fn trials_of(
    contract: &Value,
    groups: Vec<String>,
    trial: fn(&str, &Value) -> Result<(), Failed>,
) -> Vec<Trial> {
    let mut trials = Vec::new();
    for group in groups {
        let entries = contract
            .get(&group)
            .and_then(Value::as_array)
            .cloned()
            .into_iter()
            .flatten();
        for (index, entry) in entries.enumerate() {
            let group = group.clone();
            trials.push(match entry.get("id").and_then(Value::as_str) {
                Some(id) => Trial::test(format!("{group}::{id}"), move || trial(&group, &entry)),
                None => Trial::test(format!("{group}::{index}"), || {
                    Err("the entry has no id".into())
                }),
            });
        }
    }
    trials
}

fn main() -> std::process::ExitCode {
    let arguments = Arguments::from_args();
    let mut trials = Vec::new();
    match read(CONTRACT) {
        Ok(contract) => trials.extend(trials_of(
            &contract,
            [
                "cases",
                "forms",
                "deep",
                "rejected",
                "stricter",
                "refused_values",
            ]
            .map(String::from)
            .to_vec(),
            trial,
        )),
        Err(message) => trials.push(Trial::test("contract", move || Err(message.clone().into()))),
    }
    match read(HOST_VALUES) {
        Ok(contract) => {
            let groups = match contract.as_object() {
                Some(groups) => groups
                    .iter()
                    .filter(|(_, entries)| entries.is_array())
                    .map(|(group, _)| group.clone())
                    .collect(),
                None => Vec::new(),
            };
            trials.extend(trials_of(&contract, groups, host_trial));
        }
        Err(message) => trials.push(Trial::test("host-values", move || {
            Err(message.clone().into())
        })),
    }
    libtest_mimic::run(&arguments, trials).exit_code()
}
