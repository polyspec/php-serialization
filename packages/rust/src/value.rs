//! The value of the format, a value of PHP (RQ-008).
//!
//! A [`PhpValue`] holds its top value and three tables: the arrays, the objects of `stdClass` and the references. A position
//! names an array, an object or a reference by its identity ([`ArrayId`], [`ObjectId`], [`ReferenceId`]). An object and a
//! reference may be named at many positions, which share them; an array is a value, so one position names it. No part of the
//! value is nested in a Rust value, so neither a deep value nor a value that holds itself through an object or a reference
//! makes a Rust function recurse (RQ-006): dropping a value drops three flat tables.

use std::collections::HashMap;

use crate::error::Error;

/// The identity of an array of a [`PhpValue`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ArrayId(pub(crate) usize);

/// The identity of an object of `stdClass` of a [`PhpValue`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ObjectId(pub(crate) usize);

/// The identity of a reference of a [`PhpValue`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ReferenceId(pub(crate) usize);

/// What a position holds (RQ-008).
#[derive(Debug, Clone, PartialEq)]
pub enum Node {
    Null,
    Bool(bool),
    Int(i64),
    /// A float of 64 bits; `-0`, the infinities and NAN stay what they are (RQ-002).
    Float(f64),
    /// A string of bytes (RQ-003).
    String(Vec<u8>),
    Array(ArrayId),
    Object(ObjectId),
    Reference(ReferenceId),
}

/// The key of an array (RQ-004).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Key {
    Int(i64),
    String(Vec<u8>),
}

impl Key {
    /// Returns the key that a PHP array stores for a string key: a string in the canonical form of a 64-bit integer
    /// (`0`, or an optional `-` and digits without a leading zero) is that integer (RQ-004).
    #[must_use]
    pub fn of_string(bytes: Vec<u8>) -> Self {
        match canonical_integer(&bytes) {
            Some(number) => Self::Int(number),
            None => Self::String(bytes),
        }
    }
}

/// Returns the integer of a string in the canonical form of a 64-bit integer, or None for any other string (RQ-004).
fn canonical_integer(bytes: &[u8]) -> Option<i64> {
    let (negative, digits) = match bytes.split_first() {
        Some((b'-', rest)) => (true, rest),
        Some(_) => (false, bytes),
        None => return None,
    };
    // 19 digits hold every 64-bit integer; "0" alone has a leading zero, and "-0" is no integer of PHP.
    let canonical = match digits.split_first() {
        Some((b'0', rest)) => rest.is_empty() && !negative,
        Some((first, _)) => first.is_ascii_digit(),
        None => false,
    };
    if !canonical || digits.len() > 19 || !digits.iter().all(u8::is_ascii_digit) {
        return None;
    }
    let mut magnitude: u64 = 0;
    for digit in digits {
        magnitude = magnitude * 10 + u64::from(digit - b'0');
    }
    integer_of(negative, magnitude)
}

/// Returns the 64-bit integer of a sign and a magnitude, or None outside 64 bits.
pub(crate) fn integer_of(negative: bool, magnitude: u64) -> Option<i64> {
    if negative {
        0_i64.checked_sub_unsigned(magnitude)
    } else {
        0_i64.checked_add_unsigned(magnitude)
    }
}

/// An ordered map that keeps the first position of a key, as a PHP array does (RQ-004).
#[derive(Debug, Clone)]
pub(crate) struct Entries<K> {
    pub(crate) list: Vec<(K, Node)>,
    index: HashMap<K, usize>,
}

impl<K> Default for Entries<K> {
    fn default() -> Self {
        Self {
            list: Vec::new(),
            index: HashMap::new(),
        }
    }
}

impl<K: Eq + std::hash::Hash + Clone> Entries<K> {
    /// Sets the value of a key: a new key goes last, a key that the map holds keeps its position. Returns the value that the
    /// key held.
    pub(crate) fn set(&mut self, key: K, node: Node) -> Result<Option<Node>, Error> {
        if let Some(&position) = self.index.get(&key) {
            let Some(entry) = self.list.get_mut(position) else {
                return Err(Error::Internal {
                    what: "an index names no entry",
                });
            };
            return Ok(Some(std::mem::replace(&mut entry.1, node)));
        }
        self.index.insert(key.clone(), self.list.len());
        self.list.push((key, node));
        Ok(None)
    }

    pub(crate) fn get(&self, key: &K) -> Option<&Node> {
        let position = *self.index.get(key)?;
        self.list.get(position).map(|entry| &entry.1)
    }
}

/// An array of PHP: an ordered map from keys to values (RQ-008).
#[derive(Debug, Clone, Default)]
pub struct PhpArray {
    pub(crate) entries: Entries<Key>,
}

impl PhpArray {
    /// The entries in their order.
    pub fn iter(&self) -> impl ExactSizeIterator<Item = (&Key, &Node)> {
        self.entries.list.iter().map(|(key, node)| (key, node))
    }

    /// The value of a key.
    #[must_use]
    pub fn get(&self, key: &Key) -> Option<&Node> {
        self.entries.get(key)
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.entries.list.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.entries.list.is_empty()
    }
}

/// An object of `stdClass`: an ordered map from property names of bytes to values (RQ-008).
#[derive(Debug, Clone, Default)]
pub struct StdClass {
    pub(crate) properties: Entries<Vec<u8>>,
}

impl StdClass {
    /// The properties in their order, each with its name.
    pub fn iter(&self) -> impl ExactSizeIterator<Item = (&[u8], &Node)> {
        self.properties
            .list
            .iter()
            .map(|(name, node)| (name.as_slice(), node))
    }

    /// The value of a property.
    #[must_use]
    pub fn get(&self, name: &[u8]) -> Option<&Node> {
        self.properties.get(&name.to_vec())
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.properties.list.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.properties.list.is_empty()
    }
}

#[derive(Debug, Clone, Default)]
pub(crate) struct ArraySlot {
    pub(crate) array: PhpArray,
    /// Whether a position names the array (RQ-008: one position holds an array).
    pub(crate) held: bool,
}

/// A value of PHP (RQ-008): the top value and the arrays, objects and references that its positions name.
#[derive(Debug, Clone)]
pub struct PhpValue {
    pub(crate) root: Node,
    pub(crate) arrays: Vec<ArraySlot>,
    pub(crate) objects: Vec<StdClass>,
    pub(crate) references: Vec<Node>,
}

impl Default for PhpValue {
    fn default() -> Self {
        Self::new()
    }
}

impl PhpValue {
    /// A value whose top value is null.
    #[must_use]
    pub const fn new() -> Self {
        Self {
            root: Node::Null,
            arrays: Vec::new(),
            objects: Vec::new(),
            references: Vec::new(),
        }
    }

    /// The top value; it is never a reference (RQ-008).
    #[must_use]
    pub const fn root(&self) -> &Node {
        &self.root
    }

    /// Sets the top value. A reference is refused with `top_reference`, an array that a position holds with `array_held`.
    pub fn set_root(&mut self, node: Node) -> Result<(), Error> {
        if matches!(node, Node::Reference(_)) {
            return Err(Error::TopReference);
        }
        self.place(&node)?;
        let old = std::mem::replace(&mut self.root, node);
        self.release(&old);
        Ok(())
    }

    /// Adds an empty array that no position holds yet.
    pub fn new_array(&mut self) -> ArrayId {
        self.arrays.push(ArraySlot::default());
        ArrayId(self.arrays.len() - 1)
    }

    /// Adds an object of `stdClass` without properties.
    pub fn new_object(&mut self) -> ObjectId {
        self.objects.push(StdClass::default());
        ObjectId(self.objects.len() - 1)
    }

    /// Adds a reference that holds a value; a reference is refused with `nested_reference` (RQ-008).
    pub fn new_reference(&mut self, node: Node) -> Result<ReferenceId, Error> {
        if matches!(node, Node::Reference(_)) {
            return Err(Error::NestedReference);
        }
        self.place(&node)?;
        self.references.push(node);
        Ok(ReferenceId(self.references.len() - 1))
    }

    /// Sets an element of an array. A string key in the canonical form of an integer sets that integer, and a key that the
    /// array holds keeps its position (RQ-004, RQ-008).
    pub fn set_element(&mut self, array: ArrayId, key: Key, node: Node) -> Result<(), Error> {
        let key = match key {
            Key::String(bytes) => Key::of_string(bytes),
            Key::Int(number) => Key::Int(number),
        };
        if self.arrays.get(array.0).is_none() {
            return Err(Error::UnknownId);
        }
        self.place(&node)?;
        let Some(slot) = self.arrays.get_mut(array.0) else {
            return Err(Error::UnknownId);
        };
        let old = slot.array.entries.set(key, node)?;
        if let Some(old) = old {
            self.release(&old);
        }
        Ok(())
    }

    /// Sets a property of an object; a name that starts with U+0000 is refused with `property_name` (RQ-009).
    pub fn set_property(
        &mut self,
        object: ObjectId,
        name: Vec<u8>,
        node: Node,
    ) -> Result<(), Error> {
        if name.first() == Some(&0) {
            return Err(Error::PropertyName { offset: None });
        }
        if self.objects.get(object.0).is_none() {
            return Err(Error::UnknownId);
        }
        self.place(&node)?;
        let Some(target) = self.objects.get_mut(object.0) else {
            return Err(Error::UnknownId);
        };
        let old = target.properties.set(name, node)?;
        if let Some(old) = old {
            self.release(&old);
        }
        Ok(())
    }

    /// Sets the value that a reference holds; a reference is refused with `nested_reference` (RQ-008).
    pub fn set_reference(&mut self, reference: ReferenceId, node: Node) -> Result<(), Error> {
        if matches!(node, Node::Reference(_)) {
            return Err(Error::NestedReference);
        }
        if self.references.get(reference.0).is_none() {
            return Err(Error::UnknownId);
        }
        self.place(&node)?;
        let Some(target) = self.references.get_mut(reference.0) else {
            return Err(Error::UnknownId);
        };
        let old = std::mem::replace(target, node);
        self.release(&old);
        Ok(())
    }

    /// The array of an identity.
    pub fn array(&self, id: ArrayId) -> Result<&PhpArray, Error> {
        match self.arrays.get(id.0) {
            Some(slot) => Ok(&slot.array),
            None => Err(Error::UnknownId),
        }
    }

    /// The object of an identity.
    pub fn object(&self, id: ObjectId) -> Result<&StdClass, Error> {
        self.objects.get(id.0).ok_or(Error::UnknownId)
    }

    /// The value that a reference holds; it is never a reference (RQ-008).
    pub fn reference(&self, id: ReferenceId) -> Result<&Node, Error> {
        self.references.get(id.0).ok_or(Error::UnknownId)
    }

    /// Checks that a node may go into a position and marks an array as held (RQ-008).
    fn place(&mut self, node: &Node) -> Result<(), Error> {
        match node {
            Node::Array(id) => {
                let Some(slot) = self.arrays.get_mut(id.0) else {
                    return Err(Error::UnknownId);
                };
                if slot.held {
                    return Err(Error::ArrayHeld);
                }
                slot.held = true;
                Ok(())
            }
            Node::Object(id) if self.objects.get(id.0).is_none() => Err(Error::UnknownId),
            Node::Reference(id) if self.references.get(id.0).is_none() => Err(Error::UnknownId),
            _ => Ok(()),
        }
    }

    /// Marks an array that a position no longer holds as free, so that another position may hold it.
    fn release(&mut self, node: &Node) {
        if let Node::Array(id) = node {
            if let Some(slot) = self.arrays.get_mut(id.0) {
                slot.held = false;
            }
        }
    }
}
