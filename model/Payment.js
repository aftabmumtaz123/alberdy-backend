const mongoose = require('mongoose');

const PaymentSchema = new mongoose.Schema({
  supplier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier',
    required: true,
  },
  amoutPaid: {
    type: Number,
    required: true,
    min: 0,
  },
  amountDue: {
    type: Number,
    min: 0
  }
  paymentMethod: {
    type: String,
    required: true,
    enum: ['Bank Transfer', 'Credit Card', 'Cash', 'Check', 'Other'],
  },
  date: {
    type: Date,
    required: true,
    default: Date.now,
  },
  notes: {
    type: String,
    trim: true,
  },
}, { timestamps: true });

module.exports = mongoose.model('Payment', PaymentSchema);