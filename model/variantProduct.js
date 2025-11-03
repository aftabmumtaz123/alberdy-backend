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

variantSchema.index({ product: 1 });
variantSchema.index({ sku: 1 });
variantSchema.index({ stockQuantity: 1 });
variantSchema.index({ expiryDate: 1 });

variantSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  // Only set status if not explicitly provided
  if (this.isModified('status') || this.isNew) {
    if (this.expiryDate && this.expiryDate.getTime() < Date.now()) {
      this.status = 'Inactive';
    } else if (!this.expiryDate || this.expiryDate.getTime() >= Date.now()) {
      if (!this.isModified('status')) {
        // Only change status if not explicitly set
        this.status = 'Active';
      }
    }
  }
  next();
});

variantSchema.pre('findOneAndUpdate', async function (next) {
  const update = this.getUpdate();
  this.set({ updatedAt: new Date() });
  if (update.expiryDate !== undefined) {
    const newExpiry = new Date(update.expiryDate);
    if (newExpiry.getTime() < Date.now()) {
      this.set({ status: 'Inactive' });
    } else if (update.status !== 'Inactive') {
      // Allow manual status override unless expired
      const docToUpdate = await this.model.findOne(this.getQuery());
      if (docToUpdate && docToUpdate.status === 'Inactive' && !update.status) {
        this.set({ status: 'Active' });
      }
    }
  }
  next();
});

variantSchema.pre('updateMany', function (next) {
  this.set({ updatedAt: new Date() });
  next();
});

variantSchema.statics.updateExpiredVariants = async function () {
  try {
    const result = await this.updateMany(
      {
        expiryDate: { $lt: new Date() },
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
