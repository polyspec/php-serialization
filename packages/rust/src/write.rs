//! serialize: a value to the bytes that `php_var_serialize` writes for it (RQ-001, RQ-002, RQ-005, RQ-007). The writer keeps
//! its own stack of open arrays and objects, so it never recurses (RQ-006).

use std::collections::HashMap;

use crate::at_depth_limit;
use crate::error::Error;
use crate::float::write_float;
use crate::value::{Key, Node, ObjectId, PhpValue, ReferenceId};

#[derive(Clone, Copy)]
enum Open {
    Array(usize),
    Object(usize),
}

struct Writer<'a> {
    value: &'a PhpValue,
    out: Vec<u8>,
    /// The slot of the first position of each object and reference, as php_add_var_hash numbers them (RQ-005).
    objects: HashMap<ObjectId, u64>,
    references: HashMap<ReferenceId, u64>,
    counter: u64,
    stack: Vec<(Open, usize)>,
}

/// Returns the bytes of a value; a value nested deeper than unserialize reads is refused with `depth` (RQ-007).
pub fn serialize(value: &PhpValue) -> Result<Vec<u8>, Error> {
    let mut writer = Writer {
        value,
        out: Vec::new(),
        objects: HashMap::new(),
        references: HashMap::new(),
        counter: 0,
        stack: Vec::new(),
    };
    writer.node(value.root())?;
    loop {
        let Some((open, index)) = writer.stack.last_mut() else {
            return Ok(writer.out);
        };
        let open = *open;
        let position = *index;
        *index += 1;
        let missing = || Error::Internal {
            what: "an open array or object names no part of the value",
        };
        // RQ-014: the fault injection point imitates an open array or object that names no part of the value.
        if binding_core::fault::point!(crate::fault::INTERNAL).is_some() {
            return Err(missing());
        }
        match open {
            Open::Array(id) => {
                let array = &value.arrays.get(id).ok_or_else(missing)?.array;
                match array.entries.list.get(position) {
                    Some((key, node)) => {
                        writer.key(key);
                        writer.node(node)?;
                    }
                    None => writer.close(),
                }
            }
            Open::Object(id) => {
                let object = value.objects.get(id).ok_or_else(missing)?;
                match object.properties.list.get(position) {
                    Some((name, node)) => {
                        writer.string(name);
                        writer.node(node)?;
                    }
                    None => writer.close(),
                }
            }
        }
    }
}

impl Writer<'_> {
    fn text(&mut self, text: &str) {
        self.out.extend_from_slice(text.as_bytes());
    }

    fn string(&mut self, bytes: &[u8]) {
        self.text(&format!("s:{}:\"", bytes.len()));
        self.out.extend_from_slice(bytes);
        self.text("\";");
    }

    fn key(&mut self, key: &Key) {
        match key {
            Key::Int(number) => self.text(&format!("i:{number};")),
            Key::String(bytes) => self.string(bytes),
        }
    }

    fn close(&mut self) {
        self.stack.pop();
        self.out.push(b'}');
    }

    /// Opens the entries of an array or an object: unserialize checks the depth of every object, but only of an array that
    /// holds elements (RQ-006, RQ-007).
    fn open(&mut self, open: Open, size: usize) -> Result<(), Error> {
        let is_object = matches!(open, Open::Object(_));
        if (size > 0 || is_object) && at_depth_limit(self.stack.len()) {
            return Err(Error::Depth { offset: None });
        }
        if size == 0 {
            self.out.push(b'}');
        } else {
            self.stack.push((open, 0));
        }
        Ok(())
    }

    fn node(&mut self, node: &Node) -> Result<(), Error> {
        let (reference, target) = match node {
            Node::Reference(id) => (Some(*id), self.value.reference(*id)?),
            other => (None, other),
        };
        // A reference to an object counts as the object, as php_add_var_hash treats it.
        let object = match target {
            Node::Object(id) => Some(*id),
            _ => None,
        };
        let known = match (object, reference) {
            (Some(id), _) => self.objects.get(&id).copied(),
            (None, Some(id)) => self.references.get(&id).copied(),
            (None, None) => None,
        };
        if let Some(slot) = known {
            if reference.is_some() {
                self.text(&format!("R:{slot};"));
            } else {
                self.counter += 1;
                self.text(&format!("r:{slot};"));
            }
            return Ok(());
        }
        match (object, reference) {
            (Some(id), _) => {
                self.objects.insert(id, self.counter + 1);
            }
            (None, Some(id)) => {
                self.references.insert(id, self.counter + 1);
            }
            (None, None) => {}
        }
        self.counter += 1;
        match target {
            Node::Null => self.text("N;"),
            Node::Bool(value) => self.text(if *value { "b:1;" } else { "b:0;" }),
            Node::Int(number) => self.text(&format!("i:{number};")),
            Node::Float(value) => {
                self.text("d:");
                write_float(*value, &mut self.out)?;
                self.text(";");
            }
            Node::String(bytes) => self.string(bytes),
            Node::Array(id) => {
                let size = self.value.array(*id)?.len();
                self.text(&format!("a:{size}:{{"));
                self.open(Open::Array(id.0), size)?;
            }
            Node::Object(id) => {
                let size = self.value.object(*id)?.len();
                self.text(&format!("O:8:\"stdClass\":{size}:{{"));
                self.open(Open::Object(id.0), size)?;
            }
            Node::Reference(_) => {
                return Err(Error::Internal {
                    what: "a reference holds a reference",
                })
            }
        }
        Ok(())
    }
}
