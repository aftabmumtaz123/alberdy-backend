// Brand Schema (updated: models/Brand.js)
const mongoose = require('mongoose');

const brandSchema = new mongoose.Schema({
  brandCode: { type: String, required: true, unique: true },
  brandName: { type: String, required: true, unique: true },
  description: { type: String }, // Optional
  image: { type: String, required: true }, // Required logo/image path
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  createdAt: { type: String, required: true },
  updatedAt: { type: String, required: true }
});

// Index for faster lookups
brandSchema.index({ brandCode: 1 });

module.exports = mongoose.model('Brand', brandSchema);