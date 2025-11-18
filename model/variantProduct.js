const mongoose = require('mongoose');

const variantSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
    index: true,
  },
  attribute: { type: String, trim: true }, // e.g., "Size", "Color"
  value: { type: String, trim: true },     // e.g., "XL", "Red"
  sku: {
    type: String,
    trim: true,
    uppercase: true,
    unique: true,
    sparse: true, // allows nulls but enforces uniqueness when present
    required: [true, 'SKU is required'],
  },
  unit: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Unit',
    required: true,
  },
  purchasePrice: {
    type: Number,
    required: true,
    min: [0, 'Purchase price cannot be negative'],
    default: 0,
  },
  price: {
    type: Number,
    required: true,
    min: [0, 'Selling price cannot be negative'],
  },
  discountPrice: {
    type: Number,
    min: [0, 'Discount price cannot be negative'],
    default: 0,
    validate: {
      validator: function (v) {
        return v === 0 || v <= this.price;
      },
      message: 'Discount price must be less than or equal to regular price',
    },
  },
  stockQuantity: {
    type: Number,
    required: true,
    min: [0, 'Stock cannot be negative'],
    default: 0,
  },
  reservedQuantity: {
    type: Number,
    default: 0,
    min: 0,
  }, // for pending orders
  expiryDate: {
    type: Date,
    validate: {
      validator: function (v) {
        return !v || v >= new Date(Date.now() - 86400000); // allow today
      },
      message: 'Expiry date must not be in the past',
    },
  },
  weightQuantity: {
    type: Number,
    required: true,
    min: [0, 'Weight quantity cannot be negative'],
  },
  image: { type: String, trim: true },
  status: {
    type: String,
    enum: ['Active', 'Inactive', 'Discontinued'],
    default: 'Active',
  },
  isDeleted: { type: Boolean, default: false }, // soft delete
},
{
  timestamps: true, // gives createdAt & updatedAt automatically
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// === Virtuals ===
variantSchema.virtual('availableStock').get(function () {
  return this.stockQuantity - this.reservedQuantity;
});

variantSchema.virtual('effectivePrice').get(function () {
  return this.discountPrice > 0 ? this.discountPrice : this.price;
});

// === Indexes ===
variantSchema.index({ sku: 1 }, { unique: true, sparse: true });
variantSchema.index({ product: 1, 'attribute': 1, 'value': 1 }, { unique: true }); // prevent duplicate variants
variantSchema.index({ stockQuantity: 1 });
variantSchema.index({ expiryDate: 1 });
variantSchema.index({ status: 1 });
variantSchema.index({ isDeleted: 1 });

// === Middleware ===

// Auto-set status based on expiry
const autoSetStatus = function (next) {
  if (this.isModified('expiryDate') || this.isNew) {
    const now = Date.now();
    const expiry = this.expiryDate ? this.expiryDate.getTime() : null;

    if (expiry && expiry < now) {
      this.status = 'Inactive';
    } else if (this.stockQuantity === 0) {
      this.status = 'Inactive';
    } else {
      this.status = 'Active';
    }
  }
  next();
};

variantSchema.pre('save', autoSetStatus);
variantSchema.pre('findOneAndUpdate', async function (next) {
  const update = this.getUpdate();

  // Handle expiryDate changes
  if (update.expiryDate !== undefined) {
    const newExpiry = update.expiryDate ? new Date(update.expiryDate) : null;
    const now = Date.now();

    if (newExpiry && newExpiry < now) {
      this.set({ status: 'Inactive' });
    } else if (update.stockQuantity !== undefined && update.stockQuantity === 0) {
      this.set({ status: 'Inactive' });
    } else if (!update.status) {
      this.set({ status: 'Active' });
    }
  }

  // Prevent setting Active if expired
  if (update.status === 'Active') {
    const doc = await this.model.findOne(this.getQuery());
    if (doc && doc.expiryDate && doc.expiryDate < new Date()) {
      return next(new Error('Cannot activate variant with expired date'));
    }
  }

  next();
});

// === Static Methods ===

// Run this via cron daily at 2 AM
variantSchema.statics.updateExpiredVariants = async function () {
  const now = new Date();
  const result = await this.updateMany(
    {
      expiryDate: { $lt: now },
      status: { $ne: 'Inactive' },
      isDeleted: false,
    },
    {
      $set: {
        status: 'Inactive',
        updatedAt: now,
      },
    }
  );

  if (result.modifiedCount > 0) {
    console.log(`Updated ${result.modifiedCount} expired variants to Inactive`);
  }
  return result;
};

// Low stock alert finder
variantSchema.statics.findLowStock = function (threshold = 10) {
  return this.find({
    stockQuantity: { $lte: threshold },
    status: 'Active',
    isDeleted: false,
  })
    .populate('product', 'name')
    .sort({ stockQuantity: 1 });
};

module.exports = mongoose.model('Variant', variantSchema);