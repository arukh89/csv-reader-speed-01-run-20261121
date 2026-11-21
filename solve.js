// solve.js — exact drop-in for make.fun csv-reader 1.0.0, indexOf/slice based.
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const start = n > 0 && text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let line = 1;
  let pos = start;

  // Monotone cursors: next occurrence at/after pos (n = none). Local to this call.
  let cPos = -1, lPos = -1, rPos = -1, qPos = -1;

  const finish = (fields, sawQuoted, rl, rr) => {
    // One empty unquoted field => no record (errors already kept).
    if (fields.length === 1 && fields[0] === "" && !sawQuoted) return;
    if (width === -1) {
      width = fields.length;
      if (header) columns = fields;
      else rows.push(fields);
      return;
    }
    if (fields.length < width) {
      errors.push({ code: "short_row", line: rl, row: rr, fields: fields.length });
      while (fields.length < width) fields.push("");
    } else if (fields.length > width) {
      errors.push({ code: "long_row", line: rl, row: rr, extra: fields.slice(width) });
      fields.length = width;
    }
    rows.push(fields);
  };

  while (pos < n) {
    if (lPos < pos) { lPos = text.indexOf("\n", pos); if (lPos < 0) lPos = n; }
    if (rPos < pos) { rPos = text.indexOf("\r", pos); if (rPos < 0) rPos = n; }
    if (qPos < pos) { qPos = text.indexOf('"', pos); if (qPos < 0) qPos = n; }

    // Fast path: line with no quote and no CR except a CRLF terminator.
    if (lPos < n && rPos >= lPos - 1 && qPos > lPos) {
      const end = rPos === lPos - 1 ? rPos : lPos;
      if (end > pos) {
        if (cPos < pos) { cPos = text.indexOf(",", pos); if (cPos < 0) cPos = n; }
        let fields;
        if (cPos >= end) {
          // Single-field line: no split machinery at all.
          fields = [text.slice(pos, end)];
        } else {
          // Split directly out of the big string: no whole-line temporary.
          fields = [];
          let s = pos, k = cPos;
          do {
            fields.push(text.slice(s, k));
            s = k + 1;
            k = text.indexOf(",", s);
            if (k < 0) k = n;
          } while (k < end);
          fields.push(text.slice(s, end));
          cPos = k; // first comma at/after end (or n); still monotone for next record
        }
        // Inline the common finalize case: exact width => just push.
        // (A nonempty fast-path line can never be the single-empty-field blank
        // record, and width === -1 never matches, so finish semantics hold.)
        if (fields.length === width) rows.push(fields);
        else finish(fields, false, line, header && width === -1 ? null : rows.length);
      }
      pos = lPos + 1;
      line++;
      continue;
    }

    // General record.
    const recLine = line;
    const recRow = header && width === -1 ? null : rows.length;
    const fields = [];
    let sawQuoted = false;
    let done = false;
    while (!done) {
      let base = "";
      let junk = false;
      if (pos < n && text.charCodeAt(pos) === 34) {
        // Find closing quote (doubled quotes are content).
        let k = text.indexOf('"', pos + 1);
        while (k !== -1 && text.charCodeAt(k + 1) === 34) k = text.indexOf('"', k + 2);
        if (k === -1) {
          errors.push({ code: "unterminated_quote", line: recLine, row: recRow });
          // Fall through: re-read unquoted starting at the literal '"'.
        } else {
          const inner = text.slice(pos + 1, k);
          let field;
          if (inner.indexOf("\r") < 0 && inner.indexOf("\n") < 0) {
            field = inner.indexOf('"') < 0 ? inner : inner.split('""').join('"');
          } else {
            let out = "", s = 0;
            for (let t = 0; t < inner.length; t++) {
              const c = inner.charCodeAt(t);
              if (c === 10) { out += inner.slice(s, t) + "\n"; s = t + 1; line++; }
              else if (c === 13) {
                out += inner.slice(s, t) + "\n";
                if (inner.charCodeAt(t + 1) === 10) t++;
                s = t + 1; line++;
              } else if (c === 34) { out += inner.slice(s, t) + '"'; t++; s = t + 1; }
            }
            field = out + inner.slice(s);
          }
          sawQuoted = true;
          pos = k + 1;
          if (pos >= n) { fields.push(field); done = true; continue; }
          const c = text.charCodeAt(pos);
          if (c === 44) { fields.push(field); pos++; continue; }
          if (c === 10) { fields.push(field); pos++; line++; done = true; continue; }
          if (c === 13 && text.charCodeAt(pos + 1) === 10) {
            fields.push(field); pos += 2; line++; done = true; continue;
          }
          base = field; junk = true; // junk runs as unquoted, appended as-is
        }
      }

      // Unquoted scan (also unterminated re-read and post-quote junk).
      let s = pos, built = null, part;
      for (;;) {
        if (cPos < pos) { cPos = text.indexOf(",", pos); if (cPos < 0) cPos = n; }
        if (lPos < pos) { lPos = text.indexOf("\n", pos); if (lPos < 0) lPos = n; }
        if (rPos < pos) { rPos = text.indexOf("\r", pos); if (rPos < 0) rPos = n; }
        let m = cPos < lPos ? cPos : lPos;
        if (rPos < m) m = rPos;

        if (m === n) { // EOF ends the record
          part = built === null ? text.slice(s, n) : built + text.slice(s, n);
          pos = n;
          if (junk && part.length > 0) errors.push({ code: "quote_junk", line: recLine, row: recRow });
          fields.push(junk ? base + part : part);
          done = true;
          break;
        }
        if (m === rPos && text.charCodeAt(m + 1) !== 10) {
          // Stray CR outside quotes: dropped, error, no line increment.
          errors.push({ code: "stray_cr", line: recLine, row: recRow });
          built = (built === null ? "" : built) + text.slice(s, m);
          pos = m + 1; s = pos;
          continue;
        }
        part = built === null ? text.slice(s, m) : built + text.slice(s, m);
        if (junk && part.length > 0) errors.push({ code: "quote_junk", line: recLine, row: recRow });
        fields.push(junk ? base + part : part);
        if (m === cPos) { pos = m + 1; }
        else if (m === lPos) { pos = m + 1; line++; done = true; }
        else { pos = m + 2; line++; done = true; } // CRLF
        break;
      }
    }
    finish(fields, sawQuoted, recLine, recRow);
  }

  if (header && width === -1) columns = [];
  return { columns, rows, errors };
}
