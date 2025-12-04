// src/models/Campaign.js
const mongoose = require("mongoose");

const TemplateSchema = new mongoose.Schema(
  {
    subject: { type: String, required: true },
    html: { type: String, default: "" },
    text: { type: String, default: "" },
  },
  { _id: false }
);

const CampaignSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: String,
    mainTemplate: { type: TemplateSchema, required: true },
    settings: {
      fromEmail: { type: String },
      replyTo: { type: String },
      batchSize: { type: Number, default: 50 },
    },
    status: {
      type: String,
      enum: ["draft", "scheduled", "running", "completed"],
      default: "draft",
    },
    contactsCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Campaign", CampaignSchema);
