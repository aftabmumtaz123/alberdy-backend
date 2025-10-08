const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true }, // e.g., Dog, Cat
  image: String, // URL/path
  description: String,
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  subcategories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Subcategory' }], // Reverse ref (array)
  createdAt: { type: String },
  updatedAt: { type: String }
});

// Index for queries
categorySchema.index({ name: 1, status: 1 });

// ✅ Fix for OverwriteModelError
module.exports = mongoose.models.Category || mongoose.model('Category', categorySchema);
