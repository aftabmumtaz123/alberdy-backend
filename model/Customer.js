// models/Customer.js
const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  phone: { type: String, required: true },
  address: {
    street: { type: String},
    city: { type: String },
    state: { type: String },
    zip: { type: String },
    country: { type: String } // Optional
  },
  petType: { 
    type: String, 
    enum: ['Dog', 'Cat', 'Bird', 'Fish', 'Multiple'], 
    required: true 
  },
  status: { 
    type: String, 
    enum: ['Active', 'Blocked'], 
    default: 'Active' 
  },
  createdAt: { type: String },
  updatedAt: { type: String }
});

// Indexes for performance and uniqueness
customerSchema.index({ email: 1, unique: true });
customerSchema.index({ status: 1 });
customerSchema.index({ petType: 1 });

module.exports = mongoose.model('Customer', customerSchema);