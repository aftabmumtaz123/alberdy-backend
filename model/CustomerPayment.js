const mongoose = require('mongoose');

const CustomerPaymentSchema = new mongoose.Schema({
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  totalAmount: {
    type: Number,
    min: 0,

  },
  amountPaid: {
    type: Number,
    min: 0,
  },
  amountDue: {
    type: Number,
    min: 0,
  },
  payment_method: {
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
   status: {
      type: String,
      enum: ['Pending', 'Completed', 'Partial', 'Cancelled'],
      default: 'Pending'
    },
    
}, { timestamps: true });

module.exports = mongoose.model('CustomerPayment', CustomerPaymentSchema);