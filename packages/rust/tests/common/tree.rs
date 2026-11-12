//! The typed tree of a value, which the contract and the fuzz compare with the tree that PHP writes (scripts/php-tree.mts):
//! references and objects are numbered by first appearance, bytes are base64 and a float is the hexadecimal of its bits.
//! The tree of a value is as deep as the value, and the trees of the contract and of the fuzz are shallow.

use std::collections::HashMap;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use polyspec_php_serialize::{Error, Key, Node, ObjectId, PhpValue, ReferenceId};
use serde_json::{json, Value};

#[derive(Default)]
struct State {
    objects: HashMap<ObjectId, usize>,
    references: HashMap<ReferenceId, usize>,
}

pub fn base64(bytes: &[u8]) -> String {
    STANDARD.encode(bytes)
}

pub fn bytes_of(text: &str) -> Result<Vec<u8>, String> {
    STANDARD
        .decode(text)
        .map_err(|error| format!("base64: {error}"))
}

/// Returns the typed tree of a value.
pub fn tree(value: &PhpValue) -> Result<Value, Error> {
    node(value, value.root(), &mut State::default())
}

fn float(number: f64) -> Value {
    if number.is_nan() {
        json!(["float", "nan"])
    } else {
        json!(["float", format!("{:016x}", number.to_bits())])
    }
}

fn node(value: &PhpValue, item: &Node, state: &mut State) -> Result<Value, Error> {
    Ok(match item {
        Node::Reference(id) => {
            if let Some(known) = state.references.get(id) {
                return Ok(json!(["ref", known]));
            }
            let ordinal = state.references.len();
            state.references.insert(*id, ordinal);
            json!(["ref", ordinal, node(value, value.reference(*id)?, state)?])
        }
        Node::Null => json!(["null"]),
        Node::Bool(flag) => json!(["bool", flag]),
        Node::Int(number) => json!(["int", number.to_string()]),
        Node::Float(number) => float(*number),
        Node::String(bytes) => json!(["string", base64(bytes)]),
        Node::Object(id) => {
            if let Some(known) = state.objects.get(id) {
                return Ok(json!(["object", known]));
            }
            let ordinal = state.objects.len();
            state.objects.insert(*id, ordinal);
            let mut pairs = Vec::new();
            for (name, property) in value.object(*id)?.iter() {
                pairs.push(json!([base64(name), node(value, property, state)?]));
            }
            json!(["object", ordinal, "stdClass", pairs])
        }
        Node::Array(id) => {
            let mut pairs = Vec::new();
            for (key, element) in value.array(*id)?.iter() {
                let key = match key {
                    Key::Int(number) => json!(["int", number.to_string()]),
                    Key::String(bytes) => json!(["string", base64(bytes)]),
                };
                pairs.push(json!([key, node(value, element, state)?]));
            }
            json!(["array", pairs])
        }
    })
}
