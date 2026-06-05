import fs from 'node:fs';
import path from 'node:path';

const outPath = path.resolve('HRMS_Project_Final_Gap_Analysis.docx');

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
    crc32.table = table;
  }
  let c = 0xffffffff;
  for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: dosDate };
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
}

function makeZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const stamp = dosDateTime();

  for (const [name, content] of files) {
    const nameBuf = Buffer.from(name);
    const data = Buffer.from(content, 'utf8');
    const crc = crc32(data);

    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(stamp.time), u16(stamp.date),
      u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0), nameBuf, data,
    ]);
    localParts.push(local);

    centralParts.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(stamp.time), u16(stamp.date),
      u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), nameBuf,
    ]));
    offset += local.length;
  }

  const central = Buffer.concat(centralParts);
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(central.length), u32(offset), u16(0),
  ]);
  return Buffer.concat([...localParts, central, end]);
}

function p(text, style = 'BodyText') {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p>`;
}

function heading(text, level = 1) {
  return p(text, `Heading${level}`);
}

function bullet(text) {
  return `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p>`;
}

function check(text) {
  return `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p>`;
}

function cell(text, width, fill = null, bold = false) {
  const fillXml = fill ? `<w:shd w:val="clear" w:fill="${fill}"/>` : '';
  const boldXml = bold ? '<w:b/>' : '';
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${fillXml}<w:tcMar><w:top w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tcMar></w:tcPr><w:p><w:pPr><w:spacing w:after="60" w:line="264" w:lineRule="auto"/></w:pPr><w:r><w:rPr>${boldXml}</w:rPr><w:t>${escapeXml(text)}</w:t></w:r></w:p></w:tc>`;
}

function table(rows, widths) {
  const grid = widths.map(w => `<w:gridCol w:w="${w}"/>`).join('');
  const body = rows.map((row, rowIndex) => `<w:tr>${row.map((text, i) => cell(text, widths[i], rowIndex === 0 ? 'F2F4F7' : null, rowIndex === 0)).join('')}</w:tr>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblInd w:w="120" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="D9E2EC"/><w:left w:val="single" w:sz="4" w:color="D9E2EC"/><w:bottom w:val="single" w:sz="4" w:color="D9E2EC"/><w:right w:val="single" w:sz="4" w:color="D9E2EC"/><w:insideH w:val="single" w:sz="4" w:color="D9E2EC"/><w:insideV w:val="single" w:sz="4" w:color="D9E2EC"/></w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl>`;
}

function callout(title, text) {
  return `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblInd w:w="120" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="6" w:color="A9BCD4"/><w:left w:val="single" w:sz="6" w:color="A9BCD4"/><w:bottom w:val="single" w:sz="6" w:color="A9BCD4"/><w:right w:val="single" w:sz="6" w:color="A9BCD4"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="9360"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="9360" w:type="dxa"/><w:shd w:val="clear" w:fill="F4F6F9"/><w:tcMar><w:top w:w="160" w:type="dxa"/><w:bottom w:w="160" w:type="dxa"/><w:left w:w="180" w:type="dxa"/><w:right w:w="180" w:type="dxa"/></w:tcMar></w:tcPr><w:p><w:r><w:rPr><w:b/><w:color w:val="1F4D78"/></w:rPr><w:t>${escapeXml(title)}</w:t></w:r></w:p><w:p><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
}

const criticalRows = [
  ['Gap', 'Why It Matters', 'First Fix'],
  ['Secrets in .env.local', 'Database, JWT, and seed admin credentials are exposed in local project config.', 'Rotate all credentials and keep only .env.example in shared project copies.'],
  ['Unauthenticated seed route', 'The first super admin can be created by calling /api/seed.', 'Remove it after setup or protect it with a one-time setup token disabled in production.'],
  ['Settings API authorization', 'Any authenticated user can mutate departments, shifts, holidays, and config.', 'Restrict POST/PUT/DELETE to super_admin/admin_full or settings:update permission.'],
  ['Weak session model', 'Refresh tokens are bearer tokens with no server-side revocation or session tracking.', 'Add sessions, token IDs, revocation, short access-token TTL, and secure storage.'],
  ['RBAC mismatch', 'Client and server permission matrices differ, increasing confusion and bypass risk.', 'Use one canonical server RBAC source and expose a safe client projection.'],
  ['Mass assignment', 'Several routes pass request bodies directly into create/update operations.', 'Add schema validation and explicit allowlists per route.'],
];

const roadmapRows = [
  ['Priority', 'Fix Area', 'Outcome'],
  ['0', 'Secrets, seed route, settings authorization, token/session hardening', 'Immediate security baseline'],
  ['1', 'Centralized permission helper, API validation, audit helper', 'Consistent access control and traceability'],
  ['2', 'Employee lifecycle, org hierarchy, intern lifecycle, document security', 'HR core becomes operationally reliable'],
  ['3', 'Shift-based attendance, leave ledger, attendance lock, payroll rebuild', 'Payroll and attendance become calculation-safe'],
  ['4', 'Payslips, notifications, reports, timecards, task approvals, KPI engine', 'Workflow completion and enterprise visibility'],
  ['5', 'Tests, CI/CD, monitoring, backup/restore, deployment guide', 'Production readiness'],
];

const body = [
  `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>HRMS 2.0 Final Gap Analysis and Fix Plan</w:t></w:r></w:p>`,
  `<w:p><w:pPr><w:pStyle w:val="Subtitle"/></w:pPr><w:r><w:t>Project: D:\\Backups-01\\HRMS-1\\Admin_Panel_2.0 | Date: June 3, 2026</w:t></w:r></w:p>`,
  callout('Final Assessment', 'The existing analysis is broadly correct: the project is a working MVP / advanced prototype, not enterprise-complete. The additional review found immediate security and authorization gaps that should be fixed before expanding business modules.'),
  heading('1. Executive Summary'),
  p('The application has a broad HRMS module surface and a successful production build, but many modules are implemented at MVP depth. The most urgent gaps are not only payroll, attendance, leave, and documents; they also include local secrets exposure, seed-route exposure, inconsistent authorization, weak session handling, and missing request validation.'),
  p('Recommended classification: demo-ready, partially MVP-ready, but not ready for enterprise production. Internal pilot should wait until the Priority 0 and Priority 1 security fixes are complete.'),
  heading('2. Additional Critical Gaps Found'),
  table(criticalRows, [1900, 4600, 2860]),
  heading('3. Confirmed Business Gaps'),
  bullet('Payroll uses simplified fixed working-day assumptions and lacks payroll runs, locks, adjustments, variance checks, statutory rule handling, and payslip archive/download.'),
  bullet('Attendance is not fully shift-based and lacks location/IP validation, overtime, half-day rules, missed checkout automation, holiday/weekoff integration, and lock workflow.'),
  bullet('Leave uses a simple balance value rather than a ledger with accrual, carry-forward, encashment, cancellation, and payroll-lock awareness.'),
  bullet('Documents store URL metadata rather than secure uploads, object storage keys, signed downloads, verification workflow, expiry alerts, and access logs.'),
  bullet('Notifications, reports, timecards, task approval, KPI calculations, and production monitoring remain incomplete or mostly missing.'),
  heading('4. Security Fix Order'),
  bullet('Rotate the MongoDB password, JWT secret, and seed admin password immediately. Treat existing local credentials as exposed if the project folder has been shared, zipped, backed up, or shown externally.'),
  bullet('Remove or hard-disable /api/seed after initial setup. If retained, require a one-time setup token and block the route in production.'),
  bullet('Lock down /api/settings so only authorized admins can mutate departments, shifts, holidays, and system configuration.'),
  bullet('Replace scattered role checks with a single server-side permission helper such as requirePermission(resource, action, scope).'),
  bullet('Move from localStorage bearer-token persistence toward secure HttpOnly cookies or a hardened token/session design with refresh-token rotation and revocation.'),
  bullet('Add route-level request validation and field allowlists before writing to MongoDB.'),
  heading('5. Recommended Roadmap'),
  table(roadmapRows, [900, 4700, 2760]),
  heading('6. Immediate Acceptance Checklist'),
  check('Secrets rotated and .env.example created without real credentials.'),
  check('/api/seed removed, disabled, or protected with production guard.'),
  check('/api/settings POST/PUT/DELETE restricted to authorized admin permissions.'),
  check('All APIs enforce server-side module/action/scope permissions.'),
  check('Sensitive writes and security events create structured audit logs.'),
  check('Request bodies are validated and restricted to explicit allowed fields.'),
  check('Refresh tokens are tracked, rotated, and revocable.'),
  check('Payroll uses locked attendance and leave data before finalization.'),
  check('Leave balance is ledger-based, not a single mutable number.'),
  check('Documents use secure upload/download and access logging.'),
  check('Critical rules have automated tests for auth, RBAC, attendance, leave, and payroll.'),
  heading('7. Final Recommendation'),
  p('Do not start by adding more visible screens. First stabilize the foundation: secrets, seed route, settings authorization, central RBAC, validation, audit, and session handling. After that, rebuild the payroll-attendance-leave chain around locked source data. This gives the project a safer path from prototype to enterprise MVP.'),
];

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${body.join('\n')}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="160"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="0B2545"/><w:sz w:val="40"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:color w:val="64748B"/><w:sz w:val="21"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="BodyText"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="160"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="2E74B5"/><w:sz w:val="32"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="BodyText"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="2E74B5"/><w:sz w:val="26"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="160" w:line="280" w:lineRule="auto"/></w:pPr></w:style>
</w:styles>`;

const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
  <w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="☐"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
  <w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>
</w:numbering>`;

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`;

const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>HRMS 2.0 Final Gap Analysis and Fix Plan</dc:title>
  <dc:creator>Codex</dc:creator>
  <cp:lastModifiedBy>Codex</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">2026-06-03T00:00:00Z</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">2026-06-03T00:00:00Z</dcterms:modified>
</cp:coreProperties>`;

const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Codex</Application></Properties>`;

const files = [
  ['[Content_Types].xml', contentTypes],
  ['_rels/.rels', rels],
  ['word/document.xml', documentXml],
  ['word/_rels/document.xml.rels', documentRels],
  ['word/styles.xml', stylesXml],
  ['word/numbering.xml', numberingXml],
  ['docProps/core.xml', core],
  ['docProps/app.xml', app],
];

fs.writeFileSync(outPath, makeZip(files));
console.log(outPath);
