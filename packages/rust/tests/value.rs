//! Requirements: RQ-002, RQ-004, RQ-005, RQ-006, RQ-007, RQ-008, RQ-009, RQ-010. The building of a value, the offsets of
//! errors, the text of floats and values deeper than a stack holds.

use polyspec_php_serialize::{serialize, unserialize, Error, Key, Node, PhpValue, DEPTH_LIMIT};

type Outcome = Result<(), Error>;

fn written(value: &PhpValue) -> Result<String, Error> {
    Ok(String::from_utf8_lossy(&serialize(value)?).into_owned())
}

fn refusal(bytes: &[u8]) -> Option<(&'static str, Option<u64>)> {
    match unserialize(bytes) {
        Ok(_) => None,
        Err(error) => Some((error.kind(), error.offset())),
    }
}

/// RQ-010: the kind and the offset of each failure of unserialize.
#[test]
fn offsets_of_errors() {
    let deep = [
        b"a:1:{i:0;".repeat(DEPTH_LIMIT + 1),
        b"N;".to_vec(),
        b"}".repeat(DEPTH_LIMIT + 1),
    ]
    .concat();
    let cases: [(&[u8], &str, u64); 15] = [
        (b"", "syntax", 0),
        (b"i:1", "syntax", 3),
        (b"i:;", "syntax", 2),
        (b"b:2;", "syntax", 2),
        (b"d:1e;", "syntax", 4),
        (b"s:9:\"abc\";", "syntax", 2),
        (b"s:1:\"abc\";", "syntax", 6),
        (b"S:1:\"\\zz\";", "syntax", 6),
        (b"a:1:{i:0;R:9;}", "reference", 9),
        (b"O:3:\"Foo\":0:{}", "class", 0),
        (b"i:1;i:2;", "trailing_data", 4),
        (
            b"O:8:\"stdClass\":1:{s:2:\"\0a\";i:1;}",
            "property_name",
            18,
        ),
        (b"a:1:{i:0;R:1;}", "top_array_reference", 9),
        (b"i:9223372036854775808;", "int_range", 0),
        (&deep, "depth", 9 * DEPTH_LIMIT as u64),
    ];
    for (bytes, kind, offset) in cases {
        assert_eq!(
            refusal(bytes),
            Some((kind, Some(offset))),
            "{}",
            String::from_utf8_lossy(bytes)
        );
    }
}

/// RQ-004, RQ-008: a string key in the canonical form of an integer is that integer, and a key that repeats keeps its
/// position and takes the last value.
#[test]
fn keys_of_an_array() -> Outcome {
    let mut value = PhpValue::new();
    let array = value.new_array();
    for (key, number) in [
        ("5", 1),
        ("05", 2),
        ("-0", 3),
        ("-5", 4),
        ("9223372036854775808", 5),
        ("5", 6),
    ] {
        value.set_element(
            array,
            Key::String(key.as_bytes().to_vec()),
            Node::Int(number),
        )?;
    }
    value.set_root(Node::Array(array))?;
    assert_eq!(
        written(&value)?,
        "a:5:{i:5;i:6;s:2:\"05\";i:2;s:2:\"-0\";i:3;i:-5;i:4;s:19:\"9223372036854775808\";i:5;}"
    );
    Ok(())
}

/// RQ-008: an array is a value that one position holds; a reference holds no reference; the top value is no reference;
/// an identity that the value does not hold is refused.
#[test]
fn refusals_of_building() -> Outcome {
    let mut value = PhpValue::new();
    let inner = value.new_array();
    let outer = value.new_array();
    value.set_element(outer, Key::Int(0), Node::Array(inner))?;
    assert_eq!(
        value.set_element(outer, Key::Int(1), Node::Array(inner)),
        Err(Error::ArrayHeld)
    );
    assert_eq!(
        value.set_element(inner, Key::Int(0), Node::Array(outer)),
        Ok(())
    );
    // The outer array now holds itself through inner: no position may take it, so no value reaches the cycle.
    assert_eq!(value.set_root(Node::Array(outer)), Err(Error::ArrayHeld));
    let reference = value.new_reference(Node::Int(1))?;
    assert_eq!(
        value.new_reference(Node::Reference(reference)),
        Err(Error::NestedReference)
    );
    assert_eq!(
        value.set_reference(reference, Node::Reference(reference)),
        Err(Error::NestedReference)
    );
    assert_eq!(
        value.set_root(Node::Reference(reference)),
        Err(Error::TopReference)
    );
    let mut other = PhpValue::new();
    assert_eq!(other.set_root(Node::Array(outer)), Err(Error::UnknownId));
    let object = value.new_object();
    assert_eq!(
        value.set_property(object, b"\0a".to_vec(), Node::Null),
        Err(Error::PropertyName { offset: None })
    );
    value.set_property(object, Vec::new(), Node::Null)?;
    // Replacing the element frees the array, which another position may then hold.
    value.set_element(outer, Key::Int(0), Node::Null)?;
    value.set_root(Node::Array(inner))?;
    Ok(())
}

/// RQ-005: positions that hold one object or one reference share it, written as r: and R: after the first position; a
/// reference to an object counts as the object.
#[test]
fn shared_positions() -> Outcome {
    let mut value = PhpValue::new();
    let object = value.new_object();
    value.set_property(object, b"self".to_vec(), Node::Object(object))?;
    let shared = value.new_reference(Node::Int(7))?;
    let to_object = value.new_reference(Node::Object(object))?;
    let array = value.new_array();
    for (index, node) in [
        Node::Object(object),
        Node::Reference(shared),
        Node::Reference(shared),
        Node::Reference(to_object),
        Node::Object(object),
    ]
    .into_iter()
    .enumerate()
    {
        value.set_element(array, Key::Int(index as i64), node)?;
    }
    value.set_root(Node::Array(array))?;
    let text = written(&value)?;
    assert_eq!(
        text,
        "a:5:{i:0;O:8:\"stdClass\":1:{s:4:\"self\";r:2;}i:1;i:7;i:2;R:4;i:3;R:2;i:4;r:2;}"
    );
    let read = unserialize(text.as_bytes())?;
    assert_eq!(serialize(&read)?, text.as_bytes());
    Ok(())
}

/// RQ-002: the shortest digits in the layout of php_gcvt.
#[test]
fn float_texts() -> Outcome {
    let cases = [
        (1.0, "1"),
        (-0.0, "-0"),
        (0.1, "0.1"),
        (1e-4, "0.0001"),
        (1e-5, "1.0E-5"),
        (1.5e-7, "1.5E-7"),
        (1e15, "1000000000000000"),
        (1e17, "1.0E+17"),
        (123456789012345678.0, "1.2345678901234568E+17"),
        (100000.0, "100000"),
        (2f64.powi(60), "1.152921504606847E+18"),
        // The float is exactly -98481486523842.625: a tie between two shortest digits takes the even one, as zend_dtoa does.
        (-98481486523842.62, "-98481486523842.62"),
        (f64::INFINITY, "INF"),
        (f64::NEG_INFINITY, "-INF"),
        (f64::NAN, "NAN"),
        (5e-324, "5.0E-324"),
    ];
    for (number, text) in cases {
        let mut value = PhpValue::new();
        value.set_root(Node::Float(number))?;
        assert_eq!(written(&value)?, format!("d:{text};"), "{number}");
    }
    Ok(())
}

/// RQ-006, RQ-007: a value deeper than the limit is refused when written, and neither a deep value nor its drop recurses.
#[test]
fn deep_values() -> Outcome {
    for (depth, refused) in [
        (DEPTH_LIMIT, false),
        (DEPTH_LIMIT + 1, true),
        (1_000_000, true),
    ] {
        let mut value = PhpValue::new();
        let mut inner = Node::Null;
        for _ in 0..depth {
            let array = value.new_array();
            value.set_element(array, Key::Int(0), inner)?;
            inner = Node::Array(array);
        }
        value.set_root(inner)?;
        assert_eq!(
            serialize(&value).map(|_| ()),
            if refused {
                Err(Error::Depth { offset: None })
            } else {
                Ok(())
            }
        );
    }
    Ok(())
}
