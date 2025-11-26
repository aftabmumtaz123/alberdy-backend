const mongoose = require('mongoose');

// Updated Product Schema - Base entity for product details, variations hold pricing/stock
const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
  subcategory: { type: mongoose.Schema.Types.ObjectId, ref: 'Subcategory', required: true },
  brand: { type: mongoose.Schema.Types.ObjectId, ref: 'Brand', required: true },
  suitableFor: { type: String },
  ingredients: { type: String },
  images: [{ type: String }],
  thumbnail: { type: String },
  description: { type: String },
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },

  // Soft Delete Fields
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },

  variations: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Variant' }],
  
}, { timestamps: true });

// Indexes (removed stockQuantity index as it's now in Variant)
productSchema.index({ category: 1, subcategory: 1 });
productSchema.index({ brand: 1 });




// Auto exclude soft-deleted documents in all queries
productSchema.pre(/^find/, function(next) {
  this.where({ isDeleted: { $ne: true } });
  next();
});

productSchema.pre('findOne', function(next) {
  this.where({ isDeleted: { $ne: true } });
  next();
});

productSchema.pre('aggregate', function(next) {
  this.pipeline().unshift({ $match: { isDeleted: { $ne: true } } });
  next();
});








module.exports = mongoose.model('Product', productSchema);


