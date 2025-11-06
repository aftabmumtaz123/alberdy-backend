const mongoose = require('mongoose');

const ProductSaleSchema = new mongoose.Schema({
  variantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Variant', required: true },
  quantity: { type: Number, required: true, min: 1 },
  price: { type: Number, required: true, min: 0 },
  taxPercent: { type: Number, default: 0 },
  taxType: { type: String, enum: ['Inclusive', 'Exclusive'], default: 'Exclusive' },
  unitCost: { type: Number, required: true, min: 0 },
});

const SalesSchema = new mongoose.Schema({
  saleCode: { type: String, required: true, unique: true },
  date: { type: Date, default: Date.now },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  status: {
    type: String,
    enum: ['Pending', 'Completed', 'Cancelled', 'Refunded'],
    default: 'Pending',
  }
  products: [ProductSaleSchema],
  payment: {
    type: { type: String, enum: ['Cash', 'Card', 'Online', 'BankTransfer'], default: null },
    amountPaid: { type: Number, default: 0 },
    amountDue: {type: Number, default: 0 },
    notes: { type: String, default: '' },
  },
  summary: {
    totalQuantity: { type: Number, required: true },
    subTotal: { type: Number, required: true },
    discount: { type: Number, default: 0, min: 0 },
    otherCharges: { type: Number, default: 0, min: 0 },
    grandTotal: { type: Number, required: true },
  },
  isDeleted: { type: Boolean, default: false },
  salesHistory: [{
    action: { type: String, required: true },
    date: { type: Date, default: Date.now },
    changes: { type: mongoose.Schema.Types.Mixed },
  }],
}, { timestamps: true });

module.exports = mongoose.model('Sale', SalesSchema);