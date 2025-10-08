// models/Order.js (Updated Schema)
// Add orderNumber and shipping fields as per requirements
const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  quantity: { type: Number, required: true, min: 1 },
  price: { type: Number, required: true }, // Price at time of order (effectivePrice snapshot)
  total: { type: Number, required: true } // quantity * price
});

const orderSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Assuming User model
  orderNumber: { type: String, unique: true, required: true }, // e.g., Order00001
  items: [orderItemSchema],
  subtotal: { type: Number, required: true }, // Sum of item totals
  tax: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  shipping: { type: Number, default: 5.99 }, // Fixed shipping cost
  total: { type: Number, required: true }, // subtotal + tax + discount + shipping
  status: { type: String, enum: ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'], default: 'pending' },
  shippingAddress: {
    fullName: String, // Added for name
    phone: String,    // Added for phone
    street: String,
    city: String,
    state: String,
    zip: String
  },
  paymentMethod: { type: String, required: true, enum: ['COD', 'online'] },
  paymentStatus: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' }
}, {
  timestamps: true
});

// Index for faster lookups
orderSchema.index({ user: 1, orderNumber: 1 });
orderSchema.index({ status: 1 });

module.exports = mongoose.model('Order', orderSchema);