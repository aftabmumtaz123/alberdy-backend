const mongoose = require('mongoose');
const { Schema } = mongoose;

// Helper for sequential expense ID
const generateExpenseId = async () => {
  const count = await mongoose.connection.db.collection('expenses').countDocuments();
  return `E${String(count + 1).padStart(6, '0')}`;
};

const expenseSchema = new Schema({
  expenseId: {
    type: String,
    unique: true,
  },
  expenseDate: {
    type: Date,
    required: true
  },
  branch: {
    type: String,
    required: true
  },
  category: {
    type: String,
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0.01 // > 0
  },
  note: {
    type: String,
    trim: true,
    maxlength: 500
  }
}, {
  timestamps: true // createdAt and updatedAt as Date (UTC)
});

// Pre-save for expenseId
expenseSchema.pre('save', async function(next) {
  if (!this.expenseId) {
    this.expenseId = await generateExpenseId();
  }
  next();
});

// Optional: Pre-save for local timestamps (uncomment if needed)
const moment = require('moment');
expenseSchema.pre('save', function(next) {
  if (this.isNew || this.isModified()) {
    this.createdAt = moment().local().toISOString();
    this.updatedAt = moment().local().toISOString();
  }
  next();
});


module.exports = mongoose.model('Expense', expenseSchema);
