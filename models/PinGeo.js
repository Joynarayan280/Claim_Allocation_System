// models/PinGeo.js
// Remembers where a PIN code is (latitude / longitude) so the free geocoder is asked only once per PIN.
const mongoose = require('mongoose');

const PinGeoSchema = new mongoose.Schema({
  pin: { type: String, required: true, unique: true },
  lat: Number,
  lon: Number,
  miss: { type: Boolean, default: false },   // true = the geocoder did not know this PIN (retried after 7 days)
  at: { type: Date, default: Date.now }
});

module.exports = mongoose.models.PinGeo || mongoose.model('PinGeo', PinGeoSchema);
