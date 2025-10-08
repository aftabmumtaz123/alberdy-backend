const mongoose = require('mongoose');

const subCategorySchema = new mongoose.Schema({
  name: { type: String, required: true }, // e.g., Dry Food, Wet Food
  parent_category_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true }, // Forward ref (parent)
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  image: { type: String }, // Path to image file
}, { timestamps: true });

// Indexes
subCategorySchema.index({ category: 1, name: 1 });
subCategorySchema.index({ status: 1 });

// Optional: Auto-add to parent's subcategories array on save
subCategorySchema.post('save', async function(doc) {
  const Category = require('./category'); // Import here to avoid circular
  await Category.findByIdAndUpdate(doc.category, { $addToSet: { subcategories: doc._id } });
});

// Optional: Remove from parent on delete
subCategorySchema.post('remove', async function(doc) {
  const Category = require('./category');
  await Category.findByIdAndUpdate(doc.category, { $pull: { subcategories: doc._id } });
});

module.exports = mongoose.model('Subcategory', subCategorySchema);