const mongoose = require('mongoose');

const variantSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  attribute: { type: String, trim: true },
  value: { type: String, trim: true },
  sku: { type: String, unique: true, trim: true },
  unit: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Unit',
    required: true,
  },
  purchasePrice: { type: Number, required: true, min: 0 },
  price: { type: Number, required: true, min: 0 },
  discountPrice: {
    type: Number,
    default: 0,
    min: 0,
    validate: {
      validator: function (value) {
        return value <= this.price;
      },
      message: 'Discount price cannot exceed regular price',
    },
  },
  stockQuantity: { type: Number, required: true, default: 0, min: 0 },
  expiryDate: {
    type: Date,
    validate: {
      validator: function (value) {
        return !value || value >= new Date();
      },
      message: 'Expiry date must be in the future',
    },
  },
  weightQuantity: { type: Number, required: true, min: 0 },
  image: { type: String, trim: true },
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

variantSchema.pre('validate', function (next) {
  if (this.expiryDate && this.expiryDate.getTime() < Date.now()) {
    if (this.status !== 'Inactive') {
      return next(new Error('Status must be Inactive if expiryDate is in the past'));
    }
  }
  next();
});

// Indexes
variantSchema.index({ product: 1 });
variantSchema.index({ sku: 1 });
variantSchema.index({ stockQuantity: 1 });
variantSchema.index({ expiryDate: 1 });

// Pre-save middleware: Enforce status based on expiryDate
variantSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  if (this.expiryDate && this.expiryDate.getTime() < Date.now()) {
    this.status = 'Inactive';
  } else if (!this.isModified('status') && (!this.expiryDate || this.expiryDate.getTime() >= Date.now())) {
    this.status = 'Active';
  }
  next();
});

// Pre-findOneAndUpdate middleware: Enforce status for updates
variantSchema.pre('findOneAndUpdate', async function (next) {
  const update = this.getUpdate();
  this.set({ updatedAt: new Date() });
  if (update.expiryDate !== undefined) {
    const newExpiry = update.expiryDate ? new Date(update.expiryDate) : null;
    if (newExpiry && newExpiry.getTime() < Date.now()) {
      this.set({ status: 'Inactive' });
    } else if (!update.status && (!newExpiry || newExpiry.getTime() >= Date.now())) {
      this.set({ status: 'Active' });
    }
  } else if (update.status === 'Active') {
    // Check existing expiryDate if status is set to Active
    const doc = await this.model.findOne(this.getQuery()).select('expiryDate');
    if (doc && doc.expiryDate && doc.expiryDate.getTime() < Date.now()) {
      return next(new Error('Cannot set status to Active with expired expiryDate'));
    }
  }
  next();
});

// Pre-updateMany middleware: Update timestamp
variantSchema.pre('updateMany', function (next) {
  this.set({ updatedAt: new Date() });
  next();
});

// Static method to update expired variants
variantSchema.statics.updateExpiredVariants = async function () {
  try {
    const now = new Date();
    const expiredVariants = await this.find({
      expiryDate: { $lt: now },
      status: { $ne: 'Inactive' },
    }).select('_id sku expiryDate status');
    console.log(`Found ${expiredVariants.length} expired variants:`, 
      expiredVariants.map(v => ({ sku: v.sku, expiryDate: v.expiryDate })));
    
    const result = await this.updateMany(
      {
        expiryDate: { $lt: now },
        status: { $ne: 'Inactive' },
      },
      { $set: { status: 'Inactive', updatedAt: new Date() } }
    );
    console.log(`Updated ${result.modifiedCount} expired variants to Inactive`);
    return result;
  } catch (error) {
    console.error('Error updating expired variants:', error);
    throw error;
  }
};

module.exports = mongoose.model('Variant', variantSchema);