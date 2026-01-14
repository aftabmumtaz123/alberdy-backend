// models/Notification.js
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  type: {
    type: String,
    enum: [
      'order_placed',
      'order_status_updated',
      'payment_confirmation',
      'low_stock_alert',
      'account_registration',
      'purchase_created',
      'sale_created_admin',
      'sale_created_customer'
    ],
    required: true
  },

  title: {
    type: String,
    required: true,
    trim: true
  },

  message: {
    type: String,
    required: true,
    trim: true
  },

  relatedOrder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    default: null
  },

  relatedUser: {                    // useful for account_registration
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },

  relatedProduct: {                 // useful for low_stock_alert
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    default: null
  },

  isRead: {
    type: Boolean,
    default: false
  },

  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

notificationSchema.index({ user: 1, createdAt: -1 }); // good for listing per user

module.exports = mongoose.model('Notification', notificationSchema);