//! from_host: a value of a language to a value of PHP (RQ-012). The binding describes the value one level at a time as
//! a [`HostValue`] and answers the questions of the core about the children of a handle through [`HostValues`]; every
//! rule of what a value of a language is in PHP is here, once (P-1). The walk keeps its own stack, so it never recurses
//! (RQ-006).

use std::collections::{HashMap, HashSet};

use bindgen_core::{Failure, Handle, HostText, HostValue, KeyedMap, Raised, ValueKind};

use crate::at_depth_limit;
use crate::error::Error;
use crate::value::{ArrayId, Key, Node, ObjectId, PhpValue, ReferenceId};

/// How a language tells an integer from a float (RQ-012).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Numbers {
    /// The language has an integer type and a float type apart (PHP, Python, Go): a float is a float.
    Typed,
    /// The language has one number type (JavaScript): a number that is a safe integer and not `-0` is an integer, and
    /// every other number is a float. The binding of such a language gives a float of PHP whose value is an integer as
    /// a `PhpFloat`, which is a float whatever its value (RQ-008).
    Untyped,
}

/// The side of the binding in the walk of a value (RQ-012): it answers for the handles that it put into the
/// [`HostValue`]s it gave. A question may run language code (a getter, an iterator), so its failure is the exception of
/// that code, which goes back to the caller unchanged.
pub trait HostValues {
    /// How the language tells an integer from a float.
    fn numbers(&self) -> Numbers;

    /// The item at `index` of a list (`HostValue::List`).
    ///
    /// # Errors
    ///
    /// The exception that the language raised.
    fn item(&mut self, list: Handle, index: u64) -> Result<HostValue, Raised>;

    /// The key and the value of the entry at `index` of a map, a PHP array or an object (`HostValue::Map`,
    /// `HostValue::PhpArray`, `HostValue::StdClass`), in the order of the language.
    ///
    /// # Errors
    ///
    /// The exception that the language raised.
    fn entry(&mut self, map: Handle, index: u64) -> Result<(HostValue, HostValue), Raised>;

    /// The content of an instance of a class of the value table (`HostValue::Value`), which its `read` member gives: the
    /// float of a `PhpFloat`, the map of the properties of a `StdClass`, the value of a `Reference`.
    ///
    /// # Errors
    ///
    /// The exception that the language raised.
    fn read(&mut self, value: Handle) -> Result<HostValue, Raised>;
}

/// The value of PHP of a value of a language (RQ-012).
///
/// # Errors
///
/// `unsupported_value`, `invalid_text`, `int_range`, `depth`, `property_name`, `top_reference` and `nested_reference`
/// for a value that is no value of PHP, and the exception that the language raised while it answered.
pub fn from_host(host: &mut dyn HostValues, value: HostValue) -> Result<PhpValue, Failure<Error>> {
    let mut walk = Walk::new(host);
    walk.place(value, Slot::Root)?;
    walk.drain()?;
    Ok(walk.value)
}

/// The judgement of the properties that the constructor of the language class `StdClass` takes (RQ-012): each name is a
/// string that does not start with U+0000 (RQ-009) and each value is a value of PHP. The language object keeps the
/// properties that it was given, a field of the object; none is the empty map.
///
/// # Errors
///
/// As [`from_host`], and `unsupported_value` for a name that is an integer.
pub fn check_std_class(
    host: &mut dyn HostValues,
    properties: Option<KeyedMap<HostValue>>,
) -> Result<(), Failure<Error>> {
    let Some(properties) = properties else {
        return Ok(());
    };
    let mut walk = Walk::new(host);
    let object = walk.value.new_object();
    walk.value
        .set_root(Node::Object(object))
        .map_err(Failure::Kind)?;
    for (key, value) in properties {
        let name = match key {
            bindgen_core::Key::Text(text) => text.into_bytes(),
            bindgen_core::Key::Bytes(bytes) => bytes,
            bindgen_core::Key::Int(_) => return Err(Failure::Kind(Error::UnsupportedValue)),
        };
        walk.place(value, Slot::Property(object, name))?;
        walk.drain()?;
    }
    Ok(())
}

/// The judgement of the value that the constructor of the language class `Reference` takes (RQ-012): a value of PHP
/// that is no reference, since a reference holds no reference (RQ-008). The language object keeps the value that it was
/// given, a field of the object; none is null.
///
/// # Errors
///
/// As [`from_host`], and `nested_reference` for a reference.
pub fn check_reference(
    host: &mut dyn HostValues,
    value: Option<HostValue>,
) -> Result<(), Failure<Error>> {
    let Some(value) = value else {
        return Ok(());
    };
    let mut walk = Walk::new(host);
    let reference = walk
        .value
        .new_reference(Node::Null)
        .map_err(Failure::Kind)?;
    walk.place(value, Slot::Reference(reference))?;
    walk.drain()
}

/// The position that a value of the walk goes into.
enum Slot {
    Root,
    Element(ArrayId, Key),
    Property(ObjectId, Vec<u8>),
    Reference(ReferenceId),
}

/// The entries of a container that the walk still asks for.
enum Source {
    /// A list of the language: its items are the elements 0 to n-1.
    List,
    /// A map, a PHP array or an object of the language: its entries are keys and values.
    Entries,
}

/// A container being filled.
#[derive(Clone, Copy)]
enum Target {
    Array(ArrayId),
    Object(ObjectId),
}

struct Frame {
    handle: Handle,
    source: Source,
    target: Target,
    len: u64,
    next: u64,
    /// The handle of an array of the language, which no array that it holds may be (an array that holds itself).
    array: Option<Handle>,
}

struct Walk<'h> {
    host: &'h mut dyn HostValues,
    value: PhpValue,
    stack: Vec<Frame>,
    /// The arrays of the language that are being filled: an array holds no array that holds it.
    open_arrays: HashSet<Handle>,
    /// U-7 (d): one object of the language is one object of PHP.
    objects: HashMap<Handle, ObjectId>,
    /// U-7 (d), U-7 (g): one reference of the language is one reference of PHP.
    references: HashMap<Handle, ReferenceId>,
}

impl<'h> Walk<'h> {
    fn new(host: &'h mut dyn HostValues) -> Self {
        Self {
            host,
            value: PhpValue::new(),
            stack: Vec::new(),
            open_arrays: HashSet::new(),
            objects: HashMap::new(),
            references: HashMap::new(),
        }
    }

    /// Asks for the entries of the open containers until none is left.
    fn drain(&mut self) -> Result<(), Failure<Error>> {
        while let Some(frame) = self.stack.last_mut() {
            if frame.next >= frame.len {
                if let Some(array) = frame.array {
                    self.open_arrays.remove(&array);
                }
                self.stack.pop();
                continue;
            }
            let index = frame.next;
            frame.next += 1;
            let handle = frame.handle;
            let target = frame.target;
            let (key, value) = match frame.source {
                Source::List => {
                    let Ok(position) = i64::try_from(index) else {
                        return Err(Failure::Kind(Error::Internal {
                            what: "a list index is outside 64 bits",
                        }));
                    };
                    (HostValue::Int(position), self.host.item(handle, index)?)
                }
                Source::Entries => self.host.entry(handle, index)?,
            };
            let slot = match target {
                Target::Array(array) => Slot::Element(array, self.key(key)?),
                Target::Object(object) => Slot::Property(object, self.name(key)?),
            };
            self.place(value, slot)?;
        }
        Ok(())
    }

    /// The key of an array of PHP of a key of the language (RQ-004, RQ-012): an integer, or a string, which a string in
    /// the canonical form of an integer makes that integer.
    fn key(&self, key: HostValue) -> Result<Key, Failure<Error>> {
        match key {
            HostValue::Int(number) => Ok(Key::Int(number)),
            HostValue::Number(_) => Err(Failure::Kind(Error::IntRange { offset: None })),
            HostValue::Float(number) => match (self.host.numbers(), integer_of_number(number)) {
                (Numbers::Untyped, Some(integer)) => Ok(Key::Int(integer)),
                (Numbers::Untyped | Numbers::Typed, _) => {
                    Err(Failure::Kind(Error::UnsupportedValue))
                }
            },
            HostValue::Text(text) => Ok(Key::of_string(bytes_of_text(text)?)),
            HostValue::Bytes(bytes) => Ok(Key::of_string(bytes)),
            _ => Err(Failure::Kind(Error::UnsupportedValue)),
        }
    }

    /// The name of a property of a key of the language: a string (RQ-004, RQ-012).
    fn name(&self, key: HostValue) -> Result<Vec<u8>, Failure<Error>> {
        match key {
            HostValue::Text(text) => bytes_of_text(text),
            HostValue::Bytes(bytes) => Ok(bytes),
            _ => Err(Failure::Kind(Error::UnsupportedValue)),
        }
    }

    /// Puts one level of a value into its position, and opens a container for [`Walk::drain`].
    fn place(&mut self, value: HostValue, slot: Slot) -> Result<(), Failure<Error>> {
        let node = match value {
            HostValue::Null => Node::Null,
            HostValue::Bool(flag) => Node::Bool(flag),
            HostValue::Int(number) => Node::Int(number),
            HostValue::Number(_) => return Err(Failure::Kind(Error::IntRange { offset: None })),
            HostValue::Float(number) => match (self.host.numbers(), integer_of_number(number)) {
                (Numbers::Untyped, Some(integer)) => Node::Int(integer),
                (Numbers::Untyped | Numbers::Typed, _) => Node::Float(number),
            },
            HostValue::Text(text) => Node::String(bytes_of_text(text)?),
            HostValue::Bytes(bytes) => Node::String(bytes),
            HostValue::List { handle, len } => self.open_array(handle, len, Source::List)?,
            HostValue::PhpArray { handle, len, .. } | HostValue::Map { handle, len } => {
                self.open_array(handle, len, Source::Entries)?
            }
            HostValue::StdClass { handle, len } => self.object(handle, handle, len)?,
            HostValue::PhpReference { identity, target } => {
                self.reference(identity, Some(*target))?
            }
            HostValue::Value { kind, handle } => match kind {
                ValueKind::Float => match self.host.read(handle)? {
                    HostValue::Float(number) => Node::Float(number),
                    _ => return Err(Failure::Kind(Error::UnsupportedValue)),
                },
                ValueKind::Object => {
                    if let Some(object) = self.objects.get(&handle) {
                        Node::Object(*object)
                    } else {
                        match self.host.read(handle)? {
                            HostValue::Map {
                                handle: properties,
                                len,
                            } => self.object(handle, properties, len)?,
                            _ => return Err(Failure::Kind(Error::UnsupportedValue)),
                        }
                    }
                }
                ValueKind::Reference => self.reference(handle, None)?,
                _ => return Err(Failure::Kind(Error::UnsupportedValue)),
            },
            HostValue::Undefined
            | HostValue::PlainObject { .. }
            | HostValue::Date(_)
            | HostValue::Callable(_)
            | HostValue::Object { .. }
            | HostValue::Other { .. } => return Err(Failure::Kind(Error::UnsupportedValue)),
        };
        self.put(slot, node)
    }

    fn put(&mut self, slot: Slot, node: Node) -> Result<(), Failure<Error>> {
        match slot {
            Slot::Root => self.value.set_root(node),
            Slot::Element(array, key) => self.value.set_element(array, key, node),
            Slot::Property(object, name) => self.value.set_property(object, name, node),
            Slot::Reference(reference) => self.value.set_reference(reference, node),
        }
        .map_err(Failure::Kind)
    }

    /// Opens a new array of PHP for an array of the language: an array is a value, so every position of one array of the
    /// language is a copy, but an array that holds itself is no value of PHP (RQ-008, RQ-012).
    fn open_array(
        &mut self,
        handle: Handle,
        len: u64,
        source: Source,
    ) -> Result<Node, Failure<Error>> {
        if !self.open_arrays.insert(handle) {
            return Err(Failure::Kind(Error::UnsupportedValue));
        }
        let array = self.value.new_array();
        self.open(Frame {
            handle,
            source,
            target: Target::Array(array),
            len,
            next: 0,
            array: Some(handle),
        })?;
        Ok(Node::Array(array))
    }

    /// The object of PHP of an object of the language, `identity` being its handle: the same object every time (U-7 (d)),
    /// made before its properties, so that an object may hold itself.
    fn object(
        &mut self,
        identity: Handle,
        properties: Handle,
        len: u64,
    ) -> Result<Node, Failure<Error>> {
        if let Some(object) = self.objects.get(&identity) {
            return Ok(Node::Object(*object));
        }
        let object = self.value.new_object();
        self.objects.insert(identity, object);
        self.open(Frame {
            handle: properties,
            source: Source::Entries,
            target: Target::Object(object),
            len,
            next: 0,
            array: None,
        })?;
        Ok(Node::Object(object))
    }

    /// The reference of PHP of a reference of the language: the same reference for the same identity (U-7 (d), U-7 (g)),
    /// made before its value, which is the target of a PHP reference or what the `Reference` reads.
    fn reference(
        &mut self,
        identity: Handle,
        target: Option<HostValue>,
    ) -> Result<Node, Failure<Error>> {
        if let Some(reference) = self.references.get(&identity) {
            return Ok(Node::Reference(*reference));
        }
        let target = match target {
            Some(target) => target,
            None => self.host.read(identity)?,
        };
        if matches!(
            target,
            HostValue::PhpReference { .. }
                | HostValue::Value {
                    kind: ValueKind::Reference,
                    ..
                }
        ) {
            return Err(Failure::Kind(Error::NestedReference));
        }
        let reference = self
            .value
            .new_reference(Node::Null)
            .map_err(Failure::Kind)?;
        self.references.insert(identity, reference);
        self.place(target, Slot::Reference(reference))?;
        Ok(Node::Reference(reference))
    }

    /// Opens a container; one that holds entries, and every object, counts toward the depth limit (RQ-006).
    fn open(&mut self, frame: Frame) -> Result<(), Failure<Error>> {
        let is_object = matches!(frame.target, Target::Object(_));
        if (frame.len > 0 || is_object) && at_depth_limit(self.stack.len()) {
            return Err(Failure::Kind(Error::Depth { offset: None }));
        }
        self.stack.push(frame);
        Ok(())
    }
}

/// The integer of a number of a language with one number type: a safe integer that is not `-0` (RQ-012).
fn integer_of_number(number: f64) -> Option<i64> {
    const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;
    if number.fract() != 0.0
        || number.abs() > MAX_SAFE_INTEGER
        || (number == 0.0 && number.is_sign_negative())
    {
        return None;
    }
    #[allow(
        clippy::cast_possible_truncation,
        reason = "RQ-012: the number is integral and within 2^53 - 1, so i64 holds it exactly"
    )]
    Some(number as i64)
}

/// The bytes of a text of a language: its UTF-8 (RQ-003); a text with an unpaired surrogate is refused, never replaced.
fn bytes_of_text(text: HostText) -> Result<Vec<u8>, Failure<Error>> {
    match text {
        HostText::Bytes(bytes) => Ok(bytes),
        HostText::Utf16(units) => match String::from_utf16(&units) {
            Ok(text) => Ok(text.into_bytes()),
            Err(_) => Err(Failure::Kind(Error::InvalidText)),
        },
        HostText::CodePoints(points) => {
            let mut text = String::with_capacity(points.len());
            for point in points {
                let Some(character) = char::from_u32(point) else {
                    return Err(Failure::Kind(Error::InvalidText));
                };
                text.push(character);
            }
            Ok(text.into_bytes())
        }
    }
}
