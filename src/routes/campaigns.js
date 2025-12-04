// src/routes/campaigns.js
const express = require("express");
const router = express.Router();
const Campaign = require("../models/Campaign");
const FollowUp = require("../models/FollowUp");
const Contact = require("../models/Contact");
const SentEmailLog = require("../models/SentEmailLog");

const multer = require("multer");
const csvParser = require("csv-parser");
const ExcelJS = require("exceljs");
const validator = require("validator"); // for email validation
const fs = require("fs");
const path = require("path");

// Create a new campaign
router.post("/", async (req, res, next) => {
  try {
    const { name, description, mainTemplate, settings } = req.body;

    if (!name || !mainTemplate || !mainTemplate.subject) {
      return res.status(400).json({
        error: "Missing required fields: name and mainTemplate.subject",
      });
    }

    const campaign = new Campaign({
      name,
      description,
      mainTemplate,
      settings,
    });

    await campaign.save();

    return res.status(201).json({ campaign });
  } catch (err) {
    next(err);
  }
});

// List campaigns
router.get("/", async (req, res, next) => {
  try {
    const campaigns = await Campaign.find()
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json({ campaigns });
  } catch (err) {
    next(err);
  }
});

// Get campaign details (including followups count and contacts count)
router.get("/:id", async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id).lean();
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });

    const followUps = await FollowUp.find({ campaignId: campaign._id })
      .sort({ sequence: 1 })
      .lean();
    const contactsCount = await Contact.countDocuments({
      campaignId: campaign._id,
    });

    res.json({ campaign, followUps, contactsCount });
  } catch (err) {
    next(err);
  }
});

// POST /api/campaigns/:id/preview
// Body: { subject, html, text, sampleFields }  (all optional; sampleFields is an object)
router.post("/:id/preview", async (req, res, next) => {
  try {
    const { subject, html, text, sampleFields } = req.body || {};

    // sampleFields is a plain object representing contact.fields
    const sample = sampleFields || {};

    const { renderTemplate } = require("../services/templating");

    const preview = {
      subject: renderTemplate(subject || "", sample),
      html: renderTemplate(html || "", sample),
      text: renderTemplate(text || "", sample),
    };

    res.json({ success: true, preview });
  } catch (err) {
    next(err);
  }
});

// ---- CONTACTS UPLOAD (CSV / XLSX) ----
// POST /api/campaigns/:id/contacts/upload
// Form-data: file (file), optional field: updateExisting (boolean string 'true'|'false')
const upload = multer({
  dest: path.join(__dirname, "../../uploads/"),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB limit (adjust if needed)
});

router.post(
  "/:id/contacts/upload",
  upload.single("file"),
  async (req, res, next) => {
    try {
      const campaignId = req.params.id;
      const file = req.file;
      const updateExisting =
        String(req.body.updateExisting || "false").toLowerCase() === "true";

      if (!file)
        return res
          .status(400)
          .json({ error: 'No file uploaded. Use form-data with key "file".' });

      // Validate campaign exists
      const campaign = await Campaign.findById(campaignId).lean();
      if (!campaign) {
        // remove uploaded file
        fs.unlinkSync(file.path);
        return res.status(404).json({ error: "Campaign not found" });
      }

      const ext = path.extname(file.originalname).toLowerCase();
      const rows = []; // array of { email, fields, metadata }

      if (ext === ".csv" || ext === ".txt") {
        // Parse CSV
        await new Promise((resolve, reject) => {
          const stream = fs
            .createReadStream(file.path)
            .pipe(csvParser({ mapHeaders: ({ header }) => header.trim() }));

          stream.on("data", (row) => {
            // Normalize header keys to lower-case (optional)
            const normalized = {};
            Object.keys(row).forEach((k) => {
              normalized[k.trim()] = row[k];
            });
            rows.push(normalized);
          });
          stream.on("end", resolve);
          stream.on("error", reject);
        });
      } else if (ext === ".xlsx" || ext === ".xls") {
        // Parse Excel
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(file.path);
        const worksheet = workbook.worksheets[0];
        const headerRow = worksheet.getRow(1);
        const headers = [];
        headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
          headers.push(String(cell.value).trim());
        });
        worksheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return; // skip header
          const obj = {};
          headers.forEach((h, idx) => {
            const cell = row.getCell(idx + 1);
            obj[h] = cell ? (cell.value == null ? "" : String(cell.value)) : "";
          });
          rows.push(obj);
        });
      } else {
        fs.unlinkSync(file.path);
        return res
          .status(400)
          .json({ error: "Unsupported file type. Upload .csv or .xlsx" });
      }

      // Remove uploaded file (we've read it)
      try {
        fs.unlinkSync(file.path);
      } catch (e) {
        /* ignore */
      }

      // Map rows to Contact documents - each CSV column becomes fields[key]
      const summary = {
        totalRows: rows.length,
        inserted: 0,
        updated: 0,
        skipped: 0,
        errors: [],
      };

      // Helper: normalize header keys to valid JS keys (remove BOMs, trim)
      const normalizeKey = (k) =>
        String(k)
          .replace(/^\uFEFF/, "")
          .trim();

      // Process rows sequentially (simpler and safer for beginners).
      // For larger files consider bulk operations.
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        // Normalize keys
        const normalizedRow = {};
        Object.keys(row).forEach(
          (k) => (normalizedRow[normalizeKey(k)] = row[k])
        );

        // Find email column (case-insensitive); prefer header named 'email'
        let email = null;
        if (normalizedRow.email) email = String(normalizedRow.email).trim();
        else {
          // try to find one key that looks like an email
          for (const key of Object.keys(normalizedRow)) {
            if (String(normalizedRow[key]).includes("@")) {
              email = String(normalizedRow[key]).trim();
              break;
            }
          }
        }

        if (!email || !validator.isEmail(email)) {
          summary.skipped++;
          summary.errors.push({
            row: i + 1,
            reason: "Invalid or missing email",
            data: normalizedRow,
          });
          continue;
        }

        // Build fields object from all columns except 'email'
        const fields = {};
        Object.keys(normalizedRow).forEach((k) => {
          if (k.toLowerCase() === "email") return;
          fields[k] = normalizedRow[k];
        });

        const filter = { campaignId: campaign._id, email: email.toLowerCase() };
        const update = {
          $setOnInsert: {
            campaignId: campaign._id,
            email: email.toLowerCase(),
            status: "pending",
            createdAt: new Date(),
          },
          $set: {
            fields,
            metadata: { importedAt: new Date() },
            updatedAt: new Date(),
          },
        };

        try {
          if (updateExisting) {
            // overwrite fields and keep status unless it is replied/unsubscribed
            const existing = await Contact.findOne({
              campaignId: campaign._id,
              email: email.toLowerCase(),
            });
            if (existing) {
              // if contact replied or unsubscribed, skip updating to avoid overrides
              if (
                existing.status === "replied" ||
                existing.status === "unsubscribed"
              ) {
                summary.skipped++;
                continue;
              }
              await Contact.updateOne(filter, {
                $set: {
                  fields,
                  metadata: { importedAt: new Date() },
                  updatedAt: new Date(),
                },
              });
              summary.updated++;
            } else {
              await Contact.updateOne(filter, update, { upsert: true });
              summary.inserted++;
            }
          } else {
            // default: insert only if not exists
            const resUp = await Contact.updateOne(filter, update, {
              upsert: true,
            });
            // resUp.upsertedCount exists in Mongo native driver; Mongoose returns different shape.
            // We'll infer: if a document exists already, modifiedCount will be 0 and upsertedId may exist.
            if (resUp.upsertedCount || resUp.upsertedId) {
              summary.inserted++;
            } else {
              // likely already existed
              summary.skipped++;
            }
          }
        } catch (err) {
          // handle duplicate key errors gracefully
          if (err && err.code === 11000) {
            summary.skipped++;
          } else {
            summary.errors.push({
              row: i + 1,
              reason: err.message || "unknown",
            });
          }
        }
      }

      // Update campaign contactsCount (simple recount)
      try {
        const count = await Contact.countDocuments({
          campaignId: campaign._id,
        });
        await Campaign.findByIdAndUpdate(campaign._id, {
          contactsCount: count,
        });
      } catch (e) {
        // ignore non-critical
        console.warn("Could not update campaign contactsCount", e);
      }

      return res.json({ success: true, summary });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/campaigns/:id/send
// Body (optional): { batchSize } - limit how many contacts to queue right now
router.post("/:id/send", async (req, res, next) => {
  try {
    const campaignId = req.params.id;
    const campaign = await Campaign.findById(campaignId).lean();
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });

    const batchSize = Number(
      req.body.batchSize || campaign.settings?.batchSize || 100
    );

    // Find pending contacts
    const pendingContacts = await Contact.find({
      campaignId: campaign._id,
      status: "pending",
    })
      .limit(batchSize)
      .lean();

    if (!pendingContacts.length) {
      return res.json({
        success: true,
        queued: 0,
        message: "No pending contacts found",
      });
    }

    // Queue a send-email job for each contact (sequence = 0)
    const agenda = require("../config/agenda");
    for (const c of pendingContacts) {
      await agenda.now("send-email", {
        campaignId: campaign._id,
        contactId: c._id,
        sequence: 0,
      });
    }

    // Optionally update campaign.status
    await Campaign.findByIdAndUpdate(campaign._id, { status: "running" });

    res.json({ success: true, queued: pendingContacts.length });
  } catch (err) {
    next(err);
  }
});

// POST /api/campaigns/:id/contacts/:contactId/mark-replied
router.post("/:id/contacts/:contactId/mark-replied", async (req, res, next) => {
  try {
    const { id: campaignId, contactId } = req.params;
    const contact = await Contact.findOne({ _id: contactId, campaignId });
    if (!contact) return res.status(404).json({ error: "Contact not found" });
    contact.status = "replied";
    await contact.save();
    res.json({ success: true, contactId: contact._id });
  } catch (err) {
    next(err);
  }
});

// ----------------- FOLLOW-UP ROUTES -----------------

/**
 * Create a follow-up for a campaign
 * POST /api/campaigns/:id/followups
 * Body:
 *  {
 *    "sequence": 1,
 *    "subject": "Follow up {{first_name}}",
 *    "html": "<p>Hey {{first_name}} — following up...</p>",
 *    "text": "Hey {{first_name}} — following up...",
 *    "delayMinutes": 60,        // optional, relative (minutes)
 *    "sendAt": "2025-12-05T10:00:00Z", // optional absolute ISO date (overrides delayMinutes)
 *    "enabled": true
 *  }
 */
router.post("/:id/followups", async (req, res, next) => {
  try {
    const campaignId = req.params.id;
    const { sequence, subject, html, text, delayMinutes, sendAt, enabled } =
      req.body;

    // basic validation
    if (typeof sequence === "undefined") {
      return res
        .status(400)
        .json({ error: "Missing required field: sequence (integer, e.g., 1)" });
    }

    // ensure campaign exists
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });

    // ensure sequence uniqueness per campaign
    const exists = await FollowUp.findOne({
      campaignId: campaign._id,
      sequence,
    });
    if (exists)
      return res
        .status(400)
        .json({
          error: `Follow-up with sequence ${sequence} already exists for this campaign`,
        });

    const fu = new FollowUp({
      campaignId: campaign._id,
      sequence: Number(sequence),
      subject: subject || "",
      html: html || "",
      text: text || "",
      delayMinutes:
        typeof delayMinutes !== "undefined" ? Number(delayMinutes) : undefined,
      sendAt: sendAt ? new Date(sendAt) : undefined,
      enabled: typeof enabled === "undefined" ? true : Boolean(enabled),
    });

    await fu.save();
    res.status(201).json({ success: true, followUp: fu });
  } catch (err) {
    next(err);
  }
});

/**
 * List follow-ups for a campaign
 * GET /api/campaigns/:id/followups
 */
router.get("/:id/followups", async (req, res, next) => {
  try {
    const campaignId = req.params.id;
    const followUps = await FollowUp.find({ campaignId })
      .sort({ sequence: 1 })
      .lean();
    res.json({ success: true, followUps });
  } catch (err) {
    next(err);
  }
});

/**
 * Update a follow-up
 * PUT /api/campaigns/:id/followups/:fid
 * Body: any fields to update (subject, html, text, delayMinutes, sendAt, enabled)
 */
router.put("/:id/followups/:fid", async (req, res, next) => {
  try {
    const campaignId = req.params.id;
    const fid = req.params.fid;
    const update = {};
    const allowed = [
      "subject",
      "html",
      "text",
      "delayMinutes",
      "sendAt",
      "enabled",
      "sequence",
    ];
    allowed.forEach((k) => {
      if (typeof req.body[k] !== "undefined") update[k] = req.body[k];
    });

    if (update.sendAt) update.sendAt = new Date(update.sendAt);
    if (typeof update.delayMinutes !== "undefined")
      update.delayMinutes = Number(update.delayMinutes);
    if (typeof update.enabled !== "undefined")
      update.enabled = Boolean(update.enabled);
    if (typeof update.sequence !== "undefined")
      update.sequence = Number(update.sequence);

    const fu = await FollowUp.findOneAndUpdate(
      { _id: fid, campaignId },
      update,
      { new: true }
    );
    if (!fu) return res.status(404).json({ error: "Follow-up not found" });
    res.json({ success: true, followUp: fu });
  } catch (err) {
    next(err);
  }
});

/**
 * Delete a follow-up
 * DELETE /api/campaigns/:id/followups/:fid
 */
router.delete("/:id/followups/:fid", async (req, res, next) => {
  try {
    const campaignId = req.params.id;
    const fid = req.params.fid;
    const fu = await FollowUp.findOneAndDelete({ _id: fid, campaignId });
    if (!fu) return res.status(404).json({ error: "Follow-up not found" });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Delete campaign (less important requirement)
router.delete("/:id", async (req, res, next) => {
  try {
    const campaign = await Campaign.findByIdAndDelete(req.params.id);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });

    // Optional: also delete related contacts, followups, logs
    await FollowUp.deleteMany({ campaignId: campaign._id });
    await Contact.deleteMany({ campaignId: campaign._id });
    await SentEmailLog.deleteMany({ campaignId: campaign._id });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
