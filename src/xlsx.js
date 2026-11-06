// 최소 xlsx 쓰기·읽기 (외부 라이브러리 없음). 쓰기는 무압축 zip, 읽기는 엑셀이 다시 저장한 압축(deflate) 파일도 지원.
// 셀 값: 문자열 | 숫자 | null | { v, s }  — s: 'time'(h:mm) 'dur'([h]:mm) 'b'(굵게) 'won'(#,##0)
var XLSX_MIN = (function () {
  const enc = (s) => new TextEncoder().encode(s);
  const xesc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const unesc = (s) => s.replace(/&(lt|gt|quot|apos|amp|#x?[0-9a-fA-F]+);/g, (_, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }[e]);
  const attr = (s, name) => { const m = s.match(new RegExp('\\s' + name + '="([^"]*)"')); return m ? m[1] : null; };
  const colName = (i) => { let s = ''; for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };

  const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const concat = (arr) => { const out = new Uint8Array(arr.reduce((a, b) => a + b.length, 0)); let o = 0; for (const a of arr) { out.set(a, o); o += a.length; } return out; };

  // deflate: (Uint8Array) => Uint8Array 를 주면 압축(테스트용), 없으면 무압축
  function zip(files, deflate) {
    const parts = [], central = []; let off = 0;
    for (const f of files) {
      const name = enc(f.name), crc = crc32(f.data), comp = deflate ? deflate(f.data) : f.data, method = deflate ? 8 : 0;
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, method, true);
      h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, comp.length, true); h.setUint32(22, f.data.length, true);
      h.setUint16(26, name.length, true);
      parts.push(new Uint8Array(h.buffer), name, comp);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, method, true);
      c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, comp.length, true); c.setUint32(24, f.data.length, true);
      c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + comp.length;
    }
    const cd = concat(central), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cd.length, true); e.setUint32(16, off, true);
    return concat([...parts, cd, new Uint8Array(e.buffer)]);
  }

  const STYLE = { time: 1, dur: 2, b: 3, won: 4 };
  const NS = 'http://schemas.openxmlformats.org/';
  function sheetXml(sh) {
    const rows = sh.rows.map((r, ri) => `<row r="${ri + 1}">` + (r || []).map((c, ci) => {
      if (c == null || c === '') return '';
      const o = typeof c === 'object' ? c : { v: c }, ref = colName(ci) + (ri + 1), s = o.s ? ` s="${STYLE[o.s]}"` : '';
      return typeof o.v === 'number' ? `<c r="${ref}"${s}><v>${o.v}</v></c>` : `<c r="${ref}"${s} t="inlineStr"><is><t>${xesc(o.v)}</t></is></c>`;
    }).join('') + '</row>').join('');
    const cols = sh.cols ? '<cols>' + sh.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>' : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}spreadsheetml/2006/main">${cols}<sheetData>${rows}</sheetData></worksheet>`;
  }
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${NS}spreadsheetml/2006/main">` +
    '<numFmts count="2"><numFmt numFmtId="164" formatCode="h:mm"/><numFmt numFmtId="165" formatCode="[h]:mm"/></numFmts>' +
    '<fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><name val="맑은 고딕"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  // sheets: [{ name, rows: [[셀...]], cols?: [너비...] }] → Uint8Array(.xlsx)
  function write(sheets, deflate) {
    const ct = 'application/vnd.openxmlformats-officedocument.';
    const files = [
      { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${NS}package/2006/content-types">` +
        `<Default Extension="rels" ContentType="${ct}package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="${ct}spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="${ct}spreadsheetml.styles+xml"/>` +
        sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${ct}spreadsheetml.worksheet+xml"/>`).join('') + '</Types>' },
      { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS}package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${NS}officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${NS}spreadsheetml/2006/main" xmlns:r="${NS}officeDocument/2006/relationships"><sheets>` +
        sheets.map((s, i) => `<sheet name="${xesc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS}package/2006/relationships">` +
        sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS}officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="${NS}officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/styles.xml', data: STYLES },
      ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
    ];
    return zip(files.map((f) => ({ name: f.name, data: enc(f.data) })), deflate);
  }

  // inflateRaw: async (Uint8Array) => Uint8Array  (브라우저는 DecompressionStream, Node는 zlib)
  async function unzip(u8, inflateRaw) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), dec = new TextDecoder(), out = {};
    let e = u8.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('엑셀(xlsx) 파일이 아닙니다');
    let p = dv.getUint32(e + 16, true);
    for (let i = dv.getUint16(e + 10, true); i > 0; i--) {
      const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), lo = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
      const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true), raw = u8.subarray(start, start + size);
      if (/\.(xml|rels)$/.test(name)) out[name] = method === 0 ? raw : method === 8 ? await inflateRaw(raw) : null;
      p += 46 + nl + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
    }
    return out;
  }
  const texts = (s) => [...s.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unesc(m[1])).join('');
  function parseSheet(xml, ss) {
    const rows = [];
    for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(m[1], 'r'), t = attr(m[1], 't'), body = m[2] || '';
      if (!ref) continue;
      let v;
      if (t === 'inlineStr') v = texts(body);
      else {
        const vm = body.match(/<v>([\s\S]*?)<\/v>/); if (!vm) continue;
        v = t === 's' ? ss[+vm[1]] : t === 'str' || t === 'e' ? unesc(vm[1]) : t === 'b' ? vm[1] === '1' : +vm[1];
      }
      const [, cs, rs] = ref.match(/^([A-Z]+)(\d+)$/);
      let c = 0; for (const ch of cs) c = c * 26 + ch.charCodeAt(0) - 64;
      (rows[+rs - 1] = rows[+rs - 1] || [])[c - 1] = v;
    }
    return rows;
  }
  // → { 시트이름: [[값...]] }  (값: 문자열 | 숫자 | 불리언, 빈 칸은 undefined)
  async function read(u8, inflateRaw) {
    const files = await unzip(u8, inflateRaw), txt = (n) => (files[n] ? new TextDecoder().decode(files[n]) : '');
    const ss = [...txt('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
    const rels = {};
    for (const [tag] of txt('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)) {
      const t = attr(tag, 'Target'); rels[attr(tag, 'Id')] = t.startsWith('/') ? t.slice(1) : 'xl/' + t;
    }
    const sheets = {};
    for (const [tag] of txt('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)) sheets[unesc(attr(tag, 'name'))] = parseSheet(txt(rels[attr(tag, 'r:id')]), ss);
    return sheets;
  }

  return { write, read };
})();
if (typeof module !== 'undefined') module.exports = XLSX_MIN;
