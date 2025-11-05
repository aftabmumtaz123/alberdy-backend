const mongoose = require('mongoose');

const ProductPurchaseSchema = new mongoose.Schema({
  variantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Variant', required: true },
  quantity: { type: Number, required: true, min: 1 },
  unitPrice: { type: Number, required: true, min: 0 },
  taxPercent: { type: Number, default: 0 },
});

const PurchaseSchema = new mongoose.Schema({
  purchaseCode: { type: String, required: true, unique: true },
  date: { type: Date, default: Date.now },
  supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
  status: { type: String, enum: ['Pending', 'Completed', 'Cancelled'], default: 'Pending' },
  products: [ProductPurchaseSchema],
  payment: {
    amountPaid: { type: Number, default: 0 },
    ammountDue: { type: Number, default: 0 },
    type: { type: String, enum: ['Cash', 'Card', 'Online' , 'BankTransfer'], default: null },
  },
  summary: {
    subtotal: { type: Number, required: true },
    otherCharges: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    grandTotal: { type: Number, required: true },
  },
  notes: { type: String, default: '' },
});

module.exports = mongoose.model('Purchase', PurchaseSchema);