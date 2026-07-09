import nodemailer from 'nodemailer';

let transporter = null;

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true'; // false for 587 (STARTTLS), true for 465 (SSL)
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;

  if (!transporter) {
    if (!host || !user || !pass) {
      console.warn('⚠️ SMTP email configuration is missing or incomplete in environment variables.');
      return null;
    }
    transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {
        user,
        pass,
      },
    });
  }
  return transporter;
}

export async function sendEmail({ to, subject, html, text }) {
  const client = getTransporter();
  const from = process.env.SMTP_FROM_EMAIL || '"HRMS" <noreply@yourcompany.com>';

  if (!client) {
    console.warn(`📩 Mail would be sent to ${to} (but SMTP is unconfigured): ${subject}`);
    return null;
  }

  const mailOptions = {
    from,
    to,
    subject,
    text,
    html,
  };

  return client.sendMail(mailOptions);
}

export async function sendResetPasswordEmail(to, name, resetUrl) {
  const subject = 'Reset Your HRMS Password';
  const text = `Hello ${name || 'User'},\n\nYou requested to reset your password. Please copy and paste the following link into your browser to proceed:\n\n${resetUrl}\n\nThis link is valid for 15 minutes.\n\nIf you did not request this, please ignore this email.\n\nBest regards,\nHRMS Team`;

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Reset Your Password</title>
        <style>
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background-color: #f8fafc;
            margin: 0;
            padding: 0;
            color: #1e293b;
          }
          .container {
            max-width: 600px;
            margin: 40px auto;
            background: #ffffff;
            border-radius: 8px;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);
            overflow: hidden;
            border: 1px solid #e2e8f0;
          }
          .header {
            background-color: #3b82f6;
            color: #ffffff;
            padding: 24px;
            text-align: center;
          }
          .header h1 {
            margin: 0;
            font-size: 22px;
            font-weight: 700;
          }
          .content {
            padding: 32px;
            line-height: 1.6;
          }
          .content h2 {
            font-size: 18px;
            margin-top: 0;
            color: #0f172a;
          }
          .btn-container {
            text-align: center;
            margin: 32px 0;
          }
          .btn {
            background-color: #3b82f6;
            color: #ffffff !important;
            padding: 12px 24px;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 600;
            display: inline-block;
            box-shadow: 0 2px 4px rgba(59, 130, 246, 0.2);
          }
          .btn:hover {
            background-color: #2563eb;
          }
          .footer {
            background-color: #f1f5f9;
            padding: 16px;
            text-align: center;
            font-size: 12px;
            color: #64748b;
            border-top: 1px solid #e2e8f0;
          }
          .link-fallback {
            word-break: break-all;
            font-size: 13px;
            color: #64748b;
            margin-top: 24px;
            padding: 12px;
            background-color: #f8fafc;
            border-radius: 4px;
            border: 1px solid #e2e8f0;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>HRMS Portal</h1>
          </div>
          <div class="content">
            <h2>Hello ${name || 'User'},</h2>
            <p>We received a request to reset the password for your account associated with this email address.</p>
            <p>Click the button below to set a new password. This link will expire in 15 minutes.</p>
            <div class="btn-container">
              <a href="${resetUrl}" class="btn" target="_blank">Reset Password</a>
            </div>
            <p>If you did not make this request, you can safely ignore this email; your password will remain unchanged.</p>
            <div class="link-fallback">
              <strong>If the button above does not work, copy and paste this URL into your browser:</strong><br>
              <a href="${resetUrl}" target="_blank">${resetUrl}</a>
            </div>
          </div>
          <div class="footer">
            <p>This is an automated message. Please do not reply to this email.</p>
            <p>&copy; ${new Date().getFullYear()} HRMS. All rights reserved.</p>
          </div>
        </div>
      </body>
    </html>
  `;

  return sendEmail({ to, subject, html, text });
}
