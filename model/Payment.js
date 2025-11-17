const mongoose = require('mongoose');

const PaymentSchema = new mongoose.Schema({
  supplier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier',
    required: true,
  },
  totalAmount: {
    type: Number,
    min: 0
  },
  amountPaid: {
    type: Number,
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
  },
  
}, { timestamps: true });


module.exports = mongoose.model('Payment', PaymentSchema);
