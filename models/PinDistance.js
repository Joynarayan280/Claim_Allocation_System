// models/PinDistance.js
// Remembers the road distance (km) between two PIN codes so Google Maps is asked only once per pair.
const mongoose = require('mongoose');

const PinDistanceSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },   // "700001>700091" (the two PINs, sorted)
  km: { type: Number, required: true },
  source: { type: String, default: 'google' },
  at: { type: Date, default: Date.now }
});

module.exports = mongoose.models.PinDistance || mongoose.model('PinDistance', PinDistanceSchema);
