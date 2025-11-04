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
    status: {
        type: String,
        enum: ['Active', 'Inactive'],
        default: 'Active'
    },
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
    }
})

module.exports = mongoose.model('Supplier', SupplierSchema);