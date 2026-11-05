//! Browser-only adapter for the same Calamine version as the unchanged desktop sidecar.
//! The ABI has no filesystem, network or WASI services. Unused wasm-bindgen
//! descriptor imports fail closed in the browser host. Linear memory is capped
//! at 256 MiB by the checked-in target configuration.

use calamine::{Data, Reader, Sheets, open_workbook_auto_from_rs};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::io::Cursor;

#[derive(Serialize)]
struct Sheet {
    name: String,
    xml: String,
}

fn convert(bytes: &[u8]) -> Result<Vec<Sheet>, String> {
    if bytes.len() > 32 * 1024 * 1024 {
        return Err("Legacy input exceeds 32 MiB.".into());
    }
    let mut workbook =
        open_workbook_auto_from_rs(Cursor::new(bytes)).map_err(|error| error.to_string())?;
    let names = workbook.sheet_names().to_vec();
    if names.is_empty() || names.len() > 128 {
        return Err("Legacy workbook must contain 1–128 sheets.".into());
    }
    let mut output = Vec::new();
    let mut cells = 0usize;
    let mut output_bytes = 0usize;
    for name in names {
        let values = workbook
            .worksheet_range(&name)
            .map_err(|error| format!("{name}: {error}"))?;
        let formulas = workbook
            .worksheet_formula(&name)
            .map_err(|error| format!("{name} formulas: {error}"))?;
        let (start_row, start_column) = formulas.start().unwrap_or((0, 0));
        let mut formula_map = HashMap::new();
        for (row, column, formula) in formulas.used_cells() {
            if formula.len() > 8192 {
                return Err("A legacy formula exceeds 8192 characters.".into());
            }
            if !formula.is_empty() {
                formula_map.insert(
                    (start_row + row as u32, start_column + column as u32),
                    formula.clone(),
                );
            }
        }
        let (start_row, start_column) = values.start().unwrap_or((0, 0));
        let mut rows: BTreeMap<u32, BTreeMap<u32, String>> = BTreeMap::new();
        let mut max_row = 0;
        let mut max_column = 0;
        for (row, column, value) in values.used_cells() {
            let position = (start_row + row as u32, start_column + column as u32);
            let xml = cell_xml(position, value, formula_map.remove(&position).as_deref())?;
            output_bytes += xml.len();
            cells += 1;
            if cells > 100_000 || output_bytes > 12 * 1024 * 1024 {
                return Err("Legacy import exceeds the iPad cell/XML limit.".into());
            }
            max_row = max_row.max(position.0);
            max_column = max_column.max(position.1);
            rows.entry(position.0).or_default().insert(position.1, xml);
        }
        for (position, formula) in formula_map {
            let xml = cell_xml(position, &Data::Empty, Some(&formula))?;
            output_bytes += xml.len();
            cells += 1;
            if cells > 100_000 || output_bytes > 12 * 1024 * 1024 {
                return Err("Legacy import exceeds the iPad cell/XML limit.".into());
            }
            max_row = max_row.max(position.0);
            max_column = max_column.max(position.1);
            rows.entry(position.0).or_default().insert(position.1, xml);
        }
        let data: String = rows
            .into_iter()
            .map(|(row, cells)| {
                format!(
                    "<row r=\"{}\">{}</row>",
                    row + 1,
                    cells.into_values().collect::<String>()
                )
            })
            .collect();
        let merges = if let Sheets::Xls(reader) = &mut workbook {
            let ranges = reader
                .merge_cells_by_sheet_name(&name)
                .map_err(|error| error.to_string())?;
            let body: String = ranges
                .iter()
                .map(|range| {
                    format!(
                        "<mergeCell ref=\"{}:{}\"/>",
                        cell_reference(range.start.0, range.start.1),
                        cell_reference(range.end.0, range.end.1)
                    )
                })
                .collect();
            if ranges.is_empty() {
                String::new()
            } else {
                format!("<mergeCells count=\"{}\">{body}</mergeCells>", ranges.len())
            }
        } else {
            String::new()
        };
        let dimension = format!("A1:{}", cell_reference(max_row, max_column));
        output.push(Sheet{name,xml:format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?><worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><dimension ref=\"{dimension}\"/><sheetData>{data}</sheetData>{merges}</worksheet>")});
    }
    Ok(output)
}

fn cell_xml(position: (u32, u32), value: &Data, formula: Option<&str>) -> Result<String, String> {
    if position.0 >= 1_048_576 || position.1 >= 16_384 {
        return Err("Legacy cell is outside XLSX bounds.".into());
    }
    let reference = cell_reference(position.0, position.1);
    let f = formula
        .map(|text| format!("<f>{}</f>", escape_xml(text.trim_start_matches('='))))
        .unwrap_or_default();
    let numeric = |number: f64, date: bool| -> Result<String, String> {
        if !number.is_finite() {
            return Err("Legacy workbook contains a non-finite number.".into());
        }
        let style = if date {
            if number.fract() == 0.0 {
                " s=\"1\""
            } else {
                " s=\"2\""
            }
        } else {
            ""
        };
        Ok(format!(
            "<c r=\"{reference}\"{style}>{f}<v>{number}</v></c>"
        ))
    };
    let text = |text: &str| -> Result<String, String> {
        if text.encode_utf16().count() > 32767 {
            return Err("A legacy cell exceeds the text limit.".into());
        }
        let text = escape_cell_text(text);
        if formula.is_some() {
            Ok(format!(
                "<c r=\"{reference}\" t=\"str\">{f}<v>{text}</v></c>"
            ))
        } else {
            Ok(format!(
                "<c r=\"{reference}\" t=\"inlineStr\"><is><t xml:space=\"preserve\">{text}</t></is></c>"
            ))
        }
    };
    match value {
        Data::Empty => Ok(format!("<c r=\"{reference}\">{f}</c>")),
        Data::String(value) => text(value),
        Data::Float(value) => numeric(*value, false),
        Data::Int(value) => Ok(format!("<c r=\"{reference}\">{f}<v>{value}</v></c>")),
        Data::Bool(value) => Ok(format!(
            "<c r=\"{reference}\" t=\"b\">{f}<v>{}</v></c>",
            u8::from(*value)
        )),
        Data::DateTime(value) => numeric(normalized_date(*value)?, true),
        Data::DateTimeIso(value) => match iso_serial(value) {
            Some(serial) => numeric(serial, true),
            None => text(value),
        },
        Data::DurationIso(value) => text(value),
        Data::Error(value) => Ok(format!(
            "<c r=\"{reference}\" t=\"e\">{f}<v>{}</v></c>",
            escape_xml(&value.to_string())
        )),
    }
}

fn normalized_date(value: calamine::ExcelDateTime) -> Result<f64, String> {
    let raw = value.as_f64();
    if value.is_duration() {
        return Ok(raw);
    }
    // Calamine keeps the source epoch private but exposes its calendar conversion.
    // Compare the same raw serial interpreted explicitly as 1900 to detect 1904.
    if !raw.is_finite() || !(0.0..=2_957_003.0).contains(&raw) {
        return Err("Legacy date is outside the safely convertible range.".into());
    }
    let standard = calamine::ExcelDateTime::new(raw, calamine::ExcelDateTimeType::DateTime, false);
    Ok(if value.to_ymd_hms_milli() != standard.to_ymd_hms_milli() {
        raw + 1462.0
    } else {
        raw
    })
}

fn escape_cell_text(text: &str) -> String {
    let mut output = String::new();
    let mut chars = text.chars().peekable();
    while let Some(character) = chars.next() {
        if character == '_' {
            let tail: String = chars.clone().take(6).collect();
            if tail.len() == 6
                && tail.starts_with('x')
                && tail.ends_with('_')
                && tail[1..5].bytes().all(|byte| byte.is_ascii_hexdigit())
            {
                output.push_str("_x005F_");
                continue;
            }
        }
        if (character <= '\u{1f}' && !matches!(character, '\t' | '\n'))
            || matches!(character, '\u{fffe}' | '\u{ffff}')
        {
            output.push_str(&format!("_x{:04X}_", character as u32));
        } else {
            output.push(character);
        }
    }
    escape_xml(&output)
}

#[unsafe(no_mangle)]
pub extern "C" fn alloc(length: u32) -> u32 {
    Box::into_raw(vec![0u8; length as usize].into_boxed_slice()) as *mut u8 as u32
}

/// Returns pointer in the upper 32 bits and byte length in the lower 32 bits.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn convert_workbook(pointer: u32, length: u32) -> u64 {
    let bytes = unsafe { std::slice::from_raw_parts(pointer as *const u8, length as usize) };
    let json = serde_json::to_vec(&convert(bytes)).expect("Import result serializes");
    let length = json.len() as u32;
    let pointer = Box::into_raw(json.into_boxed_slice()) as *mut u8 as u32;
    ((pointer as u64) << 32) | length as u64
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn release(pointer: u32, length: u32) {
    unsafe {
        drop(Box::from_raw(std::slice::from_raw_parts_mut(
            pointer as *mut u8,
            length as usize,
        )))
    }
}

// Date/coordinate helpers retained from the desktop xlsx_package module.
pub(crate) fn cell_reference(row: u32, column: u32) -> String {
    let mut letters = String::new();
    let mut remaining = column + 1;
    while remaining > 0 {
        remaining -= 1;
        letters.insert(0, char::from(b'A' + (remaining % 26) as u8));
        remaining /= 26;
    }
    format!("{letters}{}", row + 1)
}

/// The locked spelling, for a reference the source marked absolute. R1C1's
pub(crate) fn escape_xml(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Excel serial for an ISO date (`2026-03-05`, optionally followed by `T10:20:30`
/// and a fraction). `None` keeps the cell a string instead of guessing —
/// including below 1900-03-01, where Excel's phantom 1900 leap day makes a
/// computed serial one too low.
pub(crate) fn iso_serial(text: &str) -> Option<f64> {
    let (date, time) = match text.split_once('T') {
        Some((date, time)) => (date, Some(time)),
        None => (text, None),
    };
    let mut fields = date.split('-');
    let year: i64 = fields.next()?.parse().ok()?;
    let month: i64 = fields.next()?.parse().ok()?;
    let day: i64 = fields.next()?.parse().ok()?;
    if fields.next().is_some()
        || !(1900..=9999).contains(&year)
        || !(1..=12).contains(&month)
        || day < 1
        || day > i64::from(days_in_month(year, month))
    {
        return None;
    }
    // Serial 1 is 1900-01-01 for Excel's own arithmetic, but the 1900-02-29 it
    // never had puts every later date one above the plain day count, which the
    // 1899-12-30 epoch absorbs.
    let mut serial = (days_from_civil(year, month, day) - days_from_civil(1899, 12, 30)) as f64;
    if let Some(time) = time {
        let mut parts = time.split(':');
        let hours: f64 = unsigned_number(parts.next()?)?;
        let minutes: f64 = unsigned_number(parts.next()?)?;
        let seconds_text = parts.next()?;
        if parts.next().is_some() {
            return None;
        }
        let (whole, fraction) = match seconds_text.split_once('.') {
            Some((whole, fraction)) => (
                unsigned_number(whole)?,
                unsigned_number(fraction)? / 10f64.powi(fraction.chars().count() as i32),
            ),
            None => (unsigned_number(seconds_text)?, 0.0),
        };
        if hours > 23.0 || minutes > 59.0 || whole > 60.0 {
            return None;
        }
        serial += (hours * 3600.0 + minutes * 60.0 + whole + fraction) / 86_400.0;
    }
    if serial < 61.0 || serial > 2_958_465.0 {
        return None;
    }
    Some(serial)
}

/// Digits only, no sign and no exponent: `"05"` parses to 5 while `"+5"`,
/// `"1e3"` and `"30Z"` are refused.
fn unsigned_number(text: &str) -> Option<f64> {
    if text.is_empty() || !text.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    text.parse().ok()
}

fn days_in_month(year: i64, month: i64) -> u32 {
    const LENGTHS: [u32; 12] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let leap = month == 2 && (year % 4 == 0 && (year % 100 != 0 || year % 400 == 0));
    if leap {
        29
    } else {
        LENGTHS[(month - 1) as usize]
    }
}

/// Days from the civil calendar epoch 1970-01-01 (Howard Hinnant's algorithm).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let shifted = if month <= 2 { year - 1 } else { year };
    let era = if shifted >= 0 { shifted } else { shifted - 399 } / 400;
    let year_of_era = shifted - era * 400;
    let day_of_year = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_formula_cells_and_reads_real_ods_dates() {
        let sheets = convert(include_bytes!("../../../tests/fixtures/formulas.xls")).unwrap();
        assert!(sheets.iter().any(|sheet| sheet.xml.contains("<f>")));
        let dates = convert(include_bytes!("../../../tests/fixtures/dates.ods")).unwrap();
        assert!(
            dates
                .iter()
                .any(|sheet| sheet.xml.contains("s=\"1\"") || sheet.xml.contains("s=\"2\""))
        );
    }

    #[test]
    fn typed_values_and_invalid_inputs_are_explicit() {
        assert!(convert(b"not a spreadsheet").is_err());
        assert_eq!(iso_serial("2024-01-01"), Some(45292.0));
        let mac_date =
            calamine::ExcelDateTime::new(43830.5, calamine::ExcelDateTimeType::DateTime, true);
        assert_eq!(normalized_date(mac_date), Ok(45292.5));
        assert!(cell_xml((0, 0), &Data::Float(f64::NAN), None).is_err());
        assert_eq!(
            escape_cell_text("_x0041_\r\n🌱"),
            "_x005F_x0041__x000D_\n🌱"
        );
        let boolean = cell_xml((0, 0), &Data::Bool(true), Some("1=1")).unwrap();
        assert!(boolean.contains("t=\"b\"><f>1=1</f><v>1</v>"));
    }
}
