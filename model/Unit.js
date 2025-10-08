const mongoose = require('mongoose');

// Unit Schema
const unitSchema = new mongoose.Schema({
  parent_name: { type: String}, // e.g., 'Weight', 'Volume'
  unit_name: { type: String, required: true }, // e.g., 'Gram', 'Kilogram'
  short_name: { type: String, required: true }, // e.g., 'g', 'kg'
  unit_status: { type: String, enum: ['enable', 'disable'], default: 'enable' },
  register_date: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Unit', unitSchema);