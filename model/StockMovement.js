// models/StockMovement.js
const mongoose = require('mongoose');

const stockMovementSchema = new mongoose.Schema({
  variant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Variant',
    required: true,
  },
  sku: { type: String, required: true },
  previousQuantity: { type: Number, required: true },
  newQuantity: { type: Number, required: true, min: 0 },

  isStockIncreasing: { type: Boolean, required: true },
  changeQuantity: { type: Number, required: true }, 
  movementType: {
    type: String,
    minlength: 2,
    required: true,
  },
  date: { type: Date, default: Date.now },
  reason: { type: String, required: true, trim: true },
  referenceId: { type: String, trim: true },
  performedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
}, {
  timestamps: true,
});

stockMovementSchema.index({ variant: 1, createdAt: -1 });
stockMovementSchema.index({ sku: 1 });
stockMovementSchema.index({ movementType: 1 });

module.exports = mongoose.model('StockMovement', stockMovementSchema);