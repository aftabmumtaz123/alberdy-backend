const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String},
  role: { type: String, enum: ['Super Admin', 'Manager', 'Staff', 'Customer'], required: true, default: 'Customer' },
  phone: { type: String, default: '' },
  address: {
    street: { type: String, default: '' },
    city: { type: String, default: '' },
    state: { type: String, default: '' },
    zip: { type: String, default: '' },
  },
  petType: { type: String, enum: ['Dog', 'Cat', 'Bird', 'Fish', 'Multiple'] }, // For customers
  status: { type: String, enum: ['Active', 'Inactive', 'Blocked'], default: 'Active' },
  lastLogin: Date,
  resetPasswordOTP: {
    type: String,
    default: undefined,
  },
  resetPasswordExpire: {
    type: Date,
    default: undefined,
  },
  isOtpVerified: {
    type: Boolean,
    default: false,
  },
  paymentHistory: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CustomerPayment',
  }],
  otp: { type: String },              // Store hashed or plain (temporary)
  otpExpires: { type: Date },
}, { timestamps: true });

// Hash password before save
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function(password) {
  return bcrypt.compare(password, this.password);
};

module.exports = mongoose.model('User', userSchema);