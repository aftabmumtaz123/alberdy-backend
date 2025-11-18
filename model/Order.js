// models/Order.js
const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  variant: { type: mongoose.Schema.Types.ObjectId, ref: 'Variant', default: null },
  quantity: { type: Number, required: true, min: 1 },
  price: { type: Number, required: true },          // snapshot at order time
  total: { type: Number, required: true }
});

const orderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    orderNumber: { type: String, unique: true, required: true },
    orderTrackingNumber: { type: String, unique: true, sparse: true },
  deliveryDate: {
    type: Date
  },
    deliveryPartner: {
      type: String
    },
    trackingStatus: {
      type: String,
      enum: ['not shipped','shipped','in transit','out for delivery','delivered','cancelled'],
      default: 'not shipped'
    },

    items: [orderItemSchema],

    subtotal: { type: Number, required: true },
    tax:      { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    shipping: { type: Number, default: 5.99 },
    total:    { type: Number, required: true },

    status: {
      type: String,
      enum: ['pending','confirmed', 'processing' ,'shipped','delivered','cancelled', 'returned'],
      default: 'pending'
    },

    shippingAddress: {
      fullName: { type: String, required: true },
      phone:    { type: String, required: true },
      street:   { type: String, required: true },
      email:    { type: String, required: true },
      city:     { type: String, required: true },
      state:    { type: String },
      zip:      { type: String, required: true }
    },

    paymentMethod: { type: String, enum: ['COD','Online'], required: true },
    paymentStatus: { type: String, enum: ['pending','paid', 'unpaid','refunded'], default: 'unpaid' },

    notes: { type: String }
  },
  { timestamps: true }
);

orderSchema.index({ user: 1, orderNumber: 1 });
orderSchema.index({ status: 1 });
orderSchema.index({ 'items.product': 1 });

module.exports = mongoose.model('Order', orderSchema);




