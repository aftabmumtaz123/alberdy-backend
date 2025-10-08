// models/Offer.js
const mongoose = require('mongoose');

const offerSchema = new mongoose.Schema({
  offerName: {
    type: String,
    required: [true, 'Offer name is required'],
    unique: true,
    trim: true
  },
  discountType: {
    type: String,
    required: [true, 'Discount type is required'],
    enum: {
      values: ['Percentage', 'Fixed'],
      message: 'Discount type must be Percentage or Fixed'
    }
  },
  discountValue: {
    type: Number,
    required: [true, 'Discount value is required'],
    min: [0.01, 'Discount value must be positive']
  },
  applicableProducts: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  }],
  startDate: {
    type: Date,
    required: [true, 'Start date is required']
  },
  endDate: {
    type: Date,
    required: [true, 'End date is required']
  },
  status: {
    type: String,
    required: true,
    enum: {
      values: ['active', 'inactive'],
      default: 'active',
      message: 'Status must be active or inactive'
    }
  }
}, {
  timestamps: true
});

// Index for efficient queries
offerSchema.index({ applicableProducts: 1, startDate: 1, endDate: 1 });
offerSchema.index({ status: 1, startDate: 1, endDate: 1 });

// Pre-save validation for discountValue based on type
offerSchema.pre('save', function(next) {
  if (this.discountType === 'Percentage' && this.discountValue > 100) {
    return next(new Error('Discount value must be ≤ 100 for Percentage type'));
  }
  next();
});

module.exports = mongoose.model('Offer', offerSchema);