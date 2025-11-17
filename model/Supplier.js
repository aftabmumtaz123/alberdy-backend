const mongoose = require('mongoose');

const SupplierSchema = new mongoose.Schema({
  
    supplierName: {
        type: String,
        required: true,
        trim: true
    },
    supplierCode: {
        type: String,
        required: true,
        unique: true,
    },
    contactPerson: {
        type: String,
        trim: true
    },
    email: {
        type: String,
        trim: true,
    },
    phone: {
        type: String,
        trim: true,
    },
    supplierType: {
        type: String,
    },
    status: { type: String, enum: ['Active', 'Inactive', 'Deleted'], default: 'Active' },

    attachments: [{
        fileName: String,
        filePath: String,
        uploadedAt: { type: Date, default: Date.now }
    }],

    address: {
        street: String,
        city: String,
        state: String,
        zip: String,
        country: String
    },
    paymentHistory: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment'  // This must match your Payment model name
  }],
}, { timestamps: true })

module.exports = mongoose.model('Supplier', SupplierSchema);