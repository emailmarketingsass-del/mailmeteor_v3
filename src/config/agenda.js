// src/config/agenda.js
const Agenda = require("agenda");
const mongoose = require("mongoose");
const Campaign = require("../models/Campaign");
const Contact = require("../models/Contact");
const FollowUp = require("../models/FollowUp");
const SentEmailLog = require("../models/SentEmailLog");
const { sendMail } = require("../services/mailer");

const mongoConnectionString = process.env.MONGODB_URI;
const collection = process.env.AGENDA_COLLECTION || "agendaJobs";

const agenda = new Agenda({
  db: {
    address: mongoConnectionString,
    collection,
    options: { useUnifiedTopology: true },
  },
});

// Job: send-email
// data: { campaignId, contactId, sequence }
// sequence: 0 = main email, 1..N = follow-ups
agenda.define(
  "send-email",
  { concurrency: 5, lockLifetime: 1000 * 60 * 10 },
  async (job, done) => {
    try {
      const { campaignId, contactId, sequence } = job.attrs.data;
      if (!campaignId || !contactId || typeof sequence === "undefined")
        return done(new Error("Missing job data"));

      const [campaign, contact] = await Promise.all([
        Campaign.findById(campaignId).lean(),
        Contact.findById(contactId),
      ]);

      if (!campaign || !contact) return done();

      // If contact already replied or unsubscribed — skip
      if (contact.status === "replied" || contact.status === "unsubscribed") {
        return done();
      }

      // Choose template based on sequence
      let subjectTemplate, htmlTemplate, textTemplate;
      if (sequence === 0) {
        subjectTemplate = campaign.mainTemplate.subject;
        htmlTemplate = campaign.mainTemplate.html;
        textTemplate = campaign.mainTemplate.text;
      } else {
        const follow = await FollowUp.findOne({
          campaignId: campaign._id,
          sequence,
        });
        if (!follow || !follow.enabled) return done();
        subjectTemplate = follow.subject || campaign.mainTemplate.subject;
        htmlTemplate = follow.html || "";
        textTemplate = follow.text || "";
      }

      // Prepare threading headers:
      // Use contact.lastMessageId if present (prefer reference to the last sent message in thread).
      // For first email (sequence 0) there is no inReplyTo.
      const inReplyTo =
        sequence === 0 ? undefined : contact.lastMessageId || undefined;
      const references = [];
      if (contact.lastMessageId) references.push(contact.lastMessageId);

      const context = contact.fields || {};

      // LOG: sending main email or follow-up
      console.log(
        sequence === 0
          ? `📤 Sending MAIN email → Campaign ${campaign._id} → ${contact.email}`
          : `📨 Sending FOLLOW-UP #${sequence} → Campaign ${campaign._id} → ${
              contact.email
            }\n   In-Reply-To: ${inReplyTo}\n   References: ${references.join(
              ", "
            )}`,
        "\n   Subject:",
        subjectTemplate
      );

      // send email
      const result = await sendMail({
        to: contact.email,
        from: campaign.settings?.fromEmail,
        replyTo: campaign.settings?.replyTo,
        subjectTemplate,
        htmlTemplate,
        textTemplate,
        context,
        inReplyTo,
        references,
      });

      const log = new SentEmailLog({
        campaignId: campaign._id,
        contactId: contact._id,
        sequence,
        sentAt: new Date(),
        status: result.success ? "delivered" : "failed",
        messageId:
          result.success && result.info ? result.info.messageId : undefined,
        error: result.success ? undefined : result.error || "unknown error",
      });

      await log.save();

      if (result.success && result.info && result.info.messageId) {
        // Update contact.lastMessageId so subsequent follow-ups will reference the last message in thread.
        contact.lastMessageId = result.info.messageId;
        contact.lastSentAt = new Date();
        // If sequence == 0 mark status as 'sent'
        if (sequence === 0 && contact.status !== "sent")
          contact.status = "sent";
        await contact.save();
      }

      // If this was the main email, schedule follow-ups for this contact
      if (sequence === 0) {
        // load all followups for campaign (sequence 1..N)
        const followUps = await FollowUp.find({
          campaignId: campaign._id,
          enabled: true,
        })
          .sort({ sequence: 1 })
          .lean();
        for (const fu of followUps) {
          // If follow-up document has 'sendAt' (absolute Date), use that
          // else use delayMinutes relative to now (or relative to contact.lastSentAt)
          let when;
          if (fu.sendAt) {
            const candidate = new Date(fu.sendAt);
            // if sendAt is in the past, schedule it a minute from now
            if (candidate.getTime() <= Date.now()) {
              when = new Date(Date.now() + 60 * 1000); // 1 minute from now
            } else {
              when = candidate;
            }
          } else {
            const delayMinutes = Number(fu.delayMinutes || 24 * 60);
            when = new Date(Date.now() + delayMinutes * 60 * 1000);
          }
          // Schedule a job for that contact/sequence (sequence=fu.sequence)
          await agenda.schedule(when, "send-email", {
            campaignId: campaign._id,
            contactId: contact._id,
            sequence: fu.sequence,
          });
        }
      }

      done();
    } catch (err) {
      console.error("Agenda job error:", err);
      done(err);
    }
  }
);

// Start Agenda when this module loads
(async function () {
  try {
    await agenda.start();
    console.log("Agenda started");
  } catch (e) {
    console.error("Failed to start Agenda", e);
  }
})();

module.exports = agenda;
