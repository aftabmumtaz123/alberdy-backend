// model/PushSubscription.js
const mongoose = require('mongoose');

const PushSubscriptionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  endpoint: { type: String, required: true, unique: true },
  keys: {
    p256dh: String,
    auth: String
  },
  role: { type: String, enum: ['Super Admin', 'Manager'], required: true }
}, { timestamps: true });

module.exports = mongoose.model('PushSubscription', PushSubscriptionSchema);