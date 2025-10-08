// models/StockEntry.js
const mongoose = require('mongoose');

const stockEntrySchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: [true, 'Product is required']
  },
  quantity: {
    type: Number,
    required: [true, 'Quantity is required']
  },
  expiryDate: {
    type: Date
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
stockEntrySchema.index({ product: 1 });
stockEntrySchema.index({ product: 1, expiryDate: 1 });
stockEntrySchema.index({ expiryDate: 1 });

module.exports = mongoose.model('StockEntry', stockEntrySchema);