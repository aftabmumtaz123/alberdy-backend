const mongoose = require('mongoose');
const { Schema } = mongoose;

const expenseCategorySchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    unique: true,
    maxlength: 100
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  timestamps: true // createdAt and updatedAt as Date (UTC)
});

// Optional: Pre-save to store timestamps as local ISO string (if you insist on "local time" storage)
const moment = require('moment');
expenseCategorySchema.pre('save', function(next) {
  if (this.isNew || this.isModified()) {
    this.createdAt = moment().local().toISOString();
    this.updatedAt = moment().local().toISOString();
  }
  next();
});

module.exports = mongoose.model('ExpenseCategory', expenseCategorySchema);