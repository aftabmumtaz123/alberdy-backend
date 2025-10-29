const mongoose = require('mongoose');

// Variant Schema
const variantSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  attribute: {
    type: String,
    required: true,
    trim: true
  },
  value: {
    type: String,
    required: true,
    trim: true
  },
  sku: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  unit: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Unit',
    required: true
  },
  purchasePrice: {
    type: Number,
    required: true,
    min: 0
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  discountPrice: {
    type: Number,
    default: 0,
    min: 0,
    validate: {
      validator: function (value) {
        return value <= this.price;
      },
      message: 'Discount price cannot exceed regular price'
    }
  },
  stockQuantity: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  expiryDate: {
    type: Date,
    validate: {
      validator: function (value) {
        return !value || value >= new Date(); // Allow null or future date
      },
      message: 'Expiry date must be in the future'
    }
  },
  weightQuantity: {
    type: Number,
    required: true,
    min: 0
  },
  image: {
    type: String,
    trim: true
  },
  status: {
    type: String,
    enum: ['Active', 'Inactive', 'Expired'],
    default: 'Active'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes
variantSchema.index({ product: 1 });
variantSchema.index({ sku: 1 });
variantSchema.index({ stockQuantity: 1 });
variantSchema.index({ expiryDate: 1 }); // Helps with expiration queries

// ————————————————————————————————————————
// 1. PRE-SAVE: Auto-set status based on expiryDate
// ————————————————————————————————————————
variantSchema.pre('save', function (next) {
  // Update timestamp
  this.updatedAt = Date.now();

  // Auto-set status
  if (this.expiryDate && this.expiryDate.getTime() < Date.now()) {
    this.status = 'Expired';
  } else if (!this.expiryDate || this.expiryDate.getTime() >= Date.now()) {
    // Only change to Active if it was Expired (avoid overriding manual 'Inactive')
    if (this.status === 'Expired') {
      this.status = 'Active';
    }
  }

  next();
});

// ————————————————————————————————————————
// 2. PRE-UPDATE: Handle findOneAndUpdate, updateOne, etc.
// ————————————————————————————————————————
variantSchema.pre('findOneAndUpdate', async function (next) {
  const update = this.getUpdate();

  // If expiryDate is being updated
  if (update.expiryDate !== undefined) {
    const newExpiry = new Date(update.expiryDate);

    if (newExpiry.getTime() < Date.now()) {
      this.set({ status: 'Expired' });
    } else {
      // Only revert to Active if currently Expired
      const docToUpdate = await this.model.findOne(this.getQuery());
      if (docToUpdate && docToUpdate.status === 'Expired') {
        this.set({ status: 'Active' });
      }
    }
  }

  // Always update `updatedAt`
  this.set({ updatedAt: new Date() });

  next();
});

// ————————————————————————————————————————
// 3. PRE-UPDATE MANY: For bulk operations (optional)
// ————————————————————————————————————————
variantSchema.pre('updateMany', function (next) {
  this.set({ updatedAt: new Date() });
  next();
});

// Export Model
module.exports = mongoose.model('Variant', variantSchema);
