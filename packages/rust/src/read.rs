//! unserialize: the bytes of the format to a value (RQ-001 to RQ-007, RQ-009, RQ-010). The reader keeps its own stack of
//! open arrays and objects, so it never recurses (RQ-006).

use crate::at_depth_limit;
use crate::error::{offset, Error};
use crate::float::{parse_float, scan_float};
use crate::value::{
    integer_of, ArrayId, ArraySlot, Key, Node, ObjectId, PhpValue, ReferenceId, StdClass,
};

/// A position of the value being read: the top value, an element of an array or a property of an object. A slot of the
/// format names a position (RQ-005).
#[derive(Debug, Clone, PartialEq)]
enum Place {
    Root,
    Element(usize, Key),
    Property(usize, Vec<u8>),
}

#[derive(Debug, Clone, Copy)]
enum Container {
    Array(usize),
    Object(usize),
}

/// An array or an object whose entries are being read.
struct Frame {
    container: Container,
    remaining: u64,
}

/// A key as the input writes it, before the rules of an array or of an object apply (RQ-004).
enum RawKey {
    Int(i64),
    Bytes(Vec<u8>),
}

struct Reader<'a> {
    data: &'a [u8],
    at: usize,
    value: PhpValue,
    /// The positions that `R:` and `r:` name, numbered from 1 in the order of `php_var_unserialize` (RQ-005).
    slots: Vec<Place>,
    stack: Vec<Frame>,
}

/// Returns the value of the bytes that PHP reads; every other input, and the inputs refused on purpose, give an error with
/// a kind and an offset (RQ-010).
pub fn unserialize(data: &[u8]) -> Result<PhpValue, Error> {
    let mut reader = Reader {
        data,
        at: 0,
        value: PhpValue::new(),
        slots: Vec::new(),
        stack: Vec::new(),
    };
    reader.read()?;
    if reader.at != data.len() {
        return Err(Error::TrailingData {
            offset: offset(reader.at),
        });
    }
    finish(reader.value)
}

impl Reader<'_> {
    fn syntax(&self, at: usize, expected: &'static str) -> Error {
        Error::Syntax {
            offset: offset(at),
            expected,
        }
    }

    fn byte(&self, at: usize) -> Option<u8> {
        self.data.get(at).copied()
    }

    fn starts_with(&self, text: &[u8]) -> bool {
        self.data
            .get(self.at..)
            .is_some_and(|rest| rest.starts_with(text))
    }

    /// Reads the bytes of `text`; the offset of a failure is the first byte that differs (RQ-010).
    fn expect(&mut self, text: &'static [u8], expected: &'static str) -> Result<(), Error> {
        for (index, wanted) in text.iter().enumerate() {
            if self.byte(self.at + index) != Some(*wanted) {
                return Err(self.syntax(self.at + index, expected));
            }
        }
        self.at += text.len();
        Ok(())
    }

    /// Reads one or more digits and returns their first position.
    fn digits(&mut self) -> Result<usize, Error> {
        let start = self.at;
        while matches!(self.byte(self.at), Some(b'0'..=b'9')) {
            self.at += 1;
        }
        if self.at == start {
            return Err(self.syntax(self.at, "a digit"));
        }
        Ok(start)
    }

    /// Reads a length or a slot as parse_uiv does: digits without a sign, wrapping at 64 bits. Returns the number and the
    /// position of its first digit.
    fn length(&mut self) -> Result<(u64, usize), Error> {
        let start = self.digits()?;
        let mut number: u64 = 0;
        for digit in self.data.get(start..self.at).into_iter().flatten() {
            number = number
                .wrapping_mul(10)
                .wrapping_add(u64::from(digit - b'0'));
        }
        Ok((number, start))
    }

    /// The bytes that remain after the position of the reader.
    fn remaining(&self) -> u64 {
        offset(self.data.len().saturating_sub(self.at))
    }

    /// Reads `<length>:"` of a string; a length larger than the bytes that remain is refused before anything is allocated
    /// (RQ-007).
    fn string_length(&mut self) -> Result<usize, Error> {
        let (length, start) = self.length()?;
        self.expect(b":\"", "the quote that opens a string")?;
        let too_long = Error::Syntax {
            offset: offset(start),
            expected: "a length within the remaining input",
        };
        if length > self.remaining() {
            return Err(too_long);
        }
        // A length within the remaining bytes fits in a usize; past it, the length is still too long.
        match usize::try_from(length) {
            Ok(size) => Ok(size),
            Err(_) => Err(too_long),
        }
    }

    /// Reads `<length>:"<bytes>"` of `s:` and of the name of `O:`.
    fn raw_string(&mut self) -> Result<Vec<u8>, Error> {
        let size = self.string_length()?;
        let Some(bytes) = self.data.get(self.at..self.at + size) else {
            return Err(Error::Internal {
                what: "a checked length exceeds the input",
            });
        };
        let bytes = bytes.to_vec();
        self.at += size;
        self.expect(b"\"", "the quote that closes a string")?;
        Ok(bytes)
    }

    /// Reads `<length>:"<bytes>"` of `S:`, where `\xx` is the byte of two hexadecimal digits.
    fn escaped_string(&mut self) -> Result<Vec<u8>, Error> {
        let size = self.string_length()?;
        let mut bytes = Vec::new();
        for _ in 0..size {
            match self.byte(self.at) {
                None => return Err(self.syntax(self.at, "a byte of the string")),
                Some(b'\\') => {
                    let mut byte = 0_u8;
                    for position in self.at + 1..self.at + 3 {
                        let digit = match self.byte(position) {
                            Some(digit @ b'0'..=b'9') => digit - b'0',
                            Some(digit @ b'a'..=b'f') => digit - b'a' + 10,
                            Some(digit @ b'A'..=b'F') => digit - b'A' + 10,
                            _ => return Err(self.syntax(position, "a hexadecimal digit")),
                        };
                        byte = byte * 16 + digit;
                    }
                    bytes.push(byte);
                    self.at += 3;
                }
                Some(byte) => {
                    bytes.push(byte);
                    self.at += 1;
                }
            }
        }
        self.expect(b"\"", "the quote that closes a string")?;
        Ok(bytes)
    }

    /// Reads `[+-]<digits>;` of an integer whose token starts at `start`; an integer outside 64 bits is refused on purpose,
    /// after the grammar of the token holds.
    fn integer(&mut self, start: usize) -> Result<i64, Error> {
        let negative = self.byte(self.at) == Some(b'-');
        if matches!(self.byte(self.at), Some(b'+' | b'-')) {
            self.at += 1;
        }
        let first = self.digits()?;
        let end = self.at;
        self.expect(b";", "the semicolon after an integer")?;
        let digits = self
            .data
            .get(first..end)
            .into_iter()
            .flatten()
            .skip_while(|digit| **digit == b'0');
        let mut magnitude: u64 = 0;
        for (count, digit) in digits.enumerate() {
            // 19 digits hold every 64-bit integer; a longer number is out of range.
            if count >= 19 {
                return Err(Error::IntRange {
                    offset: offset(start),
                });
            }
            magnitude = magnitude * 10 + u64::from(digit - b'0');
        }
        integer_of(negative, magnitude).ok_or(Error::IntRange {
            offset: offset(start),
        })
    }

    /// Reads the count of an array (digits) or of an object (an optional sign and optional digits, as parse_iv2 reads it),
    /// refused when it exceeds the bytes that remain, before anything is allocated (RQ-007).
    fn count(&mut self, is_object: bool) -> Result<u64, Error> {
        let start = self.at;
        let negative = is_object && self.byte(self.at) == Some(b'-');
        if is_object && matches!(self.byte(self.at), Some(b'+' | b'-')) {
            self.at += 1;
        }
        let first = self.at;
        if is_object {
            while matches!(self.byte(self.at), Some(b'0'..=b'9')) {
                self.at += 1;
            }
        } else {
            self.digits()?;
        }
        let too_large = || Error::Syntax {
            offset: offset(start),
            expected: "a count within the remaining input",
        };
        let mut count: u64 = 0;
        for (index, digit) in self
            .data
            .get(first..self.at)
            .into_iter()
            .flatten()
            .skip_while(|digit| **digit == b'0')
            .enumerate()
        {
            if index >= 19 {
                return Err(too_large());
            }
            count = count * 10 + u64::from(digit - b'0');
        }
        if (negative && count > 0) || count > self.remaining() {
            return Err(too_large());
        }
        Ok(count)
    }

    /// Opens the entries of an array or an object whose token starts at `start`: PHP checks the depth of every object but
    /// only of an array that holds elements (RQ-006).
    fn open(&mut self, container: Container, start: usize) -> Result<(), Error> {
        let is_object = matches!(container, Container::Object(_));
        let count = self.count(is_object)?;
        self.expect(b":{", "the brace that opens the entries")?;
        if (count > 0 || is_object) && at_depth_limit(self.stack.len()) {
            return Err(Error::Depth {
                offset: Some(offset(start)),
            });
        }
        self.stack.push(Frame {
            container,
            remaining: count,
        });
        Ok(())
    }

    fn get(&self, place: &Place) -> Result<&Node, Error> {
        let found = match place {
            Place::Root => Some(&self.value.root),
            Place::Element(array, key) => self
                .value
                .arrays
                .get(*array)
                .and_then(|slot| slot.array.entries.get(key)),
            Place::Property(object, name) => self
                .value
                .objects
                .get(*object)
                .and_then(|target| target.properties.get(name)),
        };
        found.ok_or(Error::Internal {
            what: "a slot names no position",
        })
    }

    /// Sets the value of a position, which keeps its place in its array or object, and returns the value that it held.
    fn set(&mut self, place: &Place, node: Node) -> Result<Node, Error> {
        let old = match place {
            Place::Root => Some(std::mem::replace(&mut self.value.root, node)),
            Place::Element(array, key) => match self.value.arrays.get_mut(*array) {
                Some(slot) => slot.array.entries.set(key.clone(), node)?,
                None => {
                    return Err(Error::Internal {
                        what: "a position names no array",
                    })
                }
            },
            Place::Property(object, name) => match self.value.objects.get_mut(*object) {
                Some(target) => target.properties.set(name.clone(), node)?,
                None => {
                    return Err(Error::Internal {
                        what: "a position names no object",
                    })
                }
            },
        };
        Ok(match old {
            Some(node) => node,
            None => Node::Null,
        })
    }

    /// Reads `<slot>;` of `R:` or `r:` whose token starts at `start` and returns the position that it names.
    fn named_slot(&mut self, start: usize) -> Result<Place, Error> {
        let (number, _) = self.length()?;
        self.expect(b";", "the semicolon after a slot")?;
        // A slot past the slots read so far, 0 included, names no value (RQ-005).
        let found = match usize::try_from(number) {
            Ok(number) if number >= 1 => self.slots.get(number - 1),
            _ => None,
        };
        match found {
            Some(place) => Ok(place.clone()),
            None => Err(Error::Reference {
                offset: offset(start),
            }),
        }
    }

    /// Reads one value into a position, and opens a frame for an array or an object.
    fn read_value(&mut self, place: Place) -> Result<(), Error> {
        let start = self.at;
        if self.starts_with(b"R:") {
            self.at += 2;
            let slot = self.named_slot(start)?;
            if slot == place {
                return Err(Error::Reference {
                    offset: offset(start),
                });
            }
            let found = match self.get(&slot)? {
                Node::Reference(reference) => Some(*reference),
                _ => None,
            };
            let target = match found {
                Some(reference) => {
                    self.value
                        .references
                        .get(reference.0)
                        .ok_or(Error::Internal {
                            what: "a reference names no value",
                        })?
                }
                None => self.get(&slot)?,
            };
            // PHP reads this, but its serialize never writes it, and what it writes back is not these bytes.
            if slot == Place::Root && matches!(target, Node::Array(_)) {
                return Err(Error::TopArrayReference {
                    offset: offset(start),
                });
            }
            let reference = match found {
                Some(reference) => reference,
                None => {
                    let reference = ReferenceId(self.value.references.len());
                    let old = self.set(&slot, Node::Reference(reference))?;
                    self.value.references.push(old);
                    reference
                }
            };
            self.set(&place, Node::Reference(reference))?;
            return Ok(());
        }
        self.slots.push(place.clone());
        let node = if self.starts_with(b"r:") {
            self.at += 2;
            let slot = self.named_slot(start)?;
            let target = match self.get(&slot)? {
                Node::Reference(reference) => {
                    self.value
                        .references
                        .get(reference.0)
                        .ok_or(Error::Internal {
                            what: "a reference names no value",
                        })?
                }
                other => other,
            };
            match target {
                Node::Object(object) => Node::Object(*object),
                _ => {
                    return Err(Error::Reference {
                        offset: offset(start),
                    })
                }
            }
        } else if self.starts_with(b"N") {
            self.at += 1;
            self.expect(b";", "the semicolon after null")?;
            Node::Null
        } else if self.starts_with(b"b:") {
            self.at += 2;
            let value = match self.byte(self.at) {
                Some(b'0') => false,
                Some(b'1') => true,
                _ => return Err(self.syntax(self.at, "0 or 1")),
            };
            self.at += 1;
            self.expect(b";", "the semicolon after a boolean")?;
            Node::Bool(value)
        } else if self.starts_with(b"i:") {
            self.at += 2;
            Node::Int(self.integer(start)?)
        } else if self.starts_with(b"d:") {
            self.at += 2;
            let end = match scan_float(self.data, self.at) {
                Ok(end) => end,
                Err(at) => return Err(self.syntax(at, "the text of a float")),
            };
            let text = self.data.get(self.at..end).ok_or(Error::Internal {
                what: "a scanned float exceeds the input",
            })?;
            let value = parse_float(text)?;
            self.at = end;
            self.expect(b";", "the semicolon after a float")?;
            Node::Float(value)
        } else if self.starts_with(b"s:") || self.starts_with(b"S:") {
            let escaped = self.starts_with(b"S:");
            self.at += 2;
            let bytes = if escaped {
                self.escaped_string()?
            } else {
                self.raw_string()?
            };
            self.expect(b";", "the semicolon after a string")?;
            Node::String(bytes)
        } else if self.starts_with(b"a:") {
            self.at += 2;
            let array = self.value.arrays.len();
            self.value.arrays.push(ArraySlot {
                held: true,
                ..ArraySlot::default()
            });
            self.set(&place, Node::Array(ArrayId(array)))?;
            return self.open(Container::Array(array), start);
        } else if self.starts_with(b"O:") {
            self.at += 2;
            let name = self.raw_string()?;
            if !name.eq_ignore_ascii_case(b"stdClass") {
                return Err(Error::Class {
                    offset: offset(start),
                });
            }
            self.expect(b":", "the colon after the class name")?;
            let object = self.value.objects.len();
            self.value.objects.push(StdClass::default());
            self.set(&place, Node::Object(ObjectId(object)))?;
            return self.open(Container::Object(object), start);
        } else if self.starts_with(b"C:") || self.starts_with(b"E:") {
            return Err(Error::Class {
                offset: offset(start),
            });
        } else {
            return Err(self.syntax(start, "a value"));
        };
        self.set(&place, node)?;
        Ok(())
    }

    /// Reads a key: `i:`, `s:` or `S:`.
    fn key(&mut self) -> Result<RawKey, Error> {
        let start = self.at;
        if self.starts_with(b"i:") {
            self.at += 2;
            return Ok(RawKey::Int(self.integer(start)?));
        }
        let bytes = if self.starts_with(b"s:") {
            self.at += 2;
            self.raw_string()?
        } else if self.starts_with(b"S:") {
            self.at += 2;
            self.escaped_string()?
        } else {
            return Err(self.syntax(start, "an integer or a string key"));
        };
        self.expect(b";", "the semicolon after a key")?;
        Ok(RawKey::Bytes(bytes))
    }

    fn read(&mut self) -> Result<(), Error> {
        self.read_value(Place::Root)?;
        loop {
            let Some(frame) = self.stack.last_mut() else {
                return Ok(());
            };
            if frame.remaining == 0 {
                self.expect(b"}", "the brace that closes the entries")?;
                self.stack.pop();
                continue;
            }
            frame.remaining -= 1;
            let container = frame.container;
            let start = self.at;
            let key = self.key()?;
            let place = match container {
                Container::Array(array) => Place::Element(
                    array,
                    match key {
                        RawKey::Int(number) => Key::Int(number),
                        RawKey::Bytes(bytes) => Key::of_string(bytes),
                    },
                ),
                Container::Object(object) => {
                    // A property name is always a string: PHP converts an integer key of an object (RQ-004).
                    let name = match key {
                        RawKey::Int(number) => number.to_string().into_bytes(),
                        RawKey::Bytes(bytes) => bytes,
                    };
                    // RQ-009: refused when read, also when a repeated key overwrites the object later.
                    if name.first() == Some(&0) {
                        return Err(Error::PropertyName {
                            offset: Some(offset(start)),
                        });
                    }
                    Place::Property(object, name)
                }
            };
            // A key that repeats keeps its first position and starts empty (RQ-004).
            self.set(&place, Node::Null)?;
            self.read_value(place)?;
        }
    }
}

/// What the passes of [`finish`] visit.
#[derive(Clone, Copy)]
enum Visit {
    Array(usize),
    Object(usize),
    Reference(usize),
}

const fn visit_of(node: &Node) -> Option<Visit> {
    match node {
        Node::Array(id) => Some(Visit::Array(id.0)),
        Node::Object(id) => Some(Visit::Object(id.0)),
        Node::Reference(id) => Some(Visit::Reference(id.0)),
        Node::Null | Node::Bool(_) | Node::Int(_) | Node::Float(_) | Node::String(_) => None,
    }
}

/// Gives the value that the reader built the form of RQ-005 and RQ-008: the top value is no reference, a reference that one
/// reachable position alone holds is its value, and only what the top value reaches stays, numbered by first appearance.
fn finish(raw: PhpValue) -> Result<PhpValue, Error> {
    let root = match &raw.root {
        Node::Reference(reference) => raw
            .references
            .get(reference.0)
            .ok_or(Error::Internal {
                what: "the top reference names no value",
            })?
            .clone(),
        other => other.clone(),
    };
    let mut holders = vec![0_usize; raw.references.len()];
    let mut arrays_seen = vec![false; raw.arrays.len()];
    let mut objects_seen = vec![false; raw.objects.len()];
    let mut pending: Vec<Visit> = visit_of(&root).into_iter().collect();
    let missing = || Error::Internal {
        what: "the value names a part that it does not hold",
    };
    while let Some(visit) = pending.pop() {
        match visit {
            Visit::Reference(id) => {
                let count = holders.get_mut(id).ok_or_else(missing)?;
                *count += 1;
                if *count == 1 {
                    pending.extend(visit_of(raw.references.get(id).ok_or_else(missing)?));
                }
            }
            Visit::Array(id) => {
                let seen = arrays_seen.get_mut(id).ok_or_else(missing)?;
                if !*seen {
                    *seen = true;
                    let slot = raw.arrays.get(id).ok_or_else(missing)?;
                    pending.extend(
                        slot.array
                            .entries
                            .list
                            .iter()
                            .filter_map(|(_, node)| visit_of(node)),
                    );
                }
            }
            Visit::Object(id) => {
                let seen = objects_seen.get_mut(id).ok_or_else(missing)?;
                if !*seen {
                    *seen = true;
                    let object = raw.objects.get(id).ok_or_else(missing)?;
                    pending.extend(
                        object
                            .properties
                            .list
                            .iter()
                            .filter_map(|(_, node)| visit_of(node)),
                    );
                }
            }
        }
    }
    let mut builder = Builder {
        array_map: vec![None; raw.arrays.len()],
        object_map: vec![None; raw.objects.len()],
        reference_map: vec![None; raw.references.len()],
        raw,
        holders,
        out: PhpValue::new(),
        work: Vec::new(),
    };
    let root = builder.convert(root)?;
    builder.out.root = root;
    while let Some(visit) = builder.work.pop() {
        builder.fill(visit)?;
    }
    Ok(builder.out)
}

/// The second pass of [`finish`], which moves the reachable parts into a new value.
struct Builder {
    raw: PhpValue,
    holders: Vec<usize>,
    out: PhpValue,
    array_map: Vec<Option<usize>>,
    object_map: Vec<Option<usize>>,
    reference_map: Vec<Option<usize>>,
    /// The parts of the raw value to move, each with its identity in the new value.
    work: Vec<(Visit, usize)>,
}

impl Builder {
    fn convert(&mut self, node: Node) -> Result<Node, Error> {
        let missing = || Error::Internal {
            what: "the value names a part that it does not hold",
        };
        Ok(match node {
            Node::Reference(id) => {
                if *self.holders.get(id.0).ok_or_else(missing)? > 1 {
                    let mapped = self.reference_map.get_mut(id.0).ok_or_else(missing)?;
                    let new = match *mapped {
                        Some(new) => new,
                        None => {
                            let new = self.out.references.len();
                            *mapped = Some(new);
                            self.out.references.push(Node::Null);
                            self.work.push((Visit::Reference(id.0), new));
                            new
                        }
                    };
                    Node::Reference(ReferenceId(new))
                } else {
                    // One position holds the reference, so it is a plain value (RQ-005); a reference holds no reference.
                    let inner = std::mem::replace(
                        self.raw.references.get_mut(id.0).ok_or_else(missing)?,
                        Node::Null,
                    );
                    if matches!(inner, Node::Reference(_)) {
                        return Err(Error::Internal {
                            what: "a reference holds a reference",
                        });
                    }
                    self.convert(inner)?
                }
            }
            Node::Array(id) => {
                let mapped = self.array_map.get_mut(id.0).ok_or_else(missing)?;
                if mapped.is_some() {
                    return Err(Error::Internal {
                        what: "two positions hold one array",
                    });
                }
                let new = self.out.arrays.len();
                *mapped = Some(new);
                self.out.arrays.push(ArraySlot {
                    held: true,
                    ..ArraySlot::default()
                });
                self.work.push((Visit::Array(id.0), new));
                Node::Array(ArrayId(new))
            }
            Node::Object(id) => {
                let mapped = self.object_map.get_mut(id.0).ok_or_else(missing)?;
                let new = match *mapped {
                    Some(new) => new,
                    None => {
                        let new = self.out.objects.len();
                        *mapped = Some(new);
                        self.out.objects.push(StdClass::default());
                        self.work.push((Visit::Object(id.0), new));
                        new
                    }
                };
                Node::Object(ObjectId(new))
            }
            scalar @ (Node::Null
            | Node::Bool(_)
            | Node::Int(_)
            | Node::Float(_)
            | Node::String(_)) => scalar,
        })
    }

    fn fill(&mut self, (visit, new): (Visit, usize)) -> Result<(), Error> {
        let missing = || Error::Internal {
            what: "the value names a part that it does not hold",
        };
        match visit {
            Visit::Array(old) => {
                let entries = std::mem::take(
                    &mut self
                        .raw
                        .arrays
                        .get_mut(old)
                        .ok_or_else(missing)?
                        .array
                        .entries
                        .list,
                );
                for (key, node) in entries {
                    let node = self.convert(node)?;
                    self.out
                        .arrays
                        .get_mut(new)
                        .ok_or_else(missing)?
                        .array
                        .entries
                        .set(key, node)?;
                }
            }
            Visit::Object(old) => {
                let properties = std::mem::take(
                    &mut self
                        .raw
                        .objects
                        .get_mut(old)
                        .ok_or_else(missing)?
                        .properties
                        .list,
                );
                for (name, node) in properties {
                    let node = self.convert(node)?;
                    self.out
                        .objects
                        .get_mut(new)
                        .ok_or_else(missing)?
                        .properties
                        .set(name, node)?;
                }
            }
            Visit::Reference(old) => {
                let node = std::mem::replace(
                    self.raw.references.get_mut(old).ok_or_else(missing)?,
                    Node::Null,
                );
                let node = self.convert(node)?;
                *self.out.references.get_mut(new).ok_or_else(missing)? = node;
            }
        }
        Ok(())
    }
}
