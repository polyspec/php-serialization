//! The serialize format of PHP: its values ([`PhpValue`], RQ-008), [`unserialize`] and [`serialize`], byte for byte as PHP
//! (`docs/spec/php-serialize.md`). Every failure is an [`Error`] with a kind (RQ-010). Neither direction recurses (RQ-006).
#![forbid(unsafe_code)]

mod error;
mod float;
mod read;
mod value;
mod write;

pub use error::Error;
pub use read::unserialize;
pub use value::{
    ArrayId, Key, Node, ObjectId, PhpArray, PhpFloat, PhpValue, ReferenceId, StdClass,
};
pub use write::serialize;

/// The depth that unserialize reads and serialize writes, as `unserialize_max_depth` of PHP (RQ-006). It is a `u64`, the
/// type of `uint` in the interface contract.
pub const DEPTH_LIMIT: u64 = 4096;

/// Whether a stack of `depth` open containers has reached [`DEPTH_LIMIT`] (RQ-006). A depth that `u64` cannot hold is past
/// the limit.
pub(crate) fn at_depth_limit(depth: usize) -> bool {
    match u64::try_from(depth) {
        Ok(depth) => depth >= DEPTH_LIMIT,
        Err(_) => true,
    }
}

#[cfg(test)]
mod tests {
    use super::{PhpValue, StdClass};

    // B-6: a binding wraps these types, so their alignment is at most 16 bytes.
    const _: () = assert!(std::mem::align_of::<PhpValue>() <= 16);
    const _: () = assert!(std::mem::align_of::<StdClass>() <= 16);

    // B-5b: the types of the core are Send and Sync.
    const fn send_sync<T: Send + Sync>() {}
    const _: () = send_sync::<PhpValue>();
    const _: () = send_sync::<super::PhpFloat>();
    const _: () = send_sync::<super::Error>();
}
