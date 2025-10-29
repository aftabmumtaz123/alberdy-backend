const mongoose = require('mongoose');
const { Schema } = mongoose;
const moment = require('moment');

// ✅ Helper to generate a unique Expense ID
const generateExpenseId = async () => {
  // Get total count
  const count = await mongoose.connection.db.collection('expenses').countDocuments();
  
  // Add timestamp for uniqueness
  const datePart = moment().format('YYYYMMDD-HHmmss');
  
  // Combine into unique readable ID
  return `E${String(count + 1).padStart(6, '0')}-${datePart}`;
};

const expenseSchema = new Schema({
  expenseId: {
    type: String,
    unique: true,
    index: true,
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
    min: 0.01
  },
  note: {
    type: String,
    trim: true,
    maxlength: 500
  }
}, {
  timestamps: true
});

// ✅ Generate a unique expenseId before saving
expenseSchema.pre('save', async function(next) {
  if (!this.expenseId) {
    this.expenseId = await generateExpenseId();
  }
  next();
});

// ✅ Optional local timestamp format (readable when viewed)
expenseSchema.methods.toJSON = function() {
  const obj = this.toObject();
  obj.createdAt = moment(obj.createdAt).local().format('YYYY-MM-DD HH:mm:ss');
  obj.updatedAt = moment(obj.updatedAt).local().format('YYYY-MM-DD HH:mm:ss');
  return obj;
};

module.exports = mongoose.model('Expense', expenseSchema);
