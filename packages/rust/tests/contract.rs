//! Requirements: RQ-001 to RQ-012. Checks the crate against contracts/php-serialize.json, which real PHP writes (make
//! contracts), and contracts/host-values.json, the values of a language that the format refuses and the classes of
//! php_value: one trial per entry, named by its group and its id. An entry gives the arguments of unserialize (data) and
//! of serialize (value) in the case convention of binding (G-5), which this test reads through from_host.

mod common;

use binding_core::Failure;
use binding_core::{OutValue, OutValues};
use common::build::build;
use common::g5::{hex, Host, MAX_SAFE_INTEGER};
use common::tree::{base64, bytes_of, tree};
use libtest_mimic::{Arguments, Failed, Trial};
use polyspec_php_serialization::{
    check_reference, check_std_class, from_host, serialize, to_host, unserialize, Error, PhpFloat,
    PhpValue,
};
use serde_json::Value;
use std::collections::HashMap;

const CONTRACT: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../contracts/php-serialize.json"
);

const HOST_VALUES: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../contracts/host-values.json"
);

/// The interface contract, whose rows of `cases` link the groups of the case files to the generated tests (binding K-1).
const INTERFACE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/interface.json");

/// Every group of the case files is named by a row of `cases` of the interface contract, so that the generated tests of
/// the bindings run it (binding K-1, U-7): a group that no row names is checked here alone.
fn linked() -> Result<(), Failed> {
    let interface = read(INTERFACE)?;
    let rows = interface
        .get("cases")
        .and_then(Value::as_array)
        .ok_or("the interface has no cases")?;
    let mut unlinked = Vec::new();
    for (path, file) in [
        (CONTRACT, "contracts/php-serialize.json"),
        (HOST_VALUES, "contracts/host-values.json"),
    ] {
        let contract = read(path)?;
        for (group, entries) in contract.as_object().into_iter().flatten() {
            let named = rows.iter().any(|row| {
                row.get("file").and_then(Value::as_str) == Some(file)
                    && row.get("group").and_then(Value::as_str) == Some(group.as_str())
            });
            if entries.is_array() && !named {
                unlinked.push(format!("{file} {group}"));
            }
        }
    }
    if unlinked.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "no row of cases of the interface names the groups {}",
            unlinked.join(", ")
        )
        .into())
    }
}

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
    given_value(entry, &value, written)
}

/// The argument of serialize in the form of G-5, which a language gives, writes the same bytes (RQ-012); every case
/// gives it, an object held again and a reference inside its own value named by their ids, and the deepest objects as
/// a repeated object.
fn given_value(entry: &Value, value: &PhpValue, written: &str) -> Result<(), Failed> {
    let argument = entry.get("value").ok_or("the case gives no value of G-5")?;
    let taken = value_of(argument)?;
    let bytes = serialize(&taken).map_err(|error| error.to_string())?;
    if base64(&bytes) != written {
        return Err(format!("the value of G-5 wrote {}", String::from_utf8_lossy(&bytes)).into());
    }
    serialized(entry, &bytes)?;
    // RQ-013, U-1: to_host describes the value of the bytes as the case does, and a value that from_host took goes
    // back to the language unchanged.
    same_out(value, argument, "the value of the bytes")?;
    same_out(&taken, argument, "the value that from_host took")?;
    Ok(())
}

/// The result of serialize that a case gives, `serialized` in the form of G-5, which the generated tests of the
/// bindings compare (GN-13e): the bytes that the value writes.
fn serialized(entry: &Value, bytes: &[u8]) -> Result<(), Failed> {
    let given = hex(entry
        .get("serialized")
        .ok_or("the case gives no serialized")?)?;
    if given != bytes {
        return Err(format!(
            "serialized is {}, the value writes {}",
            String::from_utf8_lossy(&given),
            String::from_utf8_lossy(bytes)
        )
        .into());
    }
    Ok(())
}

/// A higher-ranked helper of the form of design U-7 (a'): `out` takes `&T` and gives `(OutValue, V)` where `V:
/// OutValues` may borrow the value. binding_core will give it as `assert_out`; until then this test states it.
trait OutFn<'a, T: 'a>: Fn(&'a T) -> (OutValue, <Self as OutFn<'a, T>>::Values) {
    type Values: OutValues;
}

impl<'a, T: 'a, F, V: OutValues> OutFn<'a, T> for F
where
    F: Fn(&'a T) -> (OutValue, V),
{
    type Values = V;
}

fn assert_out<T, F: for<'a> OutFn<'a, T>>(_: F) {}

/// Compares what to_host gives for a value with a value of G-5, one level at a time, so that a value as deep as the
/// format reads needs no deep stack. A list of G-5 is an array whose keys are 0 to n-1, and a repeated list is its n
/// lists, and a repeated object its n objects. A reference, and an object that the value holds again, gives its id
/// and its value at its first place and its id alone at every later one.
fn same_out(value: &PhpValue, expected: &Value, what: &str) -> Result<(), Failed> {
    assert_out::<PhpValue, _>(to_host);
    let (top, mut children) = to_host(value);
    let mut references: HashMap<u64, u64> = HashMap::new();
    let mut objects: HashMap<u64, Option<u64>> = HashMap::new();
    let mut pending = vec![(top, expected.clone())];
    while let Some((out, want)) = pending.pop() {
        let differ = |actual: &str| -> Failed {
            format!("{what}: to_host gives {actual}, the case {want}").into()
        };
        match out {
            OutValue::Map(map) => {
                let pairs = pairs_of(&want, &["map", "list"]).ok_or_else(|| differ("an array"))?;
                if u64::try_from(pairs.len()).map_err(|error| error.to_string())? != map.len() {
                    return Err(differ(&format!("an array of {} entries", map.len())));
                }
                let mut level = Vec::new();
                for (at, (key, item)) in (0..map.len()).zip(pairs) {
                    let (actual, child) = children.entry(map.handle(), at);
                    if key_of(&actual) != key {
                        return Err(differ(&format!("the key {}", key_of(&actual))));
                    }
                    level.push((child, item));
                }
                pending.extend(level.into_iter().rev());
            }
            OutValue::Object { handle, len } => {
                let id = want.get("id").and_then(Value::as_u64);
                if let Some(first) = objects.get(&handle.raw()) {
                    if first.is_none() || *first != id || want.get("value").is_some() {
                        return Err(differ(&format!("the object {first:?} again")));
                    }
                    continue;
                }
                objects.insert(handle.raw(), id);
                let pairs = pairs_of(&want, &["object"]).ok_or_else(|| differ("an object"))?;
                if u64::try_from(pairs.len()).map_err(|error| error.to_string())? != len {
                    return Err(differ(&format!("an object of {len} properties")));
                }
                let mut level = Vec::new();
                for (at, (key, item)) in (0..len).zip(pairs) {
                    let (name, child) = children.entry(handle, at);
                    if key_of(&name) != key {
                        return Err(differ(&format!("the property {}", key_of(&name))));
                    }
                    level.push((child, item));
                }
                pending.extend(level.into_iter().rev());
            }
            OutValue::Reference { handle, value } => {
                let held = (want.get("kind").and_then(Value::as_str) == Some("reference"))
                    .then(|| want.get("value"))
                    .flatten()
                    .ok_or_else(|| differ("a reference"))?;
                let id = held.get("id").and_then(Value::as_u64);
                if let Some(first) = references.get(&handle.raw()) {
                    if Some(*first) != id || held.get("value").is_some() {
                        return Err(differ(&format!("the reference {first} again")));
                    }
                    continue;
                }
                let id = id.ok_or_else(|| differ("a reference without an id"))?;
                references.insert(handle.raw(), id);
                let target = held
                    .get("value")
                    .cloned()
                    .ok_or_else(|| differ(&format!("the first place of the reference {id}")))?;
                pending.push((*value, target));
            }
            other => {
                let actual = scalar_of(other);
                if actual != want {
                    return Err(differ(&actual.to_string()));
                }
            }
        }
    }
    Ok(())
}

/// The entries that a value of G-5 of one of the kinds gives, as pairs of a key of G-5 and a value: the pairs of a map
/// or an object, the items of a list under the keys 0 to n-1, and the one list or object inside a repeated one.
fn pairs_of(value: &Value, kinds: &[&str]) -> Option<Vec<(Value, Value)>> {
    let kind = value.get("kind").and_then(Value::as_str)?;
    if !kinds.contains(&kind) {
        return None;
    }
    let content = value.get("value")?;
    if kind == "object" {
        if let Some(repeat) = value.get("repeat") {
            let repeat = repeat.as_u64()?;
            let key = value.get("key")?.clone();
            let item = if repeat > 1 {
                serde_json::json!({"kind": "object", "repeat": repeat - 1, "key": key, "value": content})
            } else {
                content.clone()
            };
            return Some(vec![(key, item)]);
        }
    }
    if kind == "list" {
        if let Some(repeat) = value.get("repeat") {
            let repeat = repeat.as_u64()?;
            let item = if repeat > 1 {
                serde_json::json!({"kind": "list", "repeat": repeat - 1, "value": content})
            } else {
                content.clone()
            };
            return Some(vec![(serde_json::json!({"int": 0}), item)]);
        }
        let items = content.as_array()?;
        return Some(
            items
                .iter()
                .enumerate()
                .map(|(at, item)| (serde_json::json!({"int": at}), item.clone()))
                .collect(),
        );
    }
    content
        .as_array()?
        .iter()
        .map(|pair| Some((pair.get(0)?.clone(), pair.get(1)?.clone())))
        .collect()
}

fn hex_of(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// The key of an entry as G-5 writes it.
fn key_of(key: &OutValue) -> Value {
    match key {
        OutValue::Int(number) => serde_json::json!({"int": number.value()}),
        OutValue::Bytes(bytes) => serde_json::json!({"hex": hex_of(bytes.value())}),
        other => serde_json::json!({"unexpected": format!("{:?}", other.kind())}),
    }
}

/// A value of to_host that holds no other value, as a value of G-5.
fn scalar_of(out: OutValue) -> Value {
    use serde_json::json;
    match out {
        OutValue::Null => json!({"kind": "null"}),
        OutValue::Bool(flag) => json!({"kind": "bool", "value": flag}),
        OutValue::Int(number) => {
            let value = number.value();
            // G-5: an integer outside the safe integers of JavaScript is its decimal text.
            if value.unsigned_abs() > MAX_SAFE_INTEGER.unsigned_abs() {
                json!({"kind": "int", "value": value.to_string()})
            } else {
                json!({"kind": "int", "value": value})
            }
        }
        OutValue::Float(number) => {
            let value = number.value();
            let form = if value.is_nan() {
                json!({"float": "nan"})
            } else if value.is_infinite() {
                json!({"float": if value > 0.0 { "inf" } else { "-inf" }})
            } else {
                json!(value)
            };
            json!({"kind": "float", "value": form})
        }
        OutValue::Bytes(bytes) => json!({"kind": "bytes", "value": {"hex": hex_of(bytes.value())}}),
        other => json!({"unexpected": format!("{:?}", other.kind())}),
    }
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
    let top = host.take(argument)?;
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

/// A case of serialize that arms fault injection points (RQ-014): it arms them for the member as a generated binding
/// test does (G-5), serializes the value under the arming, and fails a fault that did not fire. Only the kind
/// `internal`, of the category `internal`, comes from a point of the crate.
fn faulted_serialize(entry: &Value) -> Result<(), Failed> {
    let value = value_of(entry.get("value").ok_or("the entry has no value")?)?;
    let faults = entry.get("faults").ok_or("the entry has no faults")?;
    let raises = entry
        .get("raises")
        .ok_or("a case with faults names no raises")?;
    if raises.get("status") != Some(&Value::Null)
        || raises.get("category").and_then(Value::as_str) != Some("internal")
    {
        return Err("raises of a fault names a status or a category other than internal".into());
    }
    let id = binding_core::fault::arm("serialize", &faults.to_string())
        .map_err(|error| Failed::from(error.to_string()))?;
    let outcome = binding_core::fault::take("serialize").run(|| serialize(&value));
    let left = binding_core::fault::left(id).map_err(|error| Failed::from(error.to_string()))?;
    if !left.is_empty() {
        return Err(format!("the faults of {} did not fire", left.join(", ")).into());
    }
    match outcome {
        Ok(_) => Err("wrote the value under the fault".into()),
        Err(error) => check_error(&error, field(raises, "kind")?),
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
        "serialize" if entry.get("faults").is_some() => faulted_serialize(entry),
        "serialize" => {
            let top = host.take(given("value")?)?;
            match from_host(&mut host, top) {
                Ok(value) => {
                    check_failure(Ok(()), entry)?;
                    serialized(
                        entry,
                        &serialize(&value).map_err(|error| error.to_string())?,
                    )?;
                    // RQ-013, U-1: a value that the format takes goes back to the language unchanged.
                    same_out(&value, given("value")?, "the value that from_host took")
                }
                Err(failure) => check_failure(Err(failure), entry),
            }
        }
        // The cases of the value php_value itself: from_host refuses the value with the kind (RQ-012).
        "php_value" => {
            if entry.get("raises").is_none() {
                return Err("a case of the value names no raises".into());
            }
            let top = host.take(given("value")?)?;
            check_failure(from_host(&mut host, top).map(drop), entry)
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
            let value = host.take(given("value")?)?;
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
            given_value(entry, &value, field(entry, "bytes")?)
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
            let top = host.take(entry.get("value").ok_or("the entry has no value")?)?;
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
    let mut trials = vec![Trial::test("interface::links_every_group", linked)];
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
