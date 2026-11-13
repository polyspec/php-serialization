//! Requirements: RQ-003, RQ-004, RQ-006, RQ-008, RQ-009, RQ-012. from_host and the constructors of the language classes,
//! over a language that a table of values stands for: a handle is the index of a value in the table.

use binding_core::HostValues;
use binding_core::{Failure, Handle, HostText, HostValue, Key, KeyedMap, Raised, ValueKind};
use polyspec_php_serialization::{check_reference, check_std_class, from_host, serialize, Error};

/// Whether the stand-in language has a float type apart from its integer type (PHP, Python) or one number type
/// (JavaScript), which decides whether a number is described as a float or as an untyped number (U-7 (f)).
#[derive(Clone, Copy)]
enum Numbers {
    Typed,
    Untyped,
}

/// A value of the stand-in language.
#[derive(Clone)]
enum Lang {
    Null,
    Undefined,
    Int(i64),
    Big,
    Float(f64),
    Text(&'static str),
    Utf16(Vec<u16>),
    Bytes(Vec<u8>),
    List(Vec<usize>),
    Map(Vec<(usize, usize)>),
    PhpArray(Vec<(usize, usize)>),
    PhpReference(u64, usize),
    StdClass(Vec<(usize, usize)>),
    /// A `PhpFloat`, a `StdClass` (its properties, a `Map`) or a `Reference` of the value table.
    Instance(ValueKind, usize),
    /// A value whose question raises an exception.
    Raises,
}

struct Host {
    values: Vec<Lang>,
    numbers: Numbers,
}

fn number(n: usize) -> u64 {
    match u64::try_from(n) {
        Ok(n) => n,
        Err(_) => unreachable!("a usize fits in a u64"),
    }
}

fn index_of(n: u64) -> usize {
    match usize::try_from(n) {
        Ok(n) => n,
        Err(_) => unreachable!("the tests use small indexes"),
    }
}

fn handle(at: usize) -> Handle {
    Handle::new(number(at))
}

impl Host {
    fn get(&self, handle: Handle) -> Lang {
        self.lang(index_of(handle.raw()))
    }

    fn lang(&self, at: usize) -> Lang {
        match self.values.get(at) {
            Some(value) => value.clone(),
            None => Lang::Null,
        }
    }

    fn describe(&self, index: usize) -> HostValue {
        let len = number;
        match self.lang(index) {
            Lang::Null => HostValue::Null,
            Lang::Undefined => HostValue::Undefined,
            Lang::Int(number) => HostValue::Int(number),
            Lang::Big => HostValue::Number(String::from("9223372036854775808")),
            Lang::Float(number) => match self.numbers {
                Numbers::Typed => HostValue::Float(number),
                Numbers::Untyped => HostValue::UntypedNumber(number),
            },
            Lang::Text(text) => HostValue::Text(HostText::Utf16(text.encode_utf16().collect())),
            Lang::Utf16(units) => HostValue::Text(HostText::Utf16(units)),
            Lang::Bytes(bytes) => HostValue::Bytes(bytes),
            Lang::List(items) => HostValue::List {
                handle: handle(index),
                len: len(items.len()),
            },
            Lang::Map(entries) => HostValue::Map {
                handle: handle(index),
                len: len(entries.len()),
            },
            Lang::PhpArray(entries) => HostValue::PhpArray {
                handle: handle(index),
                len: len(entries.len()),
                is_list: false,
            },
            Lang::PhpReference(identity, target) => HostValue::PhpReference {
                identity: Handle::new(identity),
                target: Box::new(self.describe(target)),
            },
            Lang::StdClass(entries) => HostValue::StdClass {
                handle: handle(index),
                len: len(entries.len()),
            },
            Lang::Instance(kind, _) => HostValue::Value {
                kind,
                handle: handle(index),
            },
            Lang::Raises => HostValue::List {
                handle: handle(index),
                len: 1,
            },
        }
    }
}

impl HostValues for Host {
    fn item(&mut self, list: Handle, index: u64) -> Result<HostValue, Raised> {
        match self.get(list) {
            Lang::List(items) => match items.get(index_of(index)) {
                Some(item) => Ok(self.describe(*item)),
                None => Err(Raised::from_generated(list)),
            },
            _ => Err(Raised::from_generated(list)),
        }
    }

    fn entry(&mut self, map: Handle, index: u64) -> Result<(HostValue, HostValue), Raised> {
        match self.get(map) {
            Lang::Map(entries) | Lang::PhpArray(entries) | Lang::StdClass(entries) => {
                match entries.get(index_of(index)) {
                    Some((key, value)) => Ok((self.describe(*key), self.describe(*value))),
                    None => Err(Raised::from_generated(map)),
                }
            }
            _ => Err(Raised::from_generated(map)),
        }
    }

    fn read(&mut self, value: Handle) -> Result<HostValue, Raised> {
        match self.get(value) {
            Lang::Instance(_, content) => Ok(self.describe(content)),
            _ => Err(Raised::from_generated(value)),
        }
    }
}

/// The bytes that serialize writes for the value of entry 0 of the table.
fn written(values: Vec<Lang>, numbers: Numbers) -> Result<String, Failure<Error>> {
    let mut host = Host { values, numbers };
    let top = host.describe(0);
    let value = from_host(&mut host, top)?;
    let bytes = serialize(&value).map_err(Failure::Kind)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn kind(result: Result<String, Failure<Error>>) -> Option<&'static str> {
    match result {
        Err(Failure::Kind(error)) => Some(error.kind()),
        Ok(_) | Err(Failure::Raised(_) | Failure::Callback(_)) => None,
    }
}

/// RQ-012, RQ-008: a number of JavaScript is an integer when it is a safe integer and not -0; a float of a typed
/// language stays a float, and so does a PhpFloat.
#[test]
fn numbers() -> Result<(), Failure<Error>> {
    let cases = [
        (Lang::Float(1.0), Numbers::Untyped, "i:1;"),
        (Lang::Float(-0.0), Numbers::Untyped, "d:-0;"),
        (Lang::Float(1.5), Numbers::Untyped, "d:1.5;"),
        (
            Lang::Float(9_007_199_254_740_992.0),
            Numbers::Untyped,
            "d:9007199254740992;",
        ),
        (Lang::Float(1.0), Numbers::Typed, "d:1;"),
        (Lang::Int(7), Numbers::Untyped, "i:7;"),
    ];
    for (value, numbers, expected) in cases {
        assert_eq!(written(vec![value], numbers)?, expected);
    }
    assert_eq!(
        written(
            vec![Lang::Instance(ValueKind::Float, 1), Lang::Float(1.0)],
            Numbers::Untyped
        )?,
        "d:1;"
    );
    Ok(())
}

/// RQ-012, RQ-003: a text is its UTF-8, bytes are bytes, and a text with an unpaired surrogate is refused.
#[test]
fn texts() -> Result<(), Failure<Error>> {
    assert_eq!(
        written(vec![Lang::Text("é")], Numbers::Untyped)?,
        "s:2:\"é\";"
    );
    assert_eq!(
        written(vec![Lang::Bytes(vec![0xff])], Numbers::Typed)?,
        "s:1:\"\u{fffd}\";"
    );
    assert_eq!(
        kind(written(vec![Lang::Utf16(vec![0xd800])], Numbers::Untyped)),
        Some("invalid_text")
    );
    Ok(())
}

/// RQ-012, RQ-004: a list is an array with the keys 0 to n-1, and the key of a map is an integer or a string, which a
/// string in the canonical form of an integer makes that integer.
#[test]
fn arrays_and_keys() -> Result<(), Failure<Error>> {
    let list = vec![Lang::List(vec![1, 2]), Lang::Null, Lang::Text("a")];
    assert_eq!(
        written(list, Numbers::Untyped)?,
        "a:2:{i:0;N;i:1;s:1:\"a\";}"
    );
    let map = vec![
        Lang::Map(vec![(1, 2), (3, 2), (4, 2)]),
        Lang::Text("7"),
        Lang::Null,
        Lang::Float(2.0),
        Lang::Text("x"),
    ];
    assert_eq!(
        written(map, Numbers::Untyped)?,
        "a:3:{i:7;N;i:2;N;s:1:\"x\";N;}"
    );
    for key in [Lang::Float(1.5), Lang::Null, Lang::Float(2.0)] {
        let numbers = if matches!(key, Lang::Float(n) if n == 2.0) {
            Numbers::Typed
        } else {
            Numbers::Untyped
        };
        assert_eq!(
            kind(written(
                vec![Lang::Map(vec![(1, 2)]), key, Lang::Null],
                numbers
            )),
            Some("unsupported_value")
        );
    }
    Ok(())
}

/// RQ-012, U-7 (d): one object of the language is one object of PHP, at every position and inside itself.
#[test]
fn objects_keep_their_identity() -> Result<(), Failure<Error>> {
    let shared = vec![
        Lang::List(vec![1, 1]),
        Lang::Instance(ValueKind::Object, 2),
        Lang::Map(vec![]),
    ];
    assert_eq!(
        written(shared, Numbers::Untyped)?,
        "a:2:{i:0;O:8:\"stdClass\":0:{}i:1;r:2;}"
    );
    let itself = vec![Lang::StdClass(vec![(1, 0)]), Lang::Bytes(b"a".to_vec())];
    assert_eq!(
        written(itself, Numbers::Typed)?,
        "O:8:\"stdClass\":1:{s:1:\"a\";r:1;}"
    );
    let name = vec![
        Lang::StdClass(vec![(1, 2)]),
        Lang::Bytes(b"\0a".to_vec()),
        Lang::Null,
    ];
    assert_eq!(kind(written(name, Numbers::Typed)), Some("property_name"));
    // An integer name is its decimal text, as PHP gives the integer key of an array cast to an object.
    for (key, numbers) in [(Lang::Int(5), Numbers::Typed), (Lang::Float(5.0), Numbers::Untyped)] {
        let integer = vec![Lang::StdClass(vec![(1, 2)]), key, Lang::Text("a")];
        assert_eq!(
            written(integer, numbers)?,
            "O:8:\"stdClass\":1:{s:1:\"5\";s:1:\"a\";}"
        );
    }
    Ok(())
}

/// RQ-012, U-7 (g): the elements of a PHP array that share a reference share one reference of PHP; a reference is no
/// top value and holds no reference.
#[test]
fn references_keep_their_identity() -> Result<(), Failure<Error>> {
    let shared = vec![
        Lang::PhpArray(vec![(1, 2), (3, 2)]),
        Lang::Int(0),
        Lang::PhpReference(9, 4),
        Lang::Int(1),
        Lang::Int(5),
    ];
    assert_eq!(written(shared, Numbers::Typed)?, "a:2:{i:0;i:5;i:1;R:2;}");
    let objects = vec![
        Lang::List(vec![1, 1]),
        Lang::Instance(ValueKind::Reference, 2),
        Lang::Int(5),
    ];
    assert_eq!(
        written(objects, Numbers::Untyped)?,
        "a:2:{i:0;i:5;i:1;R:2;}"
    );
    assert_eq!(
        kind(written(
            vec![Lang::Instance(ValueKind::Reference, 1), Lang::Null],
            Numbers::Untyped
        )),
        Some("top_reference")
    );
    let nested = vec![
        Lang::List(vec![1]),
        Lang::Instance(ValueKind::Reference, 2),
        Lang::Instance(ValueKind::Reference, 3),
        Lang::Null,
    ];
    assert_eq!(
        kind(written(nested, Numbers::Untyped)),
        Some("nested_reference")
    );
    Ok(())
}

/// RQ-012, RQ-006: values that are no PHP value are refused with their kind, and an array of the language that holds
/// itself is one of them.
#[test]
fn values_that_php_has_not() {
    assert_eq!(
        kind(written(vec![Lang::Undefined], Numbers::Untyped)),
        Some("unsupported_value")
    );
    assert_eq!(
        kind(written(vec![Lang::Big], Numbers::Typed)),
        Some("int_range")
    );
    assert_eq!(
        kind(written(vec![Lang::List(vec![0])], Numbers::Untyped)),
        Some("unsupported_value")
    );
}

/// RQ-006: a value deeper than the limit is refused, and the walk does not recurse.
#[test]
fn depth() -> Result<(), Failure<Error>> {
    const LIMIT: usize = 4096;
    for (depth, refused) in [(LIMIT, false), (LIMIT + 1, true), (1_000_000, true)] {
        let mut values: Vec<Lang> = (1..=depth).map(|next| Lang::List(vec![next])).collect();
        values.push(Lang::Null);
        let result = written(values, Numbers::Untyped);
        if refused {
            assert_eq!(kind(result), Some("depth"));
        } else {
            result?;
        }
    }
    Ok(())
}

/// RQ-012: an exception that the language raised while it answered goes back as it is.
#[test]
fn a_raised_exception_goes_back() {
    let mut host = Host {
        values: vec![Lang::Raises],
        numbers: Numbers::Untyped,
    };
    let top = host.describe(0);
    assert!(
        matches!(from_host(&mut host, top), Err(Failure::Raised(raised)) if raised.handle() == handle(0))
    );
}

/// RQ-012, RQ-009, RQ-008: the constructors of StdClass and Reference judge what they take.
#[test]
fn constructors() {
    let mut host = Host {
        values: vec![Lang::Null, Lang::Instance(ValueKind::Reference, 0)],
        numbers: Numbers::Untyped,
    };
    assert!(check_std_class(&mut host, None).is_ok());
    let mut properties = KeyedMap::new();
    properties.insert(Key::Text(String::from("a")), HostValue::Int(1));
    properties.insert(Key::Bytes(vec![0xff]), HostValue::Null);
    assert!(check_std_class(&mut host, Some(properties)).is_ok());
    let mut properties = KeyedMap::new();
    properties.insert(Key::Int(1), HostValue::Null);
    assert!(check_std_class(&mut host, Some(properties)).is_ok());
    for key in [Key::Bytes(b"\0a".to_vec())] {
        let mut properties = KeyedMap::new();
        properties.insert(key, HostValue::Null);
        assert!(matches!(
            check_std_class(&mut host, Some(properties)),
            Err(Failure::Kind(_))
        ));
    }
    assert!(check_reference(&mut host, None).is_ok());
    assert!(check_reference(&mut host, Some(HostValue::Int(1))).is_ok());
    let reference = HostValue::Value {
        kind: ValueKind::Reference,
        handle: handle(1),
    };
    assert!(matches!(
        check_reference(&mut host, Some(reference)),
        Err(Failure::Kind(Error::NestedReference))
    ));
}
