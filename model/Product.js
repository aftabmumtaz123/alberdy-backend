const mongoose = require('mongoose');

// Updated Product Schema - Removed embedded variations, added ref array
const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
  subcategory: { type: mongoose.Schema.Types.ObjectId, ref: 'Subcategory', required: true },
  brand: { type: mongoose.Schema.Types.ObjectId, ref: 'Brand', required: true },
  weightQuantity: { type: Number, required: true },
  unit: { type: mongoose.Schema.Types.ObjectId, ref: 'Unit', required: true },
  purchasePrice: { type: Number, required: true },
  price: { type: Number, required: true },
  discountPrice: { type: Number, default: 0 },
  stockQuantity: { type: Number, required: true, default: 0 }, // Fallback if no variations
  expiryDate: Date,
  ingredients: { type: String },
  suitableFor: { type: String, enum: ['Puppy', 'Adult', 'Senior', 'All Ages'] },
  images: [{ type: String }],
  thumbnail: { type: String, required: true },
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  variations: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Variant' }], // Array of Variant refs
  createdAt: { type: String },
  updatedAt: { type: String }
});

// Indexes (removed variations.sku)
productSchema.index({ category: 1, subcategory: 1 });
productSchema.index({ stockQuantity: 1 });
productSchema.index({ brand: 1 });
productSchema.index({ name: 1, brand: 1 }, { unique: true });

module.exports = mongoose.model('Product', productSchema);
