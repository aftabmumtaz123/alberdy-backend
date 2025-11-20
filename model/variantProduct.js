const mongoose = require('mongoose');

const variantSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
    index: true,
  },

  attribute: { type: String, trim: true },
  value: { type: String, trim: true },

sku: {
  type: String,
  trim: true,
  uppercase: true,
  unique: true,
  sparse: true,  // allows unique only when value exists
  default: null,
  set: function (v) {
    // If user sends empty string, convert it to null
    if (!v || v.trim() === "") return null;
    return v.toUpperCase();
  }
},

  unit: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Unit',
    required: true,
  },

  purchasePrice: {
    type: Number,
    required: true,
    min: 0,
    default: 0,
  },

  price: {
    type: Number,
    required: true,
    min: 0,
  },

  discountPrice: {
    type: Number,
    min: 0,
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
    min: 0,
    default: 0,
  },

  reservedQuantity: {
    type: Number,
    min: 0,
    default: 0,
  },

  expiryDate: {
    type: Date,
    validate: {
      validator: function (v) {
        return !v || v >= new Date(Date.now() - 86400000);
      },
      message: 'Expiry date must not be in the past',
    },
  },

  weightQuantity: {
    type: Number,
    required: true,
    min: 0,
  },

  image: { type: String, trim: true },

  status: {
    type: String,
    enum: ['Active', 'Inactive', 'Discontinued'],
    default: 'Active',
  },

  isDeleted: { type: Boolean, default: false },
},
{
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});


// =========================
//  Virtual Fields
// =========================

variantSchema.virtual('availableStock').get(function () {
  return this.stockQuantity - this.reservedQuantity;
});

variantSchema.virtual('effectivePrice').get(function () {
  return this.discountPrice > 0 ? this.discountPrice : this.price;
});


// =========================
//  Indexes
// =========================

variantSchema.index({ sku: 1 }, { unique: true, sparse: true });
variantSchema.index({ product: 1, attribute: 1, value: 1 }, { unique: true });
variantSchema.index({ stockQuantity: 1 });
variantSchema.index({ expiryDate: 1 });
variantSchema.index({ status: 1 });
variantSchema.index({ isDeleted: 1 });


// =========================
//  Auto Status Update
// =========================

function evaluateStatus(doc) {
  const now = new Date();
  const expired = doc.expiryDate && doc.expiryDate < now;
  const outOfStock = doc.stockQuantity === 0;

  if (expired || outOfStock) return 'Inactive';
  return 'Active';
}


// =========================
//  Middleware - Pre Save
// =========================

variantSchema.pre('save', function (next) {
  this.status = evaluateStatus(this);
  next();
});


// =========================
//  Middleware - Pre findOneAndUpdate
// =========================

variantSchema.pre('findOneAndUpdate', async function (next) {
  const update = this.getUpdate();

  let doc = await this.model.findOne(this.getQuery());
  if (!doc) return next();

  const newDoc = { ...doc.toObject(), ...update };

  update.status = evaluateStatus(newDoc);

  this.setUpdate(update);

  next();
});


// =========================
//  Static Methods
// =========================

// Auto disable expired items (cron)
variantSchema.statics.updateExpiredVariants = async function () {
  const now = new Date();

  return await this.updateMany(
    {
      expiryDate: { $lt: now },
      status: { $ne: 'Inactive' },
      isDeleted: false,
    },
    { $set: { status: 'Inactive', updatedAt: now } }
  );
};

// Low stock finder
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
