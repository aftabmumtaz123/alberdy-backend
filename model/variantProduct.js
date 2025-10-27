// Updated Variant Schema - Includes all pricing, stock, and unit fields (moved from Product)
const mongoose = require('mongoose');

const variantSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true }, // Reference to parent product
  attribute: { type: String }, // e.g., 'Size', 'Color'
  value: { type: String }, // e.g., 'Large', 'Red'
  sku: { type: String, required: true, unique: true }, // Unique SKU
  unit: { type: mongoose.Schema.Types.ObjectId, ref: 'Unit', required: true },
  purchasePrice: { type: Number, required: true },
  price: { type: Number, required: true },
  discountPrice: { type: Number, default: 0 },
  stockQuantity: { type: Number, required: true, default: 0 },
  expiryDate: { type: Date },
  weightQuantity: { type: Number, required: true },
  image: { type: String }, // Optional image path
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Indexes
variantSchema.index({ product: 1 });
variantSchema.index({ sku: 1 }, { unique: true });
variantSchema.index({ stockQuantity: 1 }); // Added index for stock queries

// Pre-save hook to update timestamp
variantSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Variant', variantSchema);

