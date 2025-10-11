// New Variant Model/Schema - Separate entity for variations
const mongoose = require('mongoose');

const variantSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true }, // Reference to parent product
  attribute: { type: String, required: true }, // e.g., 'Size', 'Color'
  value: { type: String, required: true }, // e.g., 'Large', 'Red'
  sku: { type: String, required: true, unique: true }, // Unique SKU
  image: { type: String }, // Optional image path
  price: { type: Number, required: true },
  discountPrice: { type: Number, default: 0 },
  stockQuantity: { type: Number, required: true, default: 0 },
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Indexes
variantSchema.index({ product: 1 });
variantSchema.index({ sku: 1 }, { unique: true });

// Pre-save hook to update timestamp
variantSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Variant', variantSchema);