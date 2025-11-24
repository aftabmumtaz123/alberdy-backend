// models/Brand.js
const mongoose = require('mongoose');

const brandSchema = new mongoose.Schema({
  brandCode: { type: String, required: true, },
  brandName: { type: String, required: true, },
  description: { type: String },
  image: { type: String, required: true },
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  createdAt: { type: String, required: true },
  updatedAt: { type: String, required: true }
});


brandSchema.index({ status: 1 });

module.exports = mongoose.model('Brand', brandSchema);
