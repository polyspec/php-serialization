//! The errors of the crate: every failure has a kind of the table of kinds of the specification (RQ-010).

use std::fmt;

// RQ-010: an offset is a position of the input, given out as u64; a usize of every target that the crate builds for fits.
const _: () = assert!(usize::BITS <= u64::BITS);

/// Returns a position of the input as an offset (RQ-010).
#[allow(
    clippy::cast_possible_truncation,
    reason = "RQ-010: the assertion above proves that a usize fits in a u64"
)]
pub(crate) const fn offset(at: usize) -> u64 {
    at as u64
}

/// A failure of unserialize, serialize or the building of a value. The kind and its rule are in the table of kinds of
/// `docs/spec/php-serialize.md`; a caller tells failures apart by [`Error::kind`], never by the message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    /// The bytes break the grammar, a length or a count is larger than the bytes that remain, or the input ends early
    /// (RQ-006, RQ-007). `expected` names what the grammar allows at the offset.
    Syntax { offset: u64, expected: &'static str },
    /// A value is nested deeper than [`crate::DEPTH_LIMIT`]: in the input (with its offset) or in a value to write.
    Depth { offset: Option<u64> },
    /// `R:` or `r:` names no slot, `R:` names its own position, or `r:` names no object (RQ-005).
    Reference { offset: u64 },
    /// An integer is outside 64 bits: in the input (with its offset, refused on purpose) or in a value of a language
    /// (RQ-012).
    IntRange { offset: Option<u64> },
    /// Bytes follow the value (refused on purpose).
    TrailingData { offset: u64 },
    /// An object of a class other than `stdClass`, or `C:` or `E:` (refused on purpose).
    Class { offset: u64 },
    /// `R:` names the top array (refused on purpose).
    TopArrayReference { offset: u64 },
    /// A property name starts with U+0000: in the input (with its offset) or in a value being built (RQ-009).
    PropertyName { offset: Option<u64> },
    /// A value being built puts an array that a position holds into another position (RQ-008).
    ArrayHeld,
    /// A value being built puts a reference into a reference (RQ-008).
    NestedReference,
    /// A value being built takes a reference as its top value (RQ-008).
    TopReference,
    /// A value being built is given the identity of an array, an object or a reference that it does not hold (RQ-008).
    UnknownId,
    /// A value of a language is no value of PHP: one that the value table does not name, a key that is neither an
    /// integer nor a string, a property name that is no string, or an array that holds itself (RQ-012).
    UnsupportedValue,
    /// A text of a language has an unpaired surrogate, which UTF-8 cannot hold (RQ-003, RQ-012).
    InvalidText,
    /// An invariant of the implementation fails; it is a defect (RQ-010).
    Internal { what: &'static str },
}

impl Error {
    /// The kind: a fixed text of the table of kinds (RQ-010).
    #[must_use]
    pub const fn kind(&self) -> &'static str {
        match self {
            Self::Syntax { .. } => "syntax",
            Self::Depth { .. } => "depth",
            Self::Reference { .. } => "reference",
            Self::IntRange { .. } => "int_range",
            Self::TrailingData { .. } => "trailing_data",
            Self::Class { .. } => "class",
            Self::TopArrayReference { .. } => "top_array_reference",
            Self::PropertyName { .. } => "property_name",
            Self::ArrayHeld => "array_held",
            Self::NestedReference => "nested_reference",
            Self::TopReference => "top_reference",
            Self::UnknownId => "unknown_id",
            Self::UnsupportedValue => "unsupported_value",
            Self::InvalidText => "invalid_text",
            Self::Internal { .. } => "internal",
        }
    }

    /// The offset in the input of a failure of unserialize, counted in bytes from 0 (RQ-010); a failure of serialize or of
    /// the building of a value has none.
    #[must_use]
    pub const fn offset(&self) -> Option<u64> {
        match self {
            Self::Syntax { offset, .. }
            | Self::Reference { offset }
            | Self::TrailingData { offset }
            | Self::Class { offset }
            | Self::TopArrayReference { offset } => Some(*offset),
            Self::Depth { offset } | Self::PropertyName { offset } | Self::IntRange { offset } => {
                *offset
            }
            Self::ArrayHeld
            | Self::NestedReference
            | Self::TopReference
            | Self::UnknownId
            | Self::UnsupportedValue
            | Self::InvalidText
            | Self::Internal { .. } => None,
        }
    }

    /// The HTTP status: none, as the format is no protocol (RQ-010).
    #[must_use]
    pub const fn status(&self) -> Option<u16> {
        None
    }
}

/// The kind interface that the generated bindings read (binding design E-1, I-2 (3)).
impl binding_core::Kinds for Error {
    fn kind(&self) -> &'static str {
        Error::kind(self)
    }

    fn status(&self) -> Option<u16> {
        Error::status(self)
    }

    fn errno(&self) -> Option<i32> {
        None
    }
}

impl fmt::Display for Error {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let text = match self {
            Self::Syntax { expected, .. } => {
                return write!(
                    formatter,
                    "the input breaks the grammar of serialize, which expects {expected}{}",
                    At(self.offset())
                );
            }
            Self::Depth { .. } => "the value is nested deeper than 4096",
            Self::Reference { .. } => "the reference names no value that it may name",
            Self::IntRange { .. } => "the integer is outside 64 bits",
            Self::TrailingData { .. } => "bytes follow the value",
            Self::Class { .. } => "only objects of stdClass are read",
            Self::TopArrayReference { .. } => "the reference names the top array",
            Self::PropertyName { .. } => "a property name starts with U+0000",
            Self::ArrayHeld => "the array is held by another position",
            Self::NestedReference => "a reference holds no reference",
            Self::TopReference => "the top value is no reference",
            Self::UnknownId => "the value holds no such array, object or reference",
            Self::UnsupportedValue => "the value of the language is no value of PHP",
            Self::InvalidText => "the text has an unpaired surrogate",
            Self::Internal { what } => return write!(formatter, "internal error: {what}"),
        };
        write!(formatter, "{text}{}", At(self.offset()))
    }
}

/// The text " at offset N" of an offset, or nothing.
struct At(Option<u64>);

impl fmt::Display for At {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.0 {
            Some(offset) => write!(formatter, " at offset {offset}"),
            None => Ok(()),
        }
    }
}

impl std::error::Error for Error {}
