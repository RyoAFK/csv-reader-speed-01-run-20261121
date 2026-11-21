// Fast drop-in replacement for csv-reader 1.0.0: run(input) returns exactly the reference
// reader's {columns, rows, errors} for {text, header}, but reads with indexOf-driven jumps
// and slices instead of one character at a time.
//
// The reading policy (make.fun's own, identical to the reference):
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled, "" inside
//     it is one quote, and each CRLF or lone CR inside it is read as LF; what follows the
//     closing quote, up to the next comma or line break, is appended as it stands
//     (quote_junk, when the field ends); a quote that never closes is a literal character
//     and the text after it is read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay strings;
//   - columns is the first record when header is true, else null; rows are padded with ""
//     (short_row) or cut (long_row) to the first record's width;
//   - each error is {code, line, row}: line the 1-based line its record starts on (every
//     LF, CRLF and lone CR inside quotes counted), row its record's index in rows (null
//     for the header), in the order met.
//
// The fast paths keep two forward-only cursors (the next CR and the next LF at or after
// pos), so every character is scanned by a native indexOf only a bounded number of times.
// Rare shapes (a stray CR inside a field, line breaks inside a quoted field, junk after a
// closing quote, an unterminated quote) fall back to the plain character loops below,
// which mirror the reference one for one.

// Field endings.
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

// The reference's unquoted read, character by character: appends onto `value` up to the
// next comma or line break, dropping stray CRs (recorded). Returns
// [value, ended, pos, line, added], `added` counting the characters kept from this call.
function readUnquotedSlow(text, n, pos, line, errors, recordLine, recordRow, value) {
  let added = 0;
  while (pos < n) {
    const c = text.charCodeAt(pos);
    if (c === 44) return [value, COMMA, pos + 1, line, added];
    if (c === 10) return [value, LINE_BREAK, pos + 1, line + 1, added];
    if (c === 13) {
      if (text.charCodeAt(pos + 1) === 10) return [value, LINE_BREAK, pos + 2, line + 1, added];
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      pos += 1;
      continue;
    }
    value += text[pos];
    added += 1;
    pos += 1;
  }
  return [value, END, pos, line, added];
}

// The reference's quoted read, character by character, for a field whose quoted text
// holds a line break. Returns [value, ended, pos, line].
function readQuotedSlow(text, n, pos, line, errors, recordLine, recordRow) {
  const open = pos;
  const openLine = line;
  let value = '';
  pos += 1;
  let closed = false;
  while (pos < n) {
    const c = text.charCodeAt(pos);
    if (c === 34) {
      if (text.charCodeAt(pos + 1) === 34) {
        value += '"';
        pos += 2;
        continue;
      }
      pos += 1;
      closed = true;
      break;
    }
    if (c === 13) {
      // CRLF and a lone CR inside quotes are each one LF.
      value += '\n';
      line += 1;
      pos += text.charCodeAt(pos + 1) === 10 ? 2 : 1;
      continue;
    }
    if (c === 10) line += 1;
    value += text[pos];
    pos += 1;
  }
  if (!closed) {
    // The quote never closes: it is a literal character, and the text after it is read
    // again as unquoted.
    errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
    const r = readUnquotedSlow(text, n, open + 1, openLine, errors, recordLine, recordRow, '"');
    return [r[0], r[1], r[2], r[3]];
  }
  if (pos >= n) return [value, END, pos, line];
  const c = text.charCodeAt(pos);
  if (c === 44) return [value, COMMA, pos + 1, line];
  if (c === 10) return [value, LINE_BREAK, pos + 1, line + 1];
  if (c === 13 && text.charCodeAt(pos + 1) === 10) return [value, LINE_BREAK, pos + 2, line + 1];
  // What follows the closing quote is appended as it stands.
  const r = readUnquotedSlow(text, n, pos, line, errors, recordLine, recordRow, value);
  if (r[4] > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
  return [r[0], r[1], r[2], r[3]];
}

// A quoted field whose opening quote is at pos, read by jumping from quote to quote.
// Returns [value, ended, pos, line].
function readQuoted(text, n, pos, line, errors, recordLine, recordRow) {
  const open = pos;
  let segStart = open + 1;
  let scanPos = segStart;
  let parts = null;
  let value = '';
  let closed = false;
  while (true) {
    const q = text.indexOf('"', scanPos);
    if (q < 0) break;
    // A line break anywhere in this segment sends the field to the slow read.
    const lf = text.indexOf('\n', segStart);
    if (lf >= 0 && lf < q) return readQuotedSlow(text, n, open, line, errors, recordLine, recordRow);
    const cr = text.indexOf('\r', segStart);
    if (cr >= 0 && cr < q) return readQuotedSlow(text, n, open, line, errors, recordLine, recordRow);
    if (text.charCodeAt(q + 1) === 34) {
      // A doubled quote: one literal quote, and the field goes on.
      if (parts === null) parts = [];
      parts.push(text.slice(segStart, q), '"');
      segStart = q + 2;
      scanPos = q + 2;
      continue;
    }
    if (parts === null) value = text.slice(segStart, q);
    else {
      parts.push(text.slice(segStart, q));
      value = parts.join('');
    }
    pos = q + 1;
    closed = true;
    break;
  }
  if (!closed) {
    errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
    const r = readUnquotedSlow(text, n, open + 1, line, errors, recordLine, recordRow, '"');
    return [r[0], r[1], r[2], r[3]];
  }
  if (pos >= n) return [value, END, pos, line];
  const c = text.charCodeAt(pos);
  if (c === 44) return [value, COMMA, pos + 1, line];
  if (c === 10) return [value, LINE_BREAK, pos + 1, line + 1];
  if (c === 13 && text.charCodeAt(pos + 1) === 10) return [value, LINE_BREAK, pos + 2, line + 1];
  const r = readUnquotedSlow(text, n, pos, line, errors, recordLine, recordRow, value);
  if (r[4] > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
  return [r[0], r[1], r[2], r[3]];
}

/** csv-reader 1.0.0's answer for one case's input {text, header}, read faster. */
export function run(input) {
  const rawText = input.text;
  const text = typeof rawText === 'string' ? rawText : String(rawText);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // Forward-only cursors: the next CR / LF at or after pos (n + 1 when there is none).
  let crPos = text.indexOf('\r', pos);
  if (crPos < 0) crPos = n + 1;
  let lfPos = text.indexOf('\n', pos);
  if (lfPos < 0) lfPos = n + 1;

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;
    let fields = null;
    let lastQuoted = false;

    // Record-level fast path: no quote and no stray CR before the line's end, so the
    // record is the line, split on commas. (A quote anywhere in the line, or a CR that
    // is not the CR of the closing CRLF, sends the record to the field loop below.)
    if (crPos < pos) {
      crPos = text.indexOf('\r', pos);
      if (crPos < 0) crPos = n + 1;
    }
    if (lfPos < pos) {
      lfPos = text.indexOf('\n', pos);
      if (lfPos < 0) lfPos = n + 1;
    }
    const segEnd = lfPos <= n ? lfPos : n;
    const qPos = text.indexOf('"', pos);
    if ((qPos < 0 || qPos >= segEnd) && (crPos >= segEnd || (segEnd === lfPos && crPos === segEnd - 1))) {
      const lineEnd = segEnd === lfPos && crPos === segEnd - 1 ? segEnd - 1 : segEnd;
      fields = text.slice(pos, lineEnd).split(',');
      if (segEnd === lfPos) {
        pos = segEnd + 1;
        line += 1;
      } else {
        pos = n;
      }
    } else {
      fields = [];
      let ended = COMMA;
      do {
      lastQuoted = text.charCodeAt(pos) === 34;
      if (lastQuoted) {
        const r = readQuoted(text, n, pos, line, errors, recordLine, recordRow);
        fields.push(r[0]);
        ended = r[1];
        pos = r[2];
        line = r[3];
      } else {
        if (crPos < pos) {
          crPos = text.indexOf('\r', pos);
          if (crPos < 0) crPos = n + 1;
        }
        if (lfPos < pos) {
          lfPos = text.indexOf('\n', pos);
          if (lfPos < 0) lfPos = n + 1;
        }
        let commaPos = text.indexOf(',', pos);
        if (commaPos < 0) commaPos = n;
        const end = commaPos < lfPos ? commaPos : lfPos;
        if (crPos < end) {
          if (end === lfPos && crPos === end - 1) {
            // The field ends at a CRLF line break.
            fields.push(text.slice(pos, crPos));
            pos = end + 1;
            line += 1;
            ended = LINE_BREAK;
          } else {
            // A CR inside the field: the slow read drops it (stray_cr) or ends the
            // record, exactly as the reference does.
            const r = readUnquotedSlow(text, n, pos, line, errors, recordLine, recordRow, '');
            fields.push(r[0]);
            ended = r[1];
            pos = r[2];
            line = r[3];
          }
        } else if (end === lfPos && end < n) {
          fields.push(text.slice(pos, end));
          pos = end + 1;
          line += 1;
          ended = LINE_BREAK;
        } else if (end === commaPos && end < n) {
          fields.push(text.slice(pos, end));
          pos = end + 1;
          ended = COMMA;
        } else {
          fields.push(text.slice(pos, end));
          pos = end;
          ended = END;
        }
      }
    } while (ended === COMMA);
    }

    // A line that held only stray CRs is left with no characters: no record (its
    // stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
