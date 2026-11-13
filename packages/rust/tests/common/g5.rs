//! A value of php_value in the case convention of binding G-5, `{"kind", "value"}`, as a language describes it to
//! from_host: a handle is the index of a JSON node that the host keeps (RQ-012).

use binding_core::{Handle, HostValue, HostValues, Key, KeyedMap, Raised};
use serde_json::Value;

/// The handles of references start here, apart from the handles of the nodes.
const REFERENCES: u64 = 1 << 40;

/// The bytes of `{"hex": ...}`.
pub fn hex(value: &Value) -> Result<Vec<u8>, String> {
    let text = value
        .get("hex")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{value} is no {{\"hex\"}}"))?;
    (0..text.len())
        .step_by(2)
        .map(|at| {
            text.get(at..at + 2)
                .ok_or_else(|| String::from("an odd number of hex digits"))
                .and_then(|pair| u8::from_str_radix(pair, 16).map_err(|error| error.to_string()))
        })
        .collect()
}

/// A float of G-5: a number, or `{"float": "nan" | "inf" | "-inf"}`.
fn float(value: &Value) -> Result<f64, String> {
    if let Some(number) = value.as_f64() {
        return Ok(number);
    }
    match value.get("float").and_then(Value::as_str) {
        Some("nan") => Ok(f64::NAN),
        Some("inf") => Ok(f64::INFINITY),
        Some("-inf") => Ok(f64::NEG_INFINITY),
        _ => Err(format!("{value} is no float")),
    }
}

/// The largest safe integer of JavaScript, 2^53 - 1: an integer of a case outside it is a decimal text (G-5).
pub const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

/// An integer of a value of G-5: a JSON number within the safe integers, or the decimal text of an integer outside them,
/// which a language with integers of any size describes as a number of 64 bits or as one outside 64 bits.
fn integer(value: &Value) -> Result<HostValue, String> {
    if let Some(number) = value.as_i64() {
        if number.unsigned_abs() > MAX_SAFE_INTEGER.unsigned_abs() {
            return Err(format!(
                "the integer {number} is outside the safe integers and no text"
            ));
        }
        return Ok(HostValue::Int(number));
    }
    let text = value
        .as_str()
        .ok_or_else(|| format!("{value} is no integer"))?;
    let digits = match text.strip_prefix('-') {
        Some(rest) => rest,
        None => text,
    };
    if digits.is_empty()
        || !digits.bytes().all(|byte| byte.is_ascii_digit())
        || (digits.len() > 1 && digits.starts_with('0'))
        || text == "-0"
    {
        return Err(format!("{text} is no decimal text of an integer"));
    }
    match text.parse::<i64>() {
        Ok(number) if number.unsigned_abs() <= MAX_SAFE_INTEGER.unsigned_abs() => Err(format!(
            "the integer {number} is within the safe integers and no number"
        )),
        Ok(number) => Ok(HostValue::Int(number)),
        Err(_) => Ok(HostValue::Number(text.to_owned())),
    }
}

/// The key of a pair of a map or an object: a text, `{"int": n}` or `{"hex": ...}`.
pub fn key(value: &Value) -> Result<Key, String> {
    if let Some(text) = value.as_str() {
        return Ok(Key::Text(text.to_owned()));
    }
    if let Some(number) = value.get("int") {
        return number
            .as_i64()
            .map(Key::Int)
            .ok_or_else(|| format!("{number} is no integer key"));
    }
    hex(value).map(Key::Bytes)
}

fn key_value(key: Key) -> HostValue {
    match key {
        Key::Int(number) => HostValue::Int(number),
        Key::Bytes(bytes) => HostValue::Bytes(bytes),
        Key::Text(text) => {
            HostValue::Text(binding_core::HostText::Utf16(text.encode_utf16().collect()))
        }
    }
}

fn length(len: usize) -> u64 {
    match u64::try_from(len) {
        Ok(len) => len,
        Err(_) => unreachable!("a case holds fewer pairs than u64 counts"),
    }
}

fn index(handle: Handle) -> usize {
    match usize::try_from(handle.raw()) {
        Ok(at) => at,
        Err(_) => unreachable!("a node handle is an index of the nodes"),
    }
}

/// The nodes of the values that a case gives.
#[derive(Default)]
pub struct Host {
    nodes: Vec<Value>,
}

impl Host {
    /// Describes one level of a value of G-5.
    pub fn describe(&mut self, value: &Value) -> Result<HostValue, String> {
        let content = || {
            value
                .get("value")
                .ok_or_else(|| format!("{value} has no value"))
        };
        Ok(match value.get("kind").and_then(Value::as_str) {
            Some("null") => HostValue::Null,
            Some("bool") => HostValue::Bool(content()?.as_bool().ok_or("a bool is no boolean")?),
            Some("int") => integer(content()?)?,
            Some("float") => HostValue::Float(float(content()?)?),
            Some("bytes") => HostValue::Bytes(hex(content()?)?),
            Some(kind @ ("map" | "object")) => {
                let pairs = content()?.as_array().ok_or("the pairs are no array")?;
                let len = length(pairs.len());
                self.nodes.push(content()?.clone());
                let handle = Handle::new(length(self.nodes.len() - 1));
                if kind == "map" {
                    HostValue::Map { handle, len }
                } else {
                    HostValue::StdClass { handle, len }
                }
            }
            Some("reference") => {
                let reference = content()?;
                let id = reference
                    .get("id")
                    .and_then(Value::as_u64)
                    .ok_or("a reference has no id")?;
                let target = reference.get("value").ok_or("a reference has no value")?;
                HostValue::PhpReference {
                    identity: Handle::new(REFERENCES + id),
                    target: Box::new(self.describe(target)?),
                }
            }
            _ => return Err(format!("{value} has no kind of php_value")),
        })
    }

    /// The properties of a std_class as the binding gives them: a keyed map of the pairs.
    pub fn properties(&mut self, pairs: &Value) -> Result<KeyedMap<HostValue>, String> {
        let mut map = KeyedMap::new();
        for pair in pairs.as_array().ok_or("the properties are no array")? {
            let name = key(pair.get(0).ok_or("a pair has no key")?)?;
            let value = self.describe(pair.get(1).ok_or("a pair has no value")?)?;
            map.insert(name, value);
        }
        Ok(map)
    }

    fn pair(&mut self, map: Handle, at: u64) -> Result<(HostValue, HostValue), String> {
        let at = usize::try_from(at).map_err(|error| error.to_string())?;
        let pair = self
            .nodes
            .get(index(map))
            .and_then(|pairs| pairs.get(at))
            .cloned()
            .ok_or("no such pair")?;
        let name = key_value(key(pair.get(0).ok_or("a pair has no key")?)?);
        Ok((
            name,
            self.describe(pair.get(1).ok_or("a pair has no value")?)?,
        ))
    }
}

impl HostValues for Host {
    fn item(&mut self, list: Handle, _index: u64) -> Result<HostValue, Raised> {
        Err(Raised::from_generated(list))
    }

    fn entry(&mut self, map: Handle, at: u64) -> Result<(HostValue, HostValue), Raised> {
        // A case that names no such pair is a defect of the case, which the language would raise as its exception.
        match self.pair(map, at) {
            Ok(pair) => Ok(pair),
            Err(_defect) => Err(Raised::from_generated(map)),
        }
    }

    fn read(&mut self, value: Handle) -> Result<HostValue, Raised> {
        Err(Raised::from_generated(value))
    }
}
