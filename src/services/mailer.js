// src/services/mailer.js
const nodemailer = require("nodemailer");
const { renderTemplate } = require("./templating");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT || 587) === 465, // true for 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * Send an email for a contact using a compiled template.
 * Returns { success: boolean, info, error }
 * `opts` should include:
 *  - to
 *  - from (optional)
 *  - replyTo (optional)
 *  - subjectTemplate (string)
 *  - htmlTemplate (string)
 *  - textTemplate (string)
 *  - context (object) // contact.fields etc.
 *  - inReplyTo (string|null)
 *  - references (string[]|null)
 */
async function sendMail(opts = {}) {
  try {
    const from = opts.from || process.env.FROM_EMAIL;
    const replyTo = opts.replyTo || process.env.FROM_EMAIL;

    const subject = renderTemplate(
      opts.subjectTemplate || "",
      opts.context || {}
    );
    const html = renderTemplate(opts.htmlTemplate || "", opts.context || {});
    const text = renderTemplate(opts.textTemplate || "", opts.context || {});

    const mailOptions = {
      from,
      to: opts.to,
      replyTo,
      subject,
      text,
      html,
      // Threading headers (some providers support these fields directly)
      // We'll also pass headers explicitly to be safe.
      inReplyTo: opts.inReplyTo || undefined,
      references:
        opts.references && opts.references.length
          ? opts.references.join(" ")
          : undefined,
      headers: {},
    };

    // Some mail servers accept 'In-Reply-To' in headers instead of dedicated field
    if (opts.inReplyTo) mailOptions.headers["In-Reply-To"] = opts.inReplyTo;
    if (opts.references && opts.references.length)
      mailOptions.headers["References"] = opts.references.join(" ");

    const info = await transporter.sendMail(mailOptions);
    // info.messageId typically like '<abcdef@mail.example.com>'
    return { success: true, info };
  } catch (err) {
    return { success: false, error: err.message || err };
  }
}

module.exports = { sendMail, transporter };
