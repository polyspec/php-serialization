//! to_host: a value of PHP for a language (RQ-013). The value is described one level at a time as an [`OutValue`] of
//! binding_core, and the binding asks for the children of a handle through [`OutValues`], which borrow the value; every
//! rule of what a value of PHP is in a language is here and in from_host, once (P-1). A handle names a part that the
//! value holds; [`OutValues`] has no failure, so a question about a part that the value does not hold, which no binding
//! asks, has the answer null.

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

fn handle(kind: u64, index: usize) -> Handle {
    // An index of a part fits in the 62 bits above the kind: a value holds fewer parts than the memory of a process.
    match u64::try_from(index) {
        Ok(index) => Handle::new((index << 2) | kind),
        Err(_) => Handle::new(u64::MAX),
    }
}

#[allow(
    clippy::manual_unwrap_or,
    reason = "RQ-013: a length of a part fits in u64 on every target of the crate; OutValues has no failure"
)]
fn length(len: usize) -> u64 {
    match u64::try_from(len) {
        Ok(len) => len,
        Err(_) => u64::MAX,
    }
}

/// The part that a handle names: its kind and its index.
fn part(handle: Handle) -> Option<(u64, usize)> {
    let raw = handle.raw();
    match usize::try_from(raw >> 2) {
        Ok(index) => Some((raw & 3, index)),
        Err(_) => None,
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
            Node::Object(id) => OutValue::Object {
                handle: handle(OBJECT, id.0),
                len: match self.value.object(*id) {
                    Ok(object) => length(object.len()),
                    Err(_) => 0,
                },
            },
            Node::Reference(id) => self.reference(*id),
        }
    }

    fn array(&self, id: ArrayId) -> OutValue {
        let Ok(array) = self.value.array(id) else {
            return OutValue::Null;
        };
        // RQ-013: the map says whether its keys are 0 to n-1 in order, so a language with lists makes a list of it.
        let sequence =
            array
                .iter()
                .enumerate()
                .all(|(at, (key, _))| match (key, i64::try_from(at)) {
                    (Key::Int(number), Ok(at)) => *number == at,
                    _ => false,
                });
        OutValue::Map(MapOut::new(
            handle(ARRAY, id.0),
            length(array.len()),
            sequence,
        ))
    }

    fn reference(&self, id: ReferenceId) -> OutValue {
        // RQ-008: a reference holds no reference, so the value it holds is described at once.
        let held = match self.value.reference(id) {
            Ok(Node::Reference(_)) | Err(_) => OutValue::Null,
            Ok(node) => self.describe(node),
        };
        OutValue::Reference {
            handle: handle(REFERENCE, id.0),
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
    /// A value of PHP has no list: an array is a map (RQ-013), so no binding asks for an item.
    fn item(&mut self, _list: Handle, _index: u64) -> OutValue {
        OutValue::Null
    }

    /// The key and the value of an entry of an array, or the name and the value of a property of an object. A binding
    /// asks only for an index below the length that the handle came with; another question has the answer null.
    fn entry(&mut self, map: Handle, index: u64) -> (OutValue, OutValue) {
        let (Some((kind, id)), Ok(index)) = (part(map), usize::try_from(index)) else {
            return (OutValue::Null, OutValue::Null);
        };
        match kind {
            ARRAY => match self
                .value
                .array(ArrayId(id))
                .map(|array| array.iter().nth(index))
            {
                Ok(Some((key, node))) => (Self::key(key), self.describe(node)),
                _ => (OutValue::Null, OutValue::Null),
            },
            OBJECT => match self
                .value
                .object(ObjectId(id))
                .map(|object| object.iter().nth(index))
            {
                Ok(Some((name, node))) => (
                    OutValue::Bytes(BytesOut::new(name.to_vec())),
                    self.describe(node),
                ),
                _ => (OutValue::Null, OutValue::Null),
            },
            _ => (OutValue::Null, OutValue::Null),
        }
    }
}
