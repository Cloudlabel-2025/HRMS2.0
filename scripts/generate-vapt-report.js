const {
  Document, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle,
  ShadingType, Packer, PageBreak, convertInchesToTwip,
} = require('docx');
const fs = require('fs');
const path = require('path');

const OUTPUT_PATH = path.resolve(__dirname, '..', 'VAPT_Report.docx');

const RED = '8B0000';
const ORANGE = 'CC6600';
const YELLOW = '999900';
const GRAY = '666666';
const WHITE = 'FFFFFF';
const DARK = '333333';
const LIGHT_BG = 'F5F5F5';

function severityBadge(severity) {
  const fillMap = {
    Critical: RED,
    High: ORANGE,
    Medium: YELLOW,
    Low: GRAY,
  };
  return new Paragraph({
    spacing: { before: 0, after: 120 },
    shading: { type: ShadingType.CLEAR, fill: fillMap[severity] || GRAY },
    indent: { left: convertInchesToTwip(0.1) },
    children: [
      new TextRun({
        text: severity.toUpperCase(),
        bold: true,
        color: WHITE,
        size: 18,
        font: 'Arial',
      }),
    ],
  });
}

function findingHeading(title) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 300, after: 60 },
    children: [
      new TextRun({
        text: title,
        bold: true,
        size: 26,
        font: 'Arial',
        color: '000000',
      }),
    ],
  });
}

function infoLine(label, value) {
  return new Paragraph({
    spacing: { before: 0, after: 60 },
    children: [
      new TextRun({ text: label, bold: true, size: 21, font: 'Arial', color: DARK }),
      new TextRun({ text: value, size: 21, font: 'Arial', color: DARK }),
    ],
  });
}

function bodyParagraph(text) {
  return new Paragraph({
    spacing: { before: 0, after: 80 },
    children: [
      new TextRun({ text, size: 21, font: 'Arial' }),
    ],
  });
}

function boldLabel(label, text) {
  return new Paragraph({
    spacing: { before: 0, after: 80 },
    children: [
      new TextRun({ text: label, bold: true, size: 21, font: 'Arial', color: DARK }),
      new TextRun({ text, size: 21, font: 'Arial' }),
    ],
  });
}

function findingSection(number, title, severity, location, description, risk, impact, recommendation) {
  return [
    findingHeading(`${number}. ${title}`),
    severityBadge(severity),
    infoLine('Location: ', location),
    bodyParagraph(description),
    boldLabel('Risk: ', risk),
    boldLabel('Impact: ', impact),
    boldLabel('Recommendation: ', recommendation),
    new Paragraph({
      spacing: { before: 0, after: 200 },
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' },
      },
      children: [],
    }),
  ];
}

async function main() {
  const children = [];

  // ===================== TITLE PAGE =====================
  children.push(
    new Paragraph({ spacing: { before: 3000 }, children: [] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: 'HRMS Admin Panel',
          bold: true,
          size: 56,
          font: 'Arial',
          color: RED,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [
        new TextRun({
          text: 'Vulnerability Assessment & Penetration Testing',
          bold: true,
          size: 32,
          font: 'Arial',
          color: DARK,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: 'Security Assessment Report',
          bold: true,
          size: 28,
          font: 'Arial',
          color: GRAY,
        }),
      ],
    }),
    new Paragraph({ spacing: { before: 600 }, children: [] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      children: [
        new TextRun({ text: 'Version: 1.0', size: 24, font: 'Arial', color: DARK }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      children: [
        new TextRun({ text: 'Date: June 24, 2026', size: 24, font: 'Arial', color: DARK }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      children: [
        new TextRun({
          text: 'Classification: CONFIDENTIAL',
          bold: true,
          size: 24,
          font: 'Arial',
          color: RED,
        }),
      ],
    }),
    new Paragraph({ children: [new PageBreak()] })
  );

  // ===================== 1. EXECUTIVE SUMMARY =====================
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 200, after: 200 },
      children: [new TextRun({ text: '1. Executive Summary', bold: true })],
    }),
    bodyParagraph(
      'This report presents the findings of a Vulnerability Assessment and Penetration Testing (VAPT) ' +
      'engagement conducted on the HRMS Admin Panel web application. The assessment was performed as a ' +
      'white-box security review covering authentication mechanisms, session management, data exposure risks, ' +
      'security headers, dependency vulnerabilities, and common web application attack vectors as outlined ' +
      'in the OWASP Web Security Testing Guide (WSTG).'
    ),
    bodyParagraph(''),
    bodyParagraph(
      'A total of 12 security findings were identified across four severity levels: ' +
      '2 Critical, 5 High, 3 Medium, and 2 Low. ' +
      'The overall risk rating for the application is CRITICAL due to the exposure of hardcoded JWT secrets ' +
      'and database credentials in the codebase, which could lead to complete system compromise. ' +
      'Immediate remediation is recommended for all Critical and High severity findings.'
    ),
    new Paragraph({ children: [new PageBreak()] })
  );

  // ===================== 2. SCOPE =====================
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 200, after: 200 },
      children: [new TextRun({ text: '2. Scope', bold: true })],
    }),
    infoLine('Target: ', 'http://localhost:3000'),
    infoLine('Assessment Date: ', 'June 24, 2026'),
    infoLine('Technology Stack: ', 'Next.js 16, React 19, MongoDB via Mongoose 9, Prisma, Zod'),
    infoLine('Assessment Type: ', 'White-box security review (source code access provided)'),
    infoLine('Methodology: ', 'OWASP Web Security Testing Guide (WSTG)'),
    new Paragraph({ children: [new PageBreak()] })
  );

  // ===================== 3. FINDINGS =====================
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 200, after: 200 },
      children: [new TextRun({ text: '3. Findings', bold: true })],
    })
  );

  // --- 3.1 CRITICAL ---
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 300, after: 200 },
      children: [
        new TextRun({
          text: '3.1 Critical Severity Findings',
          bold: true,
          color: RED,
        }),
      ],
    }),
    ...findingSection(
      '1',
      'Sensitive Data Exposure \u2014 Hardcoded JWT Secret',
      'Critical',
      'D:\\Projects\\HRMS2.0\\.env.local',
      'The JWT_SECRET used for signing JSON Web Tokens is a hardcoded, predictable string present in the .env.local file. ' +
      'This static secret never changes across environments or deployments, making it possible for anyone with access to the ' +
      'codebase to forge valid JWTs for any user account.',
      'Any attacker who gains access to the codebase can forge valid JWTs for any user, bypassing all authentication controls.',
      'Complete authentication bypass, account takeover, and unauthorized access to all system functionality.',
      'Use a strong random secret via process.env.JWT_SECRET with a fallback check at application startup. ' +
      'Rotate the secret immediately. Never hardcode secrets in source files or commit them to version control.'
    ),
    ...findingSection(
      '2',
      'MongoDB Atlas Credentials Exposed',
      'Critical',
      'D:\\Projects\\HRMS2.0\\.env.local',
      'The full MongoDB Atlas connection string containing database credentials (username and password) is exposed ' +
      'in the .env.local file. This connection string provides direct read/write access to the production database ' +
      'without any additional authentication factors.',
      'An attacker with access to this connection string can connect directly to the MongoDB Atlas cluster and compromise all stored data.',
      'Complete loss of data confidentiality and integrity. Data exfiltration, data manipulation, and potential data loss. ' +
      'Possible lateral movement to other services sharing the same credentials.',
      'Rotate MongoDB Atlas credentials immediately. Restrict .env.local from version control via .gitignore. ' +
      'Use environment variables in production. Implement IP whitelisting on Atlas. Enable MFA on the MongoDB Atlas account.'
    ),
    new Paragraph({ children: [new PageBreak()] })
  );

  // --- 3.2 HIGH ---
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 300, after: 200 },
      children: [
        new TextRun({
          text: '3.2 High Severity Findings',
          bold: true,
          color: ORANGE,
        }),
      ],
    }),
    ...findingSection(
      '3',
      'Authentication \u2014 User Enumeration via Login Response',
      'High',
      'src\\app\\api\\auth\\login\\route.js',
      'The login endpoint returns a different response based on whether the submitted email exists in the system. ' +
      'When the email is registered, the response includes the remaining attempts count. When the email is not registered, ' +
      'it returns a generic error without the additional count information. This differential response enables user enumeration.',
      'An attacker can systematically determine which email addresses have registered accounts on the system, ' +
      'enabling targeted phishing and credential stuffing attacks.',
      'Targeted phishing campaigns against known users, credential stuffing with known emails, ' +
      'reduced effort for account compromise.',
      'Return identical response messages and status codes regardless of whether the email exists in the system. ' +
      'Remove any differential error information from the response.'
    ),
    ...findingSection(
      '4',
      'Session Management \u2014 Overly Long JWT Expiration',
      'High',
      '.env.local (JWT_EXPIRES_IN=7d)',
      'JSON Web Tokens are configured with a 7-day expiration period. Stolen or intercepted tokens remain ' +
      'valid for an extended window of time, significantly increasing the risk of unauthorized access.',
      'Stolen or intercepted JWT tokens can be used for up to 7 days before expiring, giving attackers ' +
      'a large window for abuse.',
      'Extended period of unauthorized access if tokens are compromised. Difficulty in revoking access ' +
      'without deploying token blacklists.',
      'Reduce JWT expiration to 15-60 minutes. Implement refresh token rotation with short-lived access tokens. ' +
      'Maintain a token blacklist for immediate revocation capability.'
    ),
    ...findingSection(
      '5',
      'Missing Security Headers',
      'High',
      'All server responses',
      'The application does not set essential security headers including Content-Security-Policy (CSP), ' +
      'HTTP Strict-Transport-Security (HSTS), X-Frame-Options, and X-Content-Type-Options. These headers ' +
      'protect against clickjacking, cross-site scripting (XSS), and MIME-type sniffing attacks.',
      'The application is vulnerable to clickjacking attacks (missing X-Frame-Options), ' +
      'cross-site scripting via MIME-type confusion (missing X-Content-Type-Options), ' +
      'and downgrade attacks (missing HSTS).',
      'Users can be tricked into performing unintended actions via embedded frames. Scripts can be executed ' +
      'in unexpected contexts. Sensitive data can be intercepted over HTTP downgrades.',
      'Implement helmet.js middleware or manually add response headers: ' +
      'Content-Security-Policy, Strict-Transport-Security (max-age=31536000; includeSubDomains), ' +
      'X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Referrer-Policy: strict-origin-when-cross-origin.'
    ),
    ...findingSection(
      '6',
      'X-Powered-By Header Information Leak',
      'High',
      'All server responses',
      'Every server response includes the "X-Powered-By: Next.js" header, explicitly disclosing the ' +
      'server technology and framework version to any client that makes a request.',
      'Technology fingerprinting allows attackers to target known vulnerabilities specific to the ' +
      'identified framework version.',
      'Reduced attacker effort \u2014 known CVEs for the specific framework version can be exploited ' +
      'without guessing the technology stack.',
      'Disable the header via Next.js configuration by setting poweredByHeader: false in next.config.js.'
    ),
    ...findingSection(
      '7',
      'Dependency Vulnerabilities',
      'High',
      'package.json (hono 4.x, postcss via next)',
      'The project has 6 known vulnerabilities (5 moderate, 1 high) in its dependencies including: ' +
      'hono path traversal on Windows via encoded backslash (GHSA-wwfh-h76j-fc44), ' +
      'hono CORS middleware reflecting any Origin with credentials (GHSA-88fw-hqm2-52qc), ' +
      'hono Body Limit Middleware bypass on AWS Lambda (GHSA-rv63-4mwf-qqc2), ' +
      '@hono/node-server middleware bypass via repeated slashes (GHSA-92pp-h63x-v22m), ' +
      'and postcss XSS via unescaped </style> (GHSA-qx2v-qp2m-jg93).',
      'Multiple exploit vectors exist including path traversal on Windows systems, ' +
      'cross-site scripting, and request smuggling via middleware bypass.',
      'Path traversal could lead to arbitrary file read. CORS bypass could enable cross-origin credential theft. ' +
      'Request smuggling could bypass authentication middleware.',
      'Update hono to the latest patched version. Monitor next.js updates for postcss fixes. ' +
      'Run npm audit regularly. Consider using Snyk or Dependabot for automated dependency scanning.'
    ),
    new Paragraph({ children: [new PageBreak()] })
  );

  // --- 3.3 MEDIUM ---
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 300, after: 200 },
      children: [
        new TextRun({
          text: '3.3 Medium Severity Findings',
          bold: true,
          color: YELLOW,
        }),
      ],
    }),
    ...findingSection(
      '8',
      'Rate Limiting IP-Based Only',
      'Medium',
      'src\\app\\api\\auth\\login\\route.js',
      'Rate limiting is implemented using an in-memory Map keyed solely by IP address. ' +
      'The rate limit resets on server restart and allows 3 attempts per 15-minute window. ' +
      'The source IP can be spoofed via the X-Forwarded-For header.',
      'Attackers can bypass rate limiting by rotating IP addresses or spoofing the X-Forwarded-For header. ' +
      'Server restarts reset the rate limit entirely, allowing a fresh set of attempts.',
      'Brute force attacks against user credentials become feasible with IP rotation. ' +
      'Rate limits are ineffective against distributed attacks.',
      'Use database-backed rate limiting that persists across restarts. Include X-Forwarded-For headers ' +
      'in the rate limit key. Implement progressive delays and CAPTCHA after repeated failures. ' +
      'Use a dedicated rate limiting service in production.'
    ),
    ...findingSection(
      '9',
      'Bootstrap Loaded from Third-Party CDN',
      'Medium',
      'src\\app\\layout.js',
      'Bootstrap 5.3.3 is loaded from cdn.jsdelivr.net via a <script async> tag without Subresource Integrity (SRI) hashes. ' +
      'A compromise of the CDN or a Man-in-the-Middle attack could inject malicious JavaScript into the application.',
      'If the CDN is compromised or a MITM attack intercepts the request, arbitrary JavaScript could be served ' +
      'to all users of the application.',
      'Full client-side compromise including session token theft, credential harvesting, ' +
      'and arbitrary data exfiltration from the browser.',
      'Self-host all third-party static assets, or add SRI (Subresource Integrity) hashes to all CDN-loaded resources. ' +
      'Implement a strict Content-Security-Policy to restrict script sources.'
    ),
    ...findingSection(
      '10',
      'Missing CSRF Protection',
      'Medium',
      'All API routes',
      'No Cross-Site Request Forgery (CSRF) protection mechanisms are implemented. There are no CSRF tokens, ' +
      'SameSite cookie attributes, or Origin/Referer header validation on state-changing API requests.',
      'Authenticated users can be tricked into performing unintended actions by visiting a malicious website ' +
      'that issues forged cross-origin requests.',
      'Unauthorized state changes, data modification, and privilege escalation on behalf of authenticated users ' +
      'without their knowledge or consent.',
      'Set SameSite=Strict on session cookies. Implement CSRF tokens for all state-changing requests. ' +
      'Validate Origin and Referer headers on the server side for all mutating requests.'
    ),
    new Paragraph({ children: [new PageBreak()] })
  );

  // --- 3.4 LOW ---
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 300, after: 200 },
      children: [
        new TextRun({
          text: '3.4 Low Severity Findings',
          bold: true,
          color: GRAY,
        }),
      ],
    }),
    ...findingSection(
      '11',
      'CORS Preflight Allowed on All Endpoints',
      'Low',
      'All API OPTIONS responses',
      'The application responds to CORS preflight OPTIONS requests with a 204 status code and Allow header ' +
      'on all endpoints, regardless of the requesting origin.',
      'Information disclosure of allowed HTTP methods and permissive CORS preflight behavior ' +
      'may aid attackers in reconnaissance efforts.',
      'Risk is minimal but contributes to weakness in the overall security posture.',
      'Restrict OPTIONS preflight responses to known trusted origins in production. ' +
      'Disable unnecessary HTTP methods.'
    ),
    ...findingSection(
      '12',
      'Server Technology Fingerprinting via RSC Headers',
      'Low',
      'Next.js RSC headers',
      'Next.js exposes framework-specific headers such as "Vary: RSC" and "Next-Router-State-Tree" ' +
      'in server responses. These headers reveal the underlying technology stack to potential attackers.',
      'Framework fingerprinting provides attackers with information about the technology stack, ' +
      'potentially reducing the effort required to identify applicable vulnerabilities.',
      'Minimal direct impact but contributes to the overall attack surface for targeted exploitation.',
      'Remove or minimize framework-specific response headers in production. ' +
      'Consider using a reverse proxy to strip unnecessary headers before they reach clients.'
    ),
    new Paragraph({ children: [new PageBreak()] })
  );

  // ===================== 4. SEVERITY SUMMARY =====================
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 200, after: 200 },
      children: [new TextRun({ text: '4. Severity Summary', bold: true })],
    })
  );

  const severityData = [
    { level: 'Critical', count: 2, color: RED, bg: 'FFCCCC' },
    { level: 'High', count: 5, color: ORANGE, bg: 'FFE0B2' },
    { level: 'Medium', count: 3, color: YELLOW, bg: 'FFF9C4' },
    { level: 'Low', count: 2, color: GRAY, bg: 'F0F0F0' },
    { level: 'Total', count: 12, color: DARK, bg: 'E0E0E0' },
  ];

  const headerBg = '2F5496';

  const tableRows = [
    new TableRow({
      tableHeader: true,
      children: [
        new TableCell({
          width: { size: 70, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, fill: headerBg },
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: 'Severity', bold: true, color: WHITE, size: 22, font: 'Arial' })],
          })],
        }),
        new TableCell({
          width: { size: 30, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, fill: headerBg },
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: 'Count', bold: true, color: WHITE, size: 22, font: 'Arial' })],
          })],
        }),
      ],
    }),
    ...severityData.map((row) =>
      new TableRow({
        children: [
          new TableCell({
            width: { size: 70, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.CLEAR, fill: row.bg },
            children: [new Paragraph({
              children: [
                new TextRun({
                  text: row.level,
                  bold: true,
                  size: 22,
                  font: 'Arial',
                  color: row.color,
                }),
              ],
            })],
          }),
          new TableCell({
            width: { size: 30, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.CLEAR, fill: row.bg },
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({
                text: String(row.count),
                bold: true,
                size: 22,
                font: 'Arial',
                color: row.color,
              })],
            })],
          }),
        ],
      })
    ),
  ];

  const table = new Table({
    rows: tableRows,
    width: { size: 100, type: WidthType.PERCENTAGE },
  });

  children.push(table);

  // ===================== BUILD DOCUMENT =====================
  const doc = new Document({
    title: 'HRMS VAPT Security Assessment Report',
    description: 'Vulnerability Assessment and Penetration Testing Report for HRMS Admin Panel',
    creator: 'Security Assessment Team',
    sections: [{
      properties: {
        page: {
          margin: {
            top: convertInchesToTwip(1),
            right: convertInchesToTwip(1),
            bottom: convertInchesToTwip(1),
            left: convertInchesToTwip(1),
          },
        },
      },
      children,
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(OUTPUT_PATH, buffer);
  return buffer.length;
}

main()
  .then((size) => {
    console.log('VAPT report generated successfully');
    console.log(`File size: ${(size / 1024).toFixed(1)} KB (${size} bytes)`);
  })
  .catch((err) => {
    console.error('Error generating report:', err);
    process.exit(1);
  });
