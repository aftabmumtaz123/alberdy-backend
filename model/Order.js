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
  orderNumber: { type: String, unique: true, required: true }, // e.g., #ORD-001
  items: [orderItemSchema],
  subtotal: { type: Number, required: true }, // Sum of item totals
  tax: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  shipping: { type: Number, default: 200 }, // Fixed shipping cost
  total: { type: Number, required: true }, // subtotal + tax + shipping - discount
  status: { type: String, enum: ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'], default: 'pending' },
  notes: { type: String, default: '' }, // Added for notes section
  deliveryAssigned: { type: String, default: '' }, // e.g., delivery partner name
  deliveryDate: { type: Date }, // Scheduled delivery date
  shippingAddress: {
    fullName: { type: String, required: true }, // Added for name
    phone: { type: String, required: true },    // Added for phone
    street: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    zip: { type: String, required: true },
    country: { type: String, default: 'PK' } // Added for completeness
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