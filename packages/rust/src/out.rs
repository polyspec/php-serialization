//! to_host: a value of PHP for a language (RQ-013). The value is described one level at a time as an [`OutValue`] of
//! binding_core, and the binding asks for the children of a handle through [`OutValues`], which borrow the value; every
//! rule of what a value of PHP is in a language is here and in from_host, once (P-1).
//!
//! A handle names a part that the value holds, and a binding asks only for an index below the length that the handle
//! came with. Any other question is a defect of the binding or of this crate, and [`OutValues`] has no failure to give
//! back, so it panics with RQ-013 and the handle that it was given instead of answering with a value (P-4); a binding
//! turns the panic into the kind `internal` (B-7). An identity of a part that the value made always names that part, and
//! a count of a value's parts fits in `u64`, so a failure of either is a defect too.

use binding_core::{BytesOut, FloatOut, Handle, IntOut, MapOut, OutValue, OutValues};

use crate::value::{ArrayId, Key, Node, ObjectId, PhpValue, ReferenceId};

/// The handles of a value: the kind of the part in the low two bits, its index above them.
const ARRAY: u64 = 0;
const OBJECT: u64 = 1;
const REFERENCE: u64 = 2;

/// The top value of a value of PHP as a language takes it, and the children of its handles (RQ-013).
#[must_use]
pub fn to_host(value: &PhpValue) -> (OutValue, Children<'_>) {
    let children = Children { value };
    (children.describe(value.root()), children)
}

/// The children of the handles of one value of PHP, which a binding asks for (RQ-013).
pub struct Children<'a> {
    value: &'a PhpValue,
}

#[allow(
    clippy::expect_used,
    reason = "RQ-013: a count of the parts of a value fits in u64; a failure is a defect, which B-7 makes internal"
)]
fn count(len: usize) -> u64 {
    u64::try_from(len).expect("RQ-013: a count of the parts of a value fits in u64")
}

#[allow(
    clippy::expect_used,
    reason = "RQ-013: an index of a part fits in the 62 bits of a handle; a failure is a defect, which B-7 makes internal"
)]
fn handle(kind: u64, index: usize) -> Handle {
    let index = count(index)
        .checked_mul(4)
        .expect("RQ-013: an index of a part fits in the 62 bits above the kind of a handle");
    Handle::new(index | kind)
}

/// A question about a part that the value does not hold (see the module): a defect, never an answer.
#[allow(
    clippy::panic,
    reason = "RQ-013, P-4: OutValues has no failure, and a defect is no value; B-7 makes the panic the kind internal"
)]
fn defect(what: &str, handle: Handle, index: Option<u64>) -> ! {
    match index {
        Some(index) => panic!("RQ-013: {what}: handle {}, index {index}", handle.raw()),
        None => panic!("RQ-013: {what}: handle {}", handle.raw()),
    }
}

impl Children<'_> {
    /// One level of a position.
    fn describe(&self, node: &Node) -> OutValue {
        match node {
            Node::Null => OutValue::Null,
            Node::Bool(flag) => OutValue::Bool(*flag),
            Node::Int(number) => OutValue::Int(IntOut::new(*number)),
            Node::Float(number) => OutValue::Float(FloatOut::new(*number)),
            Node::String(bytes) => OutValue::Bytes(BytesOut::new(bytes.clone())),
            Node::Array(id) => self.array(*id),
            Node::Object(id) => {
                let at = handle(OBJECT, id.0);
                match self.value.object(*id) {
                    Ok(object) => OutValue::Object {
                        handle: at,
                        len: count(object.len()),
                    },
                    Err(_) => defect("the value holds no such object", at, None),
                }
            }
            Node::Reference(id) => self.reference(*id),
        }
    }

    fn array(&self, id: ArrayId) -> OutValue {
        let at = handle(ARRAY, id.0);
        let Ok(array) = self.value.array(id) else {
            defect("the value holds no such array", at, None)
        };
        // RQ-013: the map says whether its keys are 0 to n-1 in order, so a language with lists makes a list of it.
        let sequence = array
            .iter()
            .enumerate()
            .all(|(position, (key, _))| match key {
                Key::Int(number) => u64::try_from(*number) == Ok(count(position)),
                Key::String(_) => false,
            });
        OutValue::Map(MapOut::new(at, count(array.len()), sequence))
    }

    fn reference(&self, id: ReferenceId) -> OutValue {
        let at = handle(REFERENCE, id.0);
        // RQ-008: a reference holds no reference, so the value it holds is described at once.
        let held = match self.value.reference(id) {
            Ok(Node::Reference(_)) => defect("a reference holds a reference", at, None),
            Ok(node) => self.describe(node),
            Err(_) => defect("the value holds no such reference", at, None),
        };
        OutValue::Reference {
            handle: at,
            value: Box::new(held),
        }
    }

    fn key(key: &Key) -> OutValue {
        match key {
            Key::Int(number) => OutValue::Int(IntOut::new(*number)),
            Key::String(bytes) => OutValue::Bytes(BytesOut::new(bytes.clone())),
        }
    }
}

impl OutValues for Children<'_> {
    /// A value of PHP has no list: an array is a map (RQ-013), so a question about an item is a defect.
    fn item(&mut self, list: Handle, index: u64) -> OutValue {
        defect("a value of PHP has no list", list, Some(index))
    }

    /// The key and the value of an entry of an array, or the name and the value of a property of an object.
    fn entry(&mut self, map: Handle, index: u64) -> (OutValue, OutValue) {
        let raw = map.raw();
        let (Ok(id), Ok(position)) = (usize::try_from(raw >> 2), usize::try_from(index)) else {
            defect(
                "no part of the value has this handle and index",
                map,
                Some(index),
            )
        };
        let found = match raw & 3 {
            ARRAY => match self.value.array(ArrayId(id)) {
                Ok(array) => array
                    .iter()
                    .nth(position)
                    .map(|(key, node)| (Self::key(key), self.describe(node))),
                Err(_) => None,
            },
            OBJECT => match self.value.object(ObjectId(id)) {
                Ok(object) => object.iter().nth(position).map(|(name, node)| {
                    (
                        OutValue::Bytes(BytesOut::new(name.to_vec())),
                        self.describe(node),
                    )
                }),
                Err(_) => None,
            },
            _ => None,
        };
        match found {
            Some(entry) => entry,
            None => defect(
                "no entry of the value has this handle and index",
                map,
                Some(index),
            ),
        }
    }
}
