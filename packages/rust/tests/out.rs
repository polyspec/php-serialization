//! Requirements: RQ-013. A question of a binding about a part that the value does not hold is a defect: to_host panics
//! with RQ-013 and the handle that it was given, which the binding turns into the kind internal (B-7), instead of
//! answering with a value (P-4).

use binding_core::{Handle, OutValue, OutValues};
use polyspec_php_serialization::{to_host, unserialize};

/// The message of the panic of a question.
fn defect(question: impl FnOnce() + std::panic::UnwindSafe) -> Option<String> {
    match std::panic::catch_unwind(question) {
        Ok(()) => None,
        Err(payload) => match payload.downcast::<String>() {
            Ok(message) => Some(*message),
            Err(_) => Some(String::from("a panic without a text")),
        },
    }
}

#[test]
fn an_entry_past_the_length_is_a_defect() -> Result<(), String> {
    let value = unserialize(b"a:1:{i:0;i:7;}").map_err(|error| error.to_string())?;
    let (top, mut children) = to_host(&value);
    let OutValue::Map(map) = top else {
        return Err(String::from("the top value is no map"));
    };
    assert_eq!(map.len(), 1);
    // The entry below the length answers.
    assert!(matches!(
        children.entry(map.handle(), 0),
        (OutValue::Int(_), OutValue::Int(_))
    ));
    let handle = map.handle().raw();
    let message = defect(move || {
        let (_, mut children) = to_host(&value);
        drop(children.entry(Handle::new(handle), 1));
    });
    assert_eq!(
        message.as_deref(),
        Some(
            format!(
                "RQ-013: no entry of the value has this handle and index: handle {handle}, index 1"
            )
            .as_str()
        )
    );
    Ok(())
}

#[test]
fn a_handle_that_the_value_did_not_give_is_a_defect() -> Result<(), String> {
    let value = unserialize(b"N;").map_err(|error| error.to_string())?;
    let message = defect(move || {
        let (_, mut children) = to_host(&value);
        drop(children.entry(Handle::new(4 * 9), 0));
    });
    assert_eq!(
        message.as_deref(),
        Some("RQ-013: no entry of the value has this handle and index: handle 36, index 0")
    );
    let value = unserialize(b"N;").map_err(|error| error.to_string())?;
    let message = defect(move || {
        let (_, mut children) = to_host(&value);
        drop(children.item(Handle::new(0), 0));
    });
    assert_eq!(
        message.as_deref(),
        Some("RQ-013: a value of PHP has no list: handle 0, index 0")
    );
    Ok(())
}
