const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['Super Admin', 'Manager', 'Staff', 'Customer'], required: true, default: 'Customer' },
  phone: { type: String, default: '' },
  address: { type: String, default: '' },
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