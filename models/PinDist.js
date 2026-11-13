// models/PinDist.js - road distance between two PIN codes (remembered forever; key is "smallerPin|largerPin")
const mongoose = require('mongoose');

const PinDistSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  km: { type: Number, required: true },
  method: String
}, { timestamps: true });

module.exports = mongoose.models.PinDist || mongoose.model('PinDist', PinDistSchema);
