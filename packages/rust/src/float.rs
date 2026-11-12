//! The text of a float and its grammar (RQ-002).

use crate::error::Error;

/// Writes the text of a float as `serialize` writes it with `serialize_precision=-1`: the shortest digits that read back as
/// the same float, in the layout of `php_gcvt` with precision 17 (RQ-002). Rust's `{:e}` gives the shortest digits.
pub(crate) fn write_float(value: f64, out: &mut Vec<u8>) -> Result<(), Error> {
    if value.is_nan() {
        out.extend_from_slice(b"NAN");
        return Ok(());
    }
    if value.is_infinite() {
        out.extend_from_slice(if value > 0.0 { b"INF" } else { b"-INF" });
        return Ok(());
    }
    if value.is_sign_negative() {
        out.push(b'-');
    }
    if value == 0.0 {
        out.push(b'0');
        return Ok(());
    }
    // ryu gives the shortest digits that read back as the float and, between two such digits at the same distance, the even
    // one, as zend_dtoa does in mode 0; the formatting of Rust's std rounds such a tie up (-98481486523842.625 gives
    // ...842.63 where PHP writes ...842.62).
    let mut buffer = ryu::Buffer::new();
    let text = buffer.format_finite(value.abs());
    let (mantissa, power) = match text.split_once('e') {
        Some((mantissa, power)) => match power.parse::<i64>() {
            Ok(power) => (mantissa, power),
            Err(_) => {
                return Err(Error::Internal {
                    what: "the exponent of a float is no integer",
                })
            }
        },
        None => (text, 0),
    };
    let (whole, fraction) = match mantissa.split_once('.') {
        Some(parts) => parts,
        None => (mantissa, ""),
    };
    let Ok(whole_length) = i64::try_from(whole.len()) else {
        return Err(Error::Internal {
            what: "the digits of a float exceed i64",
        });
    };
    // The position of the decimal point after the first digits, as zend_dtoa returns it.
    let mut point = whole_length + power;
    let mut digits: Vec<u8> = whole.bytes().chain(fraction.bytes()).collect();
    while digits.first() == Some(&b'0') {
        digits.remove(0);
        point -= 1;
    }
    while digits.last() == Some(&b'0') {
        digits.pop();
    }
    let power = point - 1;
    let Some((first, rest)) = digits.split_first() else {
        return Err(Error::Internal {
            what: "a float other than zero has no digit",
        });
    };
    if !(-3..=17).contains(&point) {
        out.push(*first);
        out.push(b'.');
        if rest.is_empty() {
            out.push(b'0');
        } else {
            out.extend_from_slice(rest);
        }
        out.extend_from_slice(
            format!(
                "E{}{}",
                if power >= 0 { '+' } else { '-' },
                power.unsigned_abs()
            )
            .as_bytes(),
        );
        return Ok(());
    }
    if point <= 0 {
        // -3 <= point <= 0: zeros after the decimal point, then the digits.
        out.extend_from_slice(b"0.");
        for _ in point..0 {
            out.push(b'0');
        }
        out.extend_from_slice(&digits);
        return Ok(());
    }
    let Ok(point) = usize::try_from(point) else {
        return Err(Error::Internal {
            what: "a positive point is no usize",
        });
    };
    if digits.len() <= point {
        out.extend_from_slice(&digits);
        out.extend(std::iter::repeat_n(b'0', point - digits.len()));
    } else {
        let (whole, fraction) = digits.split_at(point);
        out.extend_from_slice(whole);
        out.push(b'.');
        out.extend_from_slice(fraction);
    }
    Ok(())
}

/// Scans the text of a float at `at` by the grammar that unserialize reads: `NAN`, `INF`, `-INF`, or an optional sign,
/// digits with an optional decimal point and at least one digit, and an optional exponent. Returns the end of the text,
/// or the offset of the first byte that breaks the grammar (RQ-010).
pub(crate) fn scan_float(data: &[u8], at: usize) -> Result<usize, usize> {
    let rest = data.get(at..).ok_or(at)?;
    for word in [&b"NAN"[..], b"INF", b"-INF"] {
        if rest.starts_with(word) {
            return Ok(at + word.len());
        }
    }
    let mut end = at;
    let byte = |position: usize| data.get(position).copied();
    if matches!(byte(end), Some(b'+' | b'-')) {
        end += 1;
    }
    let mut digits = 0;
    while matches!(byte(end), Some(b'0'..=b'9')) {
        end += 1;
        digits += 1;
    }
    if byte(end) == Some(b'.') {
        end += 1;
        while matches!(byte(end), Some(b'0'..=b'9')) {
            end += 1;
            digits += 1;
        }
    }
    if digits == 0 {
        return Err(end);
    }
    if matches!(byte(end), Some(b'e' | b'E')) {
        end += 1;
        if matches!(byte(end), Some(b'+' | b'-')) {
            end += 1;
        }
        let start = end;
        while matches!(byte(end), Some(b'0'..=b'9')) {
            end += 1;
        }
        if end == start {
            return Err(end);
        }
    }
    Ok(end)
}

/// Returns the float of a text that [`scan_float`] accepted; the parse of Rust rounds correctly, as zend_strtod does.
pub(crate) fn parse_float(text: &[u8]) -> Result<f64, Error> {
    match text {
        b"NAN" => return Ok(f64::NAN),
        b"INF" => return Ok(f64::INFINITY),
        b"-INF" => return Ok(f64::NEG_INFINITY),
        _ => {}
    }
    let Ok(text) = std::str::from_utf8(text) else {
        return Err(Error::Internal {
            what: "the scanned text of a float is not ASCII",
        });
    };
    match text.parse::<f64>() {
        Ok(value) => Ok(value),
        Err(_) => Err(Error::Internal {
            what: "the parse of Rust refuses the scanned text of a float",
        }),
    }
}
