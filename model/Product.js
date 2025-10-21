const mongoose = require('mongoose');

// Updated Product Schema - Base entity for product details, variations hold pricing/stock
const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
  subcategory: { type: mongoose.Schema.Types.ObjectId, ref: 'Subcategory', required: true },
  brand: { type: mongoose.Schema.Types.ObjectId, ref: 'Brand', required: true },
  suitableFor: { type: String, enum: ['Puppy', 'Adult', 'Senior', 'All Ages'] },
  ingredients: { type: String },
  images: [{ type: String }],
  thumbnail: { type: String },
  description: { type: String },
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  variations: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Variant' }], // Array of Variant refs (each "product instance")
  createdAt: { type: String },
  updatedAt: { type: String }
});

// Indexes (removed stockQuantity index as it's now in Variant)
productSchema.index({ category: 1, subcategory: 1 });
productSchema.index({ brand: 1 });
productSchema.index({ name: 1, brand: 1 }, { unique: true });

module.exports = mongoose.model('Product', productSchema);
