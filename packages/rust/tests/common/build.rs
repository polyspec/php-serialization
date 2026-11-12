//! The value of a typed tree of the contract, built through the public building of a value (RQ-008).

use std::collections::HashMap;

use polyspec_php_serialization::{Error, Key, Node, ObjectId, PhpValue, ReferenceId};
use serde_json::Value;

use super::tree::bytes_of;

/// Builds the value of a typed tree through the public building of a value, which may refuse it (RQ-008, RQ-009). The
/// outer error is a malformed tree.
pub fn build(tree: &Value) -> Result<Result<PhpValue, Error>, String> {
    let mut value = PhpValue::new();
    let mut objects = HashMap::new();
    let mut references = HashMap::new();
    let root = match build_node(&mut value, tree, &mut objects, &mut references)? {
        Ok(root) => root,
        Err(error) => return Ok(Err(error)),
    };
    Ok(value.set_root(root).map(|()| value))
}

fn text(item: &Value) -> Result<&str, String> {
    item.as_str()
        .ok_or_else(|| format!("expected a text: {item}"))
}

fn list(item: &Value) -> Result<&Vec<Value>, String> {
    item.as_array()
        .ok_or_else(|| format!("expected a list: {item}"))
}

fn at(items: &[Value], index: usize) -> Result<&Value, String> {
    items
        .get(index)
        .ok_or_else(|| format!("expected an item {index}"))
}

fn build_node(
    value: &mut PhpValue,
    tree: &Value,
    objects: &mut HashMap<u64, ObjectId>,
    references: &mut HashMap<u64, ReferenceId>,
) -> Result<Result<Node, Error>, String> {
    let items = list(tree)?;
    let kind = text(at(items, 0)?)?;
    macro_rules! built {
        ($result:expr) => {
            match $result {
                Ok(item) => item,
                Err(error) => return Ok(Err(error)),
            }
        };
    }
    let ordinal = || {
        at(items, 1).and_then(|item| {
            item.as_u64()
                .ok_or_else(|| "expected an ordinal".to_owned())
        })
    };
    Ok(Ok(match kind {
        "null" => Node::Null,
        "bool" => Node::Bool(at(items, 1)?.as_bool().ok_or("expected a boolean")?),
        "int" => Node::Int(
            text(at(items, 1)?)?
                .parse()
                .map_err(|error| format!("int: {error}"))?,
        ),
        "float" => match text(at(items, 1)?)? {
            "nan" => Node::Float(f64::NAN),
            hex => Node::Float(f64::from_bits(
                u64::from_str_radix(hex, 16).map_err(|error| format!("float: {error}"))?,
            )),
        },
        "string" => Node::String(bytes_of(text(at(items, 1)?)?)?),
        "array" => {
            let array = value.new_array();
            for pair in list(at(items, 1)?)? {
                let pair = list(pair)?;
                let key = list(at(pair, 0)?)?;
                let key = match text(at(key, 0)?)? {
                    "int" => Key::Int(
                        text(at(key, 1)?)?
                            .parse()
                            .map_err(|error| format!("key: {error}"))?,
                    ),
                    _ => Key::String(bytes_of(text(at(key, 1)?)?)?),
                };
                let element = built!(build_node(value, at(pair, 1)?, objects, references)?);
                built!(value.set_element(array, key, element));
            }
            Node::Array(array)
        }
        "object" => {
            let number = ordinal()?;
            if let Some(known) = objects.get(&number) {
                return Ok(Ok(Node::Object(*known)));
            }
            let object = value.new_object();
            objects.insert(number, object);
            for pair in list(at(items, 3)?)? {
                let pair = list(pair)?;
                let name = bytes_of(text(at(pair, 0)?)?)?;
                let property = built!(build_node(value, at(pair, 1)?, objects, references)?);
                built!(value.set_property(object, name, property));
            }
            Node::Object(object)
        }
        "ref" => {
            let number = ordinal()?;
            if let Some(known) = references.get(&number) {
                return Ok(Ok(Node::Reference(*known)));
            }
            let reference = built!(value.new_reference(Node::Null));
            references.insert(number, reference);
            let inner = built!(build_node(value, at(items, 2)?, objects, references)?);
            built!(value.set_reference(reference, inner));
            Node::Reference(reference)
        }
        other => return Err(format!("unknown kind {other}")),
    }))
}
