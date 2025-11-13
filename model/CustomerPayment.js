const mongoose = require('mongoose');

const CustomerPaymentSchema = new mongoose.Schema({
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  amountPaid: {
    type: Number,
    required: true,
    min: 0,
  },
  amountDue: {
    type: Number,
    min: 0,
  },
  paymentMethod: {
    type: String,
    required: true,
    enum: ['Bank Transfer', 'Credit Card', 'Cash', 'Check', 'Other'],
  },
  invoiceNo: {
    type: String,
    required: true,
    trim: true,
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

module.exports = mongoose.model('CustomerPayment', CustomerPaymentSchema);