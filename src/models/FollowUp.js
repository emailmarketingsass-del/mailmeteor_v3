// src/models/FollowUp.js
const mongoose = require("mongoose");

const FollowUpSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      required: true,
      index: true,
    },
    sequence: { type: Number, required: true }, // 1..N (0 is main email on campaign.mainTemplate)
    subject: { type: String, default: "", immutable: true },
    html: { type: String },
    text: { type: String },
    // We store delay as ISO date string OR relativeDelayMinutes; for now use relative minutes from previous email
    sendAt: { type: Date },
    delayMinutes: { type: Number, default: 24 * 60 }, // default 1 day
    enabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("FollowUp", FollowUpSchema);
